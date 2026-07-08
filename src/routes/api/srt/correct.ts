import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { checkAndIncrement, getUserIdFromRequest } from "@/lib/ai-quota.server";

const Body = z.object({
  srt: z.string().min(1).max(400_000),
  use_ai: z.boolean().default(true),
  max_chars: z.number().int().min(20).max(80).default(42),
  max_lines: z.number().int().min(1).max(3).default(2),
  max_words_per_line: z.number().int().min(3).max(20).default(10),
  split_long_cues: z.boolean().default(true),
  extra_notes: z.string().max(2000).optional().default(""),
});

const SRT_BLOCK_RE =
  /(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3})\s*\n(.*?)(?=\n\s*\n|$)/gs;

const BREAK_PARTICLES = ["ကို", "ကို့", "မှာ", "နဲ့", "လို့", "ပြီး", "ဟာ", "တဲ့", "သည်", "၏", "၊", "။"];

type Cue = { index: string; timestamp: string; text: string };

function parseSrt(text: string): Cue[] {
  const norm = text.replace(/\r\n?/g, "\n").trim() + "\n\n";
  const cues: Cue[] = [];
  for (const m of norm.matchAll(SRT_BLOCK_RE)) {
    cues.push({ index: m[1], timestamp: m[2], text: m[3].trim() });
  }
  return cues;
}

function renderSrt(cues: Cue[]): string {
  return cues.map((c) => `${c.index}\n${c.timestamp}\n${c.text}\n`).join("\n").trim() + "\n";
}

function applyGlossary(text: string, corrections: Record<string, string>): { text: string; hits: number } {
  let out = text;
  let hits = 0;
  for (const wrong of Object.keys(corrections).sort((a, b) => b.length - a.length)) {
    if (!wrong) continue;
    if (out.includes(wrong)) {
      const count = out.split(wrong).length - 1;
      hits += count;
      out = out.split(wrong).join(corrections[wrong]);
    }
  }
  return { text: out, hits };
}

function wrapCue(text: string, maxChars: number, maxLines: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  const lines: string[] = [];
  let remaining = collapsed;
  for (let i = 0; i < maxLines; i++) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = "";
      break;
    }
    const window = remaining.slice(0, maxChars + 1);
    let breakAt = -1;
    for (const p of BREAK_PARTICLES) {
      const idx = window.lastIndexOf(p);
      if (idx > 0) {
        const cand = idx + p.length;
        if (cand <= maxChars && cand > breakAt) breakAt = cand;
      }
    }
    if (breakAt <= 0) {
      const sp = window.lastIndexOf(" ");
      if (sp > 0) breakAt = sp;
    }
    if (breakAt <= 0) breakAt = maxChars;
    lines.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
    if (!remaining) break;
  }
  if (remaining) lines[lines.length - 1] = (lines[lines.length - 1] + " " + remaining).trim();
  return lines.join("\n");
}

// --- Timecode utilities ---------------------------------------------------

function tsToMs(s: string): number {
  const m = s.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return 0;
  return +m[1] * 3_600_000 + +m[2] * 60_000 + +m[3] * 1000 + +m[4];
}

