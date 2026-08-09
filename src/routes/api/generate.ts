import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { cleanNarrative } from "@/lib/clean-output";
import { cacheGet, cacheSet, hashKey } from "@/lib/ai-cache";
import { checkAndIncrement, getUserIdFromRequest } from "@/lib/ai-quota.server";

const BodySchema = z.object({
  mode: z.enum(["burmese-standard", "burmese-long", "english"]),
  scriptType: z.enum(["video", "web"]),
  tone: z.enum(["professional", "engaging", "neutral"]),
  source: z.string().max(60000),
  sourceKind: z.enum(["url", "text", "file"]).default("text"),
  instructions: z.string().max(2000).optional().default(""),
});

const LANG_LABEL: Record<string, string> = {
  "burmese-standard": "Burmese (Myanmar / Unicode standard, concise news register)",
  "burmese-long": "Burmese (Myanmar / Unicode, long-form feature register)",
  english: "English (international wire register)",
};

const TYPE_LABEL: Record<string, string> = {
  video: "VIDEO NEWS NARRATION SCRIPT — written to be read aloud by a broadcaster: natural sentence rhythm, short clauses, broadcast pacing, no on-screen labels",
  web: "WEB NEWS ARTICLE — clean publishable prose with a strong lead sentence, contextual middle, and a closing sentence; flowing paragraphs only",
};

const TONE_LABEL: Record<string, string> = {
  professional: "professional, authoritative, restrained — Mizzima / BBC Burmese / RFA standard",
  engaging: "engaging and human, but still serious and accurate",
  neutral: "strictly neutral, source-attributed, no editorializing",
};

function systemPrompt(input: z.infer<typeof BodySchema>) {
  return `You are a senior news editor for a Myanmar-based newsroom (standards comparable to Mizzima, BBC Burmese, and RFA Burmese).

LANGUAGE: ${LANG_LABEL[input.mode]}
FORMAT: ${TYPE_LABEL[input.scriptType]}
TONE: ${TONE_LABEL[input.tone]}

CRITICAL OUTPUT RULES — these are absolute:
1. Output ONLY pure narrative prose. No structural labels of any kind: never write "Intro:", "Lead:", "Body:", "Conclusion:", "Headline:", "Summary:", "Narration:", "VO:", "Anchor:", "Part 1", "Section", "နိဒါန်း：", "နိဂုံး：", or any equivalent.
2. NEVER use Markdown. No #, ##, ###, *, **, _, -, >, backticks, or bullet lists. Plain paragraphs separated by a blank line only.
3. No meta commentary ("Here is your script", "I have written…", "As requested…"). Begin directly with the news content.
4. For Burmese output: use modern Unicode Burmese exclusively (no Zawgyi). Maintain consistent spacing and punctuation.
5. Attribute claims to sources where the source material implies a source. Do not invent facts, names, numbers, dates, or quotes that are not supported by the provided material.
6. Keep sentences broadcastable: clear subject-verb structure, no parenthetical clutter.
${input.instructions ? `\nADDITIONAL EDITOR NOTES: ${input.instructions}` : ""}`;
}

// ---- URL fetch hardening ----
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB hard cap on remote payload
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

/**
 * Optional strict allowlist. When URL_FETCH_ALLOWLIST is set (comma-separated
 * host suffixes, e.g. "bbc.com,rfa.org,mizzima.com"), only matching hosts may
 * be fetched. Unset = open (still subject to SSRF, port, size, time checks).
 */
function getAllowlist(): string[] | null {
  const raw = process.env.URL_FETCH_ALLOWLIST?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase().replace(/^\.+/, ""))
    .filter(Boolean);
}

function hostMatchesAllowlist(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) => h === entry || h.endsWith(`.${entry}`));
}

function isPrivateIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 & 192.0.2.0/24
    if (a === 198 && b === 51) return true; // TEST-NET-2
    if (a === 203 && b === 0) return true; // TEST-NET-3
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("2001:db8")) return true; // documentation
  if (lower.startsWith("64:ff9b::")) return true; // NAT64
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  return false;
}

/**
 * Resolve hostname via Cloudflare DoH and reject if ANY answer is a private/
 * internal address. Returns the resolved IPs so the caller can pin against
 * them (best-effort TOCTOU mitigation — see fetchUrl).
 */
async function resolveAndCheck(hostname: string): Promise<string[]> {
  // Reject literal IPs in hostname
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIp(bare)) throw new Error("Blocked: private/internal address");
    return [bare];
  }
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".local") ||
    lower === "metadata.google.internal" ||
    lower === "metadata.goog"
  ) {
    throw new Error("Blocked: internal hostname");
  }

  const ips: string[] = [];
  let resolved = false;
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) continue;
      const j = (await r.json()) as { Answer?: { data: string; type: number }[] };
      for (const ans of j.Answer ?? []) {
        if (!ans.data) continue;
        resolved = true;
        if (isPrivateIp(ans.data)) {
          throw new Error("Blocked: resolves to private address");
        }
        ips.push(ans.data);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Blocked:")) throw e;
    }
  }
  if (!resolved) throw new Error("Blocked: hostname did not resolve");
  return ips;
}

