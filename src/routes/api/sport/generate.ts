import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { cleanNarrative } from "@/lib/clean-output";
import { cacheGet, cacheSet, hashKey } from "@/lib/ai-cache";
import { checkAndIncrement, getUserIdFromRequest } from "@/lib/ai-quota.server";

const Body = z.object({
  sourceKind: z.enum(["url", "text"]),
  source: z.string().min(1).max(60000),
  contentType: z.enum([
    "match_review",
    "match_preview",
    "match_analysis",
    "highlights",
    "player_profile",
    "general",
  ]),
  outputLanguage: z.enum(["burmese-casual", "english", "bilingual"]).default("burmese-casual"),
  tone: z.enum(["casual", "hype", "analytical"]).default("casual"),
  notes: z.string().max(2000).optional().default(""),
  use_brain: z.boolean().default(true),
});

const TYPE_LABEL: Record<string, string> = {
  match_review: "MATCH REVIEW — recap of a finished match. Lead with the result and key moments (goals, red cards, turning points). Then narrative flow of the game. End with what it means for the table / next fixture.",
  match_preview: "MATCH PREVIEW — written before kickoff. Set the stakes, recent form of both sides, key players to watch, likely lineups if mentioned in source, prediction-style closer (no fake stats).",
  match_analysis: "TACTICAL / MATCH ANALYSIS — deeper look at how the game was won/lost: formations, pressing, key duels, substitutions, manager decisions. Still conversational, not academic.",
  highlights: "HIGHLIGHTS RECAP — punchy rundown of the standout moments only: goals, big saves, controversies. Short paragraphs, momentum-driven.",
  player_profile: "PLAYER PROFILE — focus on one player. Background, current form, role at club / country, signature moments. Human and fan-facing.",
  general: "GENERAL SPORTS STORY — transfer news, injury update, federation news, fan reaction, etc. Use the format the source naturally calls for.",
};

const TONE_LABEL: Record<string, string> = {
  casual: "casual fan-talk: everyday words, contractions, the way Myanmar football fans actually chat on Facebook and in tea shops",
  hype: "high-energy, hyped-up matchday voice — excited but still accurate",
  analytical: "thoughtful pundit voice — still conversational, but with sharper observations",
};

const LANG_INSTR: Record<string, string> = {
  "burmese-casual": `Output MUST be in Burmese (Myanmar Unicode only — no Zawgyi), in casual everyday spoken/written register used by Burmese sports fans. NOT formal news Burmese. Use common loanwords as fans actually say them (e.g. "ပရီးမီးယားလိဂ်", "ချန်ပီယံစ်လိဂ်", "ဂိုးသွင်း", "ပွဲထွက်လူစာရင်း", "နည်းပြ", "အသင်းခေါင်းဆောင်", "ပူးတွဲ", "ပင်နယ်တီ", "ဖရီးကစ်", "ကော်နာ", "အလယ်တန်း", "ကွင်းလယ်", "နောက်တန်း", "ရှေ့တန်း"). Keep player/club names in their commonly used Burmese form when one exists, otherwise keep the Latin name as-is. Do not over-formalize.`,
  english: "Output in clear, conversational sports-writing English. Active voice, short punchy paragraphs.",
  bilingual: "Output FIRST a faithful literal Burmese (Unicode) version in casual fan register, then a blank line, then '---', a blank line, then the English version. Do not label them.",
};