function msToTs(ms: number): string {
  ms = Math.max(0, Math.round(ms));
  const h = Math.floor(ms / 3_600_000);
  ms -= h * 3_600_000;
  const m = Math.floor(ms / 60_000);
  ms -= m * 60_000;
  const s = Math.floor(ms / 1000);
  const r = ms - s * 1000;
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(r).padStart(3, "0")}`;
}

function parseRange(ts: string): { start: number; end: number } {
  const [a, b] = ts.split("-->").map((x) => x.trim());
  return { start: tsToMs(a), end: tsToMs(b) };
}

// Tokenize into "words". For Burmese without spaces, split at particle boundaries.
function tokenize(text: string): string[] {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!collapsed) return [];
  const spaced = collapsed.split(" ").filter(Boolean);
  if (spaced.length > 1) return spaced;
  // Single run of script — split at particle boundaries.
  const tokens: string[] = [];
  let buf = collapsed;
  let guard = 0;
  while (buf.length > 0 && guard++ < 500) {
    let cut = -1;
    for (const p of BREAK_PARTICLES) {
      const idx = buf.indexOf(p);
      if (idx > 0) {
        const end = idx + p.length;
        if (cut < 0 || end < cut) cut = end;
      }
    }
    if (cut <= 0 || cut >= buf.length) {
      tokens.push(buf);
      break;
    }
    tokens.push(buf.slice(0, cut));
    buf = buf.slice(cut).replace(/^\s+/, "");
  }
  return tokens.filter(Boolean);
}

function wrapTokens(tokens: string[], maxWordsPerLine: number, maxLines: number, joiner: string): string {
  if (tokens.length === 0) return "";
  const lines: string[] = [];
  const cap = maxLines * maxWordsPerLine;
  const use = tokens.slice(0, cap);
  const overflow = tokens.slice(cap);
  for (let i = 0; i < use.length; i += maxWordsPerLine) {
    lines.push(use.slice(i, i + maxWordsPerLine).join(joiner));
  }
  if (overflow.length) lines[lines.length - 1] += joiner + overflow.join(joiner);
  return lines.join("\n");
}

// Split one long cue into multiple sequential cues, distributing time proportionally.
// Netflix-inspired: max 2 lines × N words per line; new cues get proportional timecodes.
function splitAndWrap(
  cue: Cue,
  maxWordsPerLine: number,
  maxLines: number,
  split: boolean,
): Cue[] {
  const tokens = tokenize(cue.text);
  const perCue = maxWordsPerLine * maxLines;
  const spaced = cue.text.replace(/\s+/g, " ").trim().includes(" ");
  const joiner = spaced ? " " : "";
  if (!split || tokens.length <= perCue) {
    return [{ ...cue, text: wrapTokens(tokens, maxWordsPerLine, maxLines, joiner) }];
  }
  const { start, end } = parseRange(cue.timestamp);
  const total = tokens.length;
  const chunks: string[][] = [];
  for (let i = 0; i < total; i += perCue) chunks.push(tokens.slice(i, i + perCue));
  const dur = Math.max(0, end - start);
  const out: Cue[] = [];
  let consumed = 0;
  const MIN_MS = 700; // Netflix min duration guardrail
  for (let i = 0; i < chunks.length; i++) {
    const words = chunks[i].length;
    const cStart = start + Math.round((consumed / total) * dur);
    consumed += words;
    let cEnd = start + Math.round((consumed / total) * dur);
    if (cEnd - cStart < MIN_MS) cEnd = cStart + MIN_MS;
    out.push({
      index: "0",
      timestamp: `${msToTs(cStart)} --> ${msToTs(cEnd)}`,
      text: wrapTokens(chunks[i], maxWordsPerLine, maxLines, joiner),
    });
  }
  return out;
}

const GLOSSARY_TITLE = "SRT Burmese Glossary";
const GLOSSARY_TAG = "srt-glossary";

type Glossary = { corrections: Record<string, string>; notes: string };

async function loadGlossary(userId: string): Promise<{ id: string | null; data: Glossary }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (c: string, v: string) => {
          contains: (c: string, v: string[]) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: { id: string; content: string }[] | null }>;
            };
          };
        };
      };
    };
  };
  const { data } = await admin
    .from("brain_items")
    .select("id, content")
    .eq("created_by", userId)
    .contains("tags", [GLOSSARY_TAG])
    .order("updated_at", { ascending: false })
    .limit(1);
  const row = data?.[0];
  if (!row) return { id: null, data: { corrections: {}, notes: "" } };
  try {
    const parsed = JSON.parse(row.content) as Partial<Glossary>;
    return {
      id: row.id,
      data: { corrections: parsed.corrections ?? {}, notes: parsed.notes ?? "" },
    };
  } catch {
    return { id: row.id, data: { corrections: {}, notes: "" } };
  }
}

async function saveGlossary(userId: string, existingId: string | null, g: Glossary) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(g.corrections).sort()) sorted[k] = g.corrections[k];
  const payload = JSON.stringify({ corrections: sorted, notes: g.notes }, null, 2);
  const admin = supabaseAdmin as unknown as {
    from: (t: string) => {
      update: (row: Record<string, unknown>) => {
        eq: (c: string, v: string) => Promise<{ error: unknown }>;
      };
      insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
    };
  };
  if (existingId) {
    await admin
      .from("brain_items")
      .update({ content: payload, updated_at: new Date().toISOString() })
      .eq("id", existingId);
  } else {
    await admin.from("brain_items").insert({
      created_by: userId,
      title: GLOSSARY_TITLE,
      content: payload,
      source_type: "note",
      language: "burmese",
      tags: [GLOSSARY_TAG],
    });
  }
}

// Extract the first JSON array from the model text.
function extractJsonArray(text: string): unknown[] | null {
  const s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const arr = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

type AiCueResult = {
  id: number;
  corrected: string;
  fixes: { wrong: string; correct: string }[];
};

async function aiReviewBatch(
  cues: { id: number; text: string }[],
  notes: string,
  apiKey: string,
): Promise<AiCueResult[]> {
  const gateway = createLovableAiGatewayProvider(apiKey);
  const model = gateway("google/gemini-2.5-flash");
  const system = `You are a Burmese (Myanmar) subtitle proofreader.