async function fetchUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Could not fetch URL: invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Could not fetch URL: only http(s) URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Could not fetch URL: credentials in URL not allowed");
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new Error("Could not fetch URL: only standard ports (80/443) allowed");
  }
  const allowlist = getAllowlist();
  if (allowlist && !hostMatchesAllowlist(parsed.hostname, allowlist)) {
    throw new Error("Could not fetch URL: host not in allowlist");
  }
  // Resolve + validate (also gives us the IP set for TOCTOU mitigation).
  await resolveAndCheck(parsed.hostname);

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; NewsroomBot/1.0; +https://lovable.dev)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      throw new Error("Redirects are not followed");
    }
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);

    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (ctype && !ALLOWED_CONTENT_TYPES.some((c) => ctype.includes(c))) {
      throw new Error(`Blocked: unsupported content-type (${ctype})`);
    }
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared && declared > MAX_RESPONSE_BYTES) {
      throw new Error("Blocked: response exceeds size limit");
    }

    // Stream with hard size cap (TOCTOU-safe against lying Content-Length).
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Fetch failed: empty body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new Error("Blocked: response exceeds size limit");
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.byteLength; }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    let body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ");
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
    body = body
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18000);
    return (title ? `TITLE: ${title}\n\n` : "") + body;
  } catch (e) {
    throw new Error(
      `Could not fetch URL: ${e instanceof Error ? e.message : "unknown error"}`,
    );
  }
}

export const Route = createFileRoute("/api/generate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey)
          return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in to use AI." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        let body: z.infer<typeof BodySchema>;
        try {
          body = BodySchema.parse(await request.json());
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "Invalid request", detail: String(e) }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        let sourceText = body.source;
        if (body.sourceKind === "url") {
          try {
            sourceText = await fetchUrl(body.source.trim());
          } catch (e) {
            return new Response(
              JSON.stringify({ error: (e as Error).message }),
              { status: 400, headers: { "content-type": "application/json" } },
            );
          }
        }

        // Scope cache per-user: prevents cross-user quota bypass + usage leakage.
        const key = await hashKey({ userId, ...body, sourceText });
        const cached = cacheGet(key);
        if (cached) {
          return Response.json({ ...JSON.parse(cached), cached: true });
        }

        // Check & reserve quota for this user before spending AI credits.
        const quota = await checkAndIncrement(userId);
        if (!quota.ok) {
          return new Response(
            JSON.stringify({ error: quota.reason, used: quota.used, limit: quota.limit }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        const {
          budgetText,
          BUDGETS,
          newLedger,
          runTextJob,
          runJsonJob,
          verifyAndRepair,
        } = await import("@/lib/ai-pipeline.server");

        const ledger = newLedger();
        const budgeted = budgetText(sourceText, BUDGETS.source);

        const userPrompt = `SOURCE MATERIAL:
${budgeted.text}

TASK: Produce the ${body.scriptType === "video" ? "broadcast narration script" : "web news article"} in ${LANG_LABEL[body.mode]}. Follow every CRITICAL OUTPUT RULE.`;

        try {
          // Job 1 — draft
          const draft = cleanNarrative(
            await runTextJob({
              apiKey,
              job: "draft",
              system: systemPrompt(body),
              prompt: userPrompt,
              ledger,
            }),
          );

          // Job 2 + 3 — grounding check, then repair only if needed
          const verified = await verifyAndRepair({
            apiKey,
            source: budgeted.text,
            draft,
            ledger,
          });
          const cleaned = cleanNarrative(verified.text);

          // Job 4 — SEO + categorization (fed a budgeted excerpt, not the full piece)
          const seo = await runJsonJob({
            apiKey,
            job: "seo",
            system:
              'You are a Myanmar newsroom SEO editor. Output ONLY a single JSON object, no markdown, no commentary. Schema: {"title": string, "metaDescription": string, "hashtags": string[], "category": string, "keywords": string[]}. Use the SAME LANGUAGE as the article for title, metaDescription, and hashtags. Category from: Politics, Economy, Business, Technology, Health, Environment, Conflict & Security, International, Sports, Culture, Education, Human Rights, Other.',
            prompt: `ARTICLE:\n${budgetText(cleaned, BUDGETS.draft).text}\n\nReturn the JSON object now.`,
            fallback: {
              title: "",
              metaDescription: "",
              hashtags: [] as string[],
              category: "Other",
              keywords: [] as string[],
            },
            ledger,
          });

          const result = {
            narrative: cleaned,
            seo,
            cached: false,
            grounding: verified.grounding,
            pipeline: { jobs: ledger.jobs, tokens: ledger, sourceTruncated: budgeted.truncated },
            usage: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
          };
          cacheSet(key, JSON.stringify(result));
          return Response.json(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "AI request failed";
          const status = /429/.test(msg)
            ? 429
            : /402/.test(msg)
              ? 402
              : 500;
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
