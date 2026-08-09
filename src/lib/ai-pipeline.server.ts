/**
 * Server-only AI job pipeline.
 *
 * Every AI-backed endpoint runs its work through these staged jobs instead of
 * calling the model ad hoc. The pipeline exists for two reasons:
 *
 *  1. Anti-hallucination — after drafting, a grounding job checks the draft
 *     against the source material and, only when unsupported claims are found,
 *     a repair job rewrites the offending parts. Nothing is invented silently.
 *  2. Token discipline — source text is budgeted (head + tail preserved) before
 *     it ever reaches the model, later jobs get shrunk inputs, and each optional
 *     job is skipped when it cannot pay for itself.
 */

import { streamText, generateText } from "ai";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";

/** Enforced model for all server-side gateway text calls. */
export const PIPELINE_MODEL = "openai/gpt-5.6-sol";

/** Rough token estimate that also holds up for Myanmar Unicode text. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const burmese = (text.match(/[\u1000-\u109F]/g) || []).length;
  const rest = text.length - burmese;
  // Burmese code points are token-dense; latin ≈ 4 chars/token.
  return Math.ceil(burmese / 1.5 + rest / 4);
}

export type Budgeted = { text: string; tokens: number; truncated: boolean };

/**
 * Trim text to a token budget, keeping the opening (lead, who/what/where) and
 * the tail (conclusions, later facts) which is where news detail lives.
 */
export function budgetText(text: string, maxTokens: number): Budgeted {
  const clean = text.replace(/\s+\n/g, "\n").trim();
  const tokens = estimateTokens(clean);
  if (tokens <= maxTokens) return { text: clean, tokens, truncated: false };
  const ratio = maxTokens / tokens;
  const keep = Math.max(400, Math.floor(clean.length * ratio) - 60);
  const head = Math.floor(keep * 0.7);
  const tail = keep - head;
  const out = `${clean.slice(0, head)}\n\n[…source trimmed to fit the token budget…]\n\n${clean.slice(-tail)}`;
  return { text: out, tokens: estimateTokens(out), truncated: true };
}

export const BUDGETS = {
  /** Source material handed to the drafting job. */
  source: 9000,
  /** Source excerpt handed to the grounding checker. */
  verifySource: 5000,
  /** Draft handed to secondary jobs (grounding, SEO). */
  draft: 4000,
  /** Retrieved knowledge-base context. */
  context: 3000,
} as const;

export type TokenLedger = { input: number; output: number; jobs: string[] };

function addUsage(
  ledger: TokenLedger,
  job: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  fallbackIn: number,
  fallbackOut: string,
) {
  ledger.jobs.push(job);
  ledger.input += usage?.inputTokens ?? fallbackIn;
  ledger.output += usage?.outputTokens ?? estimateTokens(fallbackOut);
}

export function newLedger(): TokenLedger {
  return { input: 0, output: 0, jobs: [] };
}

function model(apiKey: string) {
  return createLovableAiGatewayProvider(apiKey)(PIPELINE_MODEL);
}

/**
 * Streamed text job. Streaming (rather than a buffered call) keeps long
 * reasoning-heavy generations from hitting request timeouts and being billed
 * twice on retry.
 */
export async function runTextJob(opts: {
  apiKey: string;
  job: string;
  system: string;
  prompt: string;
  ledger: TokenLedger;
}): Promise<string> {
  const result = streamText({
    model: model(opts.apiKey),
    system: opts.system,
    prompt: opts.prompt,
  });
  const text = await result.text;
  const usage = await result.usage.catch(() => undefined);
  addUsage(opts.ledger, opts.job, usage, estimateTokens(opts.system + opts.prompt), text);
  return text.trim();
}