- Fix spelling of Burmese personal names, place names, organization names, and political terminology.
- Modern Unicode only (no Zawgyi). Do NOT translate. Do NOT rephrase. Do NOT change punctuation unless clearly wrong.
- If a cue is already correct, return it unchanged with an empty fixes array.
${notes.trim() ? `\nProject notes:\n${notes.trim()}` : ""}
Return STRICT JSON only, no prose, no markdown fences.`;
  const prompt = `Return a JSON array. For each cue below, return an object:
{"id": <id>, "corrected": "<full corrected cue text>", "fixes": [{"wrong":"...","correct":"..."}]}

Cues:
${cues.map((c) => `id=${c.id}: ${c.text}`).join("\n")}`;
  const out = await generateText({ model, system, prompt });
  const arr = extractJsonArray(out.text) ?? [];
  return arr
    .map((row) => {
      const r = row as Partial<AiCueResult>;
      if (typeof r.id !== "number" || typeof r.corrected !== "string") return null;
      const fixes = Array.isArray(r.fixes)
        ? r.fixes
            .map((f) => {
              const ff = f as { wrong?: unknown; correct?: unknown };
              return typeof ff.wrong === "string" && typeof ff.correct === "string"
                ? { wrong: ff.wrong, correct: ff.correct }
                : null;
            })
            .filter((v): v is { wrong: string; correct: string } => !!v)
        : [];
      return { id: r.id, corrected: r.corrected, fixes };
    })
    .filter((v): v is AiCueResult => !!v);
}

export const Route = createFileRoute("/api/srt/correct")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in required." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch (e) {
          return new Response(JSON.stringify({ error: "Invalid request", detail: String(e) }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const cues = parseSrt(body.srt);
        if (cues.length === 0) {
          return new Response(JSON.stringify({ error: "No SRT cues parsed from input." }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        if (cues.length > 1500) {
          return new Response(JSON.stringify({ error: "File too large (max 1500 cues)." }), {
            status: 413,
            headers: { "content-type": "application/json" },
          });
        }

        const { id: glossaryId, data: glossary } = await loadGlossary(userId);
        const corrections = { ...glossary.corrections };

        let glossaryHits = 0;
        for (const c of cues) {
          const { text, hits } = applyGlossary(c.text, corrections);
          c.text = text;
          glossaryHits += hits;
        }

        let aiFixCount = 0;
        let newEntries = 0;
        const overflow: string[] = [];

        if (body.use_ai) {
          const quota = await checkAndIncrement(userId);
          if (!quota.ok) {
            return new Response(
              JSON.stringify({ error: quota.reason, used: quota.used, limit: quota.limit }),
              { status: 429, headers: { "content-type": "application/json" } },
            );
          }

          const BATCH = 20;
          for (let i = 0; i < cues.length; i += BATCH) {
            const slice = cues.slice(i, i + BATCH).map((c, k) => ({ id: i + k, text: c.text }));
            try {
              const results = await aiReviewBatch(slice, glossary.notes + "\n" + (body.extra_notes ?? ""), apiKey);
              for (const r of results) {
                const cue = cues[r.id];
                if (!cue) continue;
                if (r.corrected && r.corrected !== cue.text) cue.text = r.corrected;
                for (const f of r.fixes) {
                  const w = f.wrong.trim();
                  const c = f.correct.trim();
                  if (!w || !c || w === c) continue;
                  aiFixCount += 1;
                  if (!(w in corrections)) {
                    corrections[w] = c;
                    newEntries += 1;
                  }
                }
              }
            } catch (e) {
              console.error("[srt/correct] AI batch failed", e);
            }
          }
        }

        // Split long cues by word count and re-wrap; assign fresh sequential indices.
        const rebuilt: Cue[] = [];
        for (const c of cues) {
          const pieces = splitAndWrap(c, body.max_words_per_line, body.max_lines, body.split_long_cues);
          for (const p of pieces) rebuilt.push(p);
        }
        // Also enforce char-limit overflow reporting on the wrapped output.
        for (let i = 0; i < rebuilt.length; i++) {
          rebuilt[i].index = String(i + 1);
          if (rebuilt[i].text.split("\n").some((l) => l.length > body.max_chars)) {
            overflow.push(rebuilt[i].index);
          }
        }
        const splitCount = rebuilt.length - cues.length;
        // Replace original cues with the rebuilt list.
        cues.length = 0;
        cues.push(...rebuilt);

        // Save updated glossary
        try {
          await saveGlossary(userId, glossaryId, { corrections, notes: glossary.notes });
        } catch (e) {
          console.error("[srt/correct] save glossary failed", e);
        }

        return Response.json({
          corrected_srt: renderSrt(cues),
          stats: {
            cues: cues.length,
            glossary_replacements: glossaryHits,
            ai_fixes: aiFixCount,
            new_glossary_entries: newEntries,
            overflow_cues: overflow,
            glossary_size: Object.keys(corrections).length,
          },
        });
      },
    },
  },
});