export const Route = createFileRoute("/api/sport/generate")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in to use AI." }), {
            status: 401, headers: { "content-type": "application/json" },
          });
        }

        let body: z.infer<typeof Body>;
        try { body = Body.parse(await request.json()); }
        catch (e) {
          return new Response(JSON.stringify({ error: "Invalid request", detail: String(e) }), {
            status: 400, headers: { "content-type": "application/json" },
          });
        }

        // 1) Resolve source text (URL scrape vs raw text)
        let sourceText = body.source;
        if (body.sourceKind === "url") {
          try {
            const { fetchUrlText } = await import("@/lib/url-fetch.server");
            sourceText = await fetchUrlText(body.source.trim());
          } catch (e) {
            return new Response(JSON.stringify({ error: (e as Error).message }), {
              status: 400, headers: { "content-type": "application/json" },
            });
          }
        }

        // 2) Pull Burmese-sport reference items from the second brain (tag = 'sport').
        let brainContext = "";
        if (body.use_brain) {
          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            type Row = { title: string; content: string };
            const admin = supabaseAdmin as unknown as {
              from: (t: string) => {
                select: (cols: string) => {
                  contains: (col: string, val: string[]) => {
                    limit: (n: number) => Promise<{ data: Row[] | null }>;
                  };
                };
              };
            };
            const { data } = await admin.from("brain_items")
              .select("title, content")
              .contains("tags", ["sport"])
              .limit(20);
            if (data && data.length) {
              brainContext = data.map((r) => `• ${r.title}: ${r.content.slice(0, 600)}`).join("\n");
            }
          } catch (e) { console.error("[sport/generate] brain fetch", e); }
        }

        const key = await hashKey({ kind: "sport", userId, ...body, sourceText });
        const cached = cacheGet(key);
        if (cached) return Response.json({ ...JSON.parse(cached), cached: true });

        const quota = await checkAndIncrement(userId);
        if (!quota.ok) {
          return new Response(
            JSON.stringify({ error: quota.reason, used: quota.used, limit: quota.limit }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        const gateway = createLovableAiGatewayProvider(apiKey);
        const model = gateway("google/gemini-2.5-flash");

        const system = `You are a Burmese sports writer for a fan-first football/sports outlet. You take English (or mixed) sports source material and turn it into native-feeling Burmese sports content for Myanmar fans.

CONTENT TYPE: ${TYPE_LABEL[body.contentType]}
VOICE: ${TONE_LABEL[body.tone]}
LANGUAGE: ${LANG_INSTR[body.outputLanguage]}

ABSOLUTE RULES:
1. Translate the *meaning* of the source faithfully and literally — do NOT invent goals, scores, lineups, transfer fees, dates, quotes, or stats. If a fact is not in the source, leave it out.
2. Output ONLY the finished piece. No labels ("Intro:", "Summary:", "နိဒါန်း：" etc.), no markdown, no bullet lists unless the format genuinely needs them, no meta commentary like "Here is your article".
3. For Burmese output use modern Myanmar Unicode only. Use the Burmese forms of football vocabulary that fans actually use (see REFERENCE GLOSSARY when provided). Latin player and club names that have no settled Burmese form stay in Latin.
4. Keep paragraphs short and readable. Conversational, never stiff.
5. Spell well-known names consistently with how Burmese-language sports pages normally render them.${body.notes ? `\n\nEXTRA EDITOR NOTES: ${body.notes}` : ""}`;

        const userPrompt = `${brainContext ? `REFERENCE GLOSSARY & STYLE NOTES (Burmese sport vocabulary — use this when picking words):
${brainContext}

` : ""}SOURCE MATERIAL:
${sourceText}

Now write the ${body.contentType.replace("_", " ")} following every rule.`;

        try {
          const out = await generateText({ model, system, prompt: userPrompt });
          const cleaned = cleanNarrative(out.text);

          // Lightweight SEO/categorization
          let seo = { title: "", metaDescription: "", hashtags: [] as string[] };
          try {
            const seoRaw = await generateText({
              model,
              system: 'Output ONLY a JSON object, no markdown. Schema: {"title": string, "metaDescription": string, "hashtags": string[]}. Match the article\'s language. Hashtags: 3-6, sports-relevant.',
              prompt: `ARTICLE:\n${cleaned}\n\nReturn JSON now.`,
            });
            const raw = seoRaw.text.trim().replace(/^```json\s*|\s*```$/g, "").replace(/^```\s*|\s*```$/g, "");
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) seo = { ...seo, ...JSON.parse(match[0]) };
          } catch { /* keep defaults */ }

          const result = {
            output: cleaned,
            seo,
            contentType: body.contentType,
            outputLanguage: body.outputLanguage,
            cached: false,
            brainUsed: !!brainContext,
            usage: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
          };
          cacheSet(key, JSON.stringify(result));
          return Response.json(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "AI request failed";
          const status = /429/.test(msg) ? 429 : /402/.test(msg) ? 402 : 500;
          return new Response(JSON.stringify({ error: msg }), {
            status, headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
