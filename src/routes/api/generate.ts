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

async function fetchUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; NewsroomBot/1.0; +https://lovable.dev)",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const html = await res.text();
    // Very lightweight extraction
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

        const key = await hashKey({ ...body, sourceText });
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

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway("google/gemini-2.5-flash");

        const userPrompt = `SOURCE MATERIAL:
${sourceText}

TASK: Produce the ${body.scriptType === "video" ? "broadcast narration script" : "web news article"} in ${LANG_LABEL[body.mode]}. Follow every CRITICAL OUTPUT RULE.`;

        try {
          // 1) Main narrative
          const narrative = await generateText({
            model,
            system: systemPrompt(body),
            prompt: userPrompt,
          });
          const cleaned = cleanNarrative(narrative.text);

          // 2) SEO + categorization — ask for JSON directly
          const seoRaw = await generateText({
            model,
            system:
              'You are a Myanmar newsroom SEO editor. Output ONLY a single JSON object, no markdown, no commentary. Schema: {"title": string, "metaDescription": string, "hashtags": string[], "category": string, "keywords": string[]}. Use the SAME LANGUAGE as the article for title, metaDescription, and hashtags. Category from: Politics, Economy, Business, Technology, Health, Environment, Conflict & Security, International, Sports, Culture, Education, Human Rights, Other.',
            prompt: `ARTICLE:\n${cleaned}\n\nReturn the JSON object now.`,
          });

          let seo = {
            title: "",
            metaDescription: "",
            hashtags: [] as string[],
            category: "Other",
            keywords: [] as string[],
          };
          try {
            const raw = seoRaw.text.trim().replace(/^```json\s*|\s*```$/g, "").replace(/^```\s*|\s*```$/g, "");
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) seo = { ...seo, ...JSON.parse(match[0]) };
          } catch {
            /* keep defaults */
          }

          const result = {
            narrative: cleaned,
            seo,
            cached: false,
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