/** Small JSON job with lenient parsing — never throws, falls back to `fallback`. */
export async function runJsonJob<T extends object>(opts: {
  apiKey: string;
  job: string;
  system: string;
  prompt: string;
  fallback: T;
  ledger: TokenLedger;
}): Promise<T> {
  try {
    const out = await generateText({
      model: model(opts.apiKey),
      system: opts.system,
      prompt: opts.prompt,
    });
    addUsage(
      opts.ledger,
      opts.job,
      out.usage,
      estimateTokens(opts.system + opts.prompt),
      out.text,
    );
    const raw = out.text
      .trim()
      .replace(/^```json\s*|\s*```$/g, "")
      .replace(/^```\s*|\s*```$/g, "");
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return opts.fallback;
    return { ...opts.fallback, ...(JSON.parse(match[0]) as T) };
  } catch {
    return opts.fallback;
  }
}

export type GroundingIssue = { claim: string; problem: string };
export type Grounding = {
  checked: boolean;
  supported: boolean;
  issues: GroundingIssue[];
  repaired: boolean;
};

const VERIFY_SYSTEM = `You are a strict fact-checking editor. You compare a DRAFT against the SOURCE MATERIAL it was written from.
Report ONLY statements in the draft that the source does not support: invented names, scores, numbers, dates, quotes, causes, or attributions. Paraphrase, translation, and ordinary connective wording are NOT problems.
Output ONLY a single JSON object, no markdown: {"issues": [{"claim": string, "problem": string}]}. Empty array when the draft is fully supported. Report at most 6 issues, each claim quoted in under 20 words.`;

const REPAIR_SYSTEM = `You are a senior editor performing a minimal factual correction pass.
Rewrite the draft so every listed unsupported claim is removed or softened to exactly what the source supports. Change NOTHING else: keep the same language, register, structure, length, and wording everywhere else.
Output ONLY the corrected piece — no notes, no markdown, no labels.`;

/**
 * Grounding + repair jobs. Skipped when there is no meaningful source to check
 * against, or when the draft is trivially short (cheaper to leave alone).
 */
export async function verifyAndRepair(opts: {
  apiKey: string;
  source: string;
  draft: string;
  ledger: TokenLedger;
  enabled?: boolean;
}): Promise<{ text: string; grounding: Grounding }> {
  const empty: Grounding = { checked: false, supported: true, issues: [], repaired: false };
  const source = opts.source.trim();
  const draft = opts.draft.trim();
  if (opts.enabled === false || source.length < 200 || draft.length < 120) {
    return { text: draft, grounding: empty };
  }

  const src = budgetText(source, BUDGETS.verifySource).text;
  const dft = budgetText(draft, BUDGETS.draft).text;

  const { issues } = await runJsonJob<{ issues: GroundingIssue[] }>({
    apiKey: opts.apiKey,
    job: "grounding-check",
    system: VERIFY_SYSTEM,
    prompt: `SOURCE MATERIAL:\n${src}\n\nDRAFT:\n${dft}\n\nReturn the JSON object now.`,
    fallback: { issues: [] },
    ledger: opts.ledger,
  });

  const real = (Array.isArray(issues) ? issues : [])
    .filter((i) => i && typeof i.claim === "string" && i.claim.trim().length > 1)
    .slice(0, 6);

  if (real.length === 0) {
    return { text: draft, grounding: { checked: true, supported: true, issues: [], repaired: false } };
  }

  const repaired = await runTextJob({
    apiKey: opts.apiKey,
    job: "grounding-repair",
    system: REPAIR_SYSTEM,
    prompt: `SOURCE MATERIAL:\n${src}\n\nUNSUPPORTED CLAIMS:\n${real
      .map((i, n) => `${n + 1}. "${i.claim}" — ${i.problem}`)
      .join("\n")}\n\nDRAFT TO CORRECT:\n${draft}\n\nReturn the corrected piece now.`,
    ledger: opts.ledger,
  });

  const finalText = repaired.length > draft.length * 0.4 ? repaired : draft;
  return {
    text: finalText,
    grounding: {
      checked: true,
      supported: false,
      issues: real,
      repaired: finalText !== draft,
    },
  };
}
