import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { cleanNarrative } from "@/lib/clean-output";
import { cacheGet, cacheSet, hashKey } from "@/lib/ai-cache";
import { checkAndIncrement, getUserIdFromRequest } from "@/lib/ai-quota.server";

const Body = z.object({
  brief: z.string().min(1).max(4000),
  target_format: z.enum(["video_script", "web_article", "social_post", "newsletter"]),
  target_language: z.enum(["burmese-standard", "burmese-long", "english"]),
  tone: z.enum(["professional", "engaging", "neutral"]).default("professional"),
  item_ids: z.array(z.string().uuid()).max(20).default([]),
  use_semantic_recall: z.boolean().default(true),
  recall_count: z.number().int().min(1).max(10).default(5),
});

const LANG_LABEL: Record<string, string> = {
  "burmese-standard": "Burmese (Myanmar Unicode, concise news register)",
  "burmese-long": "Burmese (Myanmar Unicode, long-form feature register)",
  english: "English (international wire register)",
};

const FORMAT_RULES: Record<string, string> = {
  video_script:
    "VIDEO NEWS NARRATION — broadcast-ready spoken script. Short clauses, natural rhythm, no on-screen labels, no stage directions. ~200-400 words.",
  web_article:
    "WEB NEWS ARTICLE — publishable prose with strong lead, contextual middle, closing sentence. Flowing paragraphs only. ~300-600 words.",
  social_post:
    "SOCIAL POST — single short broadcast-style update under 280 characters. Punchy lead, factual, ends with 2-4 relevant hashtags on the SAME line, separated by spaces.",
  newsletter:
    "EMAIL NEWSLETTER — first line is a subject line under 70 characters. Then a blank line. Then a 2-4 paragraph body that feels personal but authoritative. End with a one-line takeaway.",
};

const TONE_LABEL: Record<string, string> = {
  professional: "professional, authoritative, restrained",
  engaging: "engaging and human, still accurate",
  neutral: "strictly neutral, source-attributed",
};

export const Route = createFileRoute("/api/brain/translate")({
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

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // 1) Pull explicitly-selected items.
        type BrainRow = {
          id: string;
          title: string;
          content: string;
          source_url: string | null;
          language: string;
          tags: string[];
        };
        const sources: (BrainRow & { similarity?: number; selected: boolean })[] = [];
        const seen = new Set<string>();

        if (body.item_ids.length > 0) {
          const admin = supabaseAdmin as unknown as {
            from: (t: string) => {
              select: (cols: string) => {
                in: (c: string, v: string[]) => Promise<{ data: BrainRow[] | null; error: unknown }>;
              };
            };
          };
          const { data } = await admin
            .from("brain_items")
            .select("id, title, content, source_url, language, tags")
            .in("id", body.item_ids);
          for (const r of data ?? []) {
            if (seen.has(r.id)) continue;
            seen.add(r.id);
            sources.push({ ...r, selected: true });
          }
        }

        // 2) Semantic recall on the brief.
        if (body.use_semantic_recall) {
          try {
            const { embedText } = await import("@/lib/embeddings.server");
            const q = await embedText(body.brief);
            const admin = supabaseAdmin as unknown as {
              rpc: (
                fn: string,
                args: Record<string, unknown>,
              ) => Promise<{ data: (BrainRow & { similarity: number })[] | null; error: unknown }>;
            };
            const { data } = await admin.rpc("match_brain_items", {
              query_embedding: q as unknown as string,
              match_count: body.recall_count,
            });
            for (const r of data ?? []) {
              if (seen.has(r.id)) continue;
              if ((r.similarity ?? 0) < 0.15) continue;
              seen.add(r.id);
              sources.push({ ...r, selected: false });
            }
          } catch (e) {
            console.error("[brain/translate] recall failed", e);
          }
        }

        const key = await hashKey({ kind: "brain_translate", userId, ...body, ids: [...seen].sort() });
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

        const corpus = sources
          .map((s, i) => {
            const url = s.source_url ? `\nSOURCE URL: ${s.source_url}` : "";
            return `[#${i + 1}] ${s.selected ? "(manually selected)" : "(recalled)"} ${s.title} (${s.language})${url}\n${s.content.slice(0, 6000)}`;
          })
          .join("\n\n---\n\n");

        const system = `You are a senior multilingual editor for a Myanmar-based newsroom.
You translate, synthesize, and rewrite material drawn from the newsroom's shared knowledge base ("second brain") into a chosen publishing format and language.

TARGET LANGUAGE: ${LANG_LABEL[body.target_language]}
TARGET FORMAT: ${FORMAT_RULES[body.target_format]}
TONE: ${TONE_LABEL[body.tone]}

CRITICAL RULES:
1. Output ONLY the final piece in the target language and format. No preamble, no meta commentary, no markdown, no structural labels (no "Intro:", "Body:", "Subject:" except where the format itself requires the subject line as instructed).
2. For Burmese output: modern Unicode only (no Zawgyi). For English output: clear wire-service style.
3. Do NOT invent facts, names, numbers, dates, or quotes. If the source corpus lacks a detail, omit it.
4. Translate concepts faithfully across Burmese and English. Preserve named entities; transliterate Burmese names sensibly when writing in English.
5. Treat (recalled) items as background — only include details directly relevant to the brief. Treat (manually selected) items as primary source material.`;

        const userPrompt = `EDITOR BRIEF:
${body.brief}

KNOWLEDGE BASE EXCERPTS:
${corpus || "(no items provided — write from the brief alone, but state nothing you cannot justify)"}\n
Now produce the ${body.target_format.replace("_", " ")} in ${LANG_LABEL[body.target_language]}. Follow every CRITICAL RULE.`;

        try {
          const out = await generateText({ model, system, prompt: userPrompt });
          const cleaned = cleanNarrative(out.text);
          const result = {
            output: cleaned,
            sources: sources.map((s) => ({
              id: s.id,
              title: s.title,
              source_url: s.source_url,
              language: s.language,
              selected: s.selected,
              similarity: s.similarity,
            })),
            target_format: body.target_format,
            target_language: body.target_language,
            cached: false,
            usage: { used: quota.used, limit: quota.limit, remaining: quota.remaining },
          };
          cacheSet(key, JSON.stringify(result));
          return Response.json(result);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "AI request failed";
          const status = /429/.test(msg) ? 429 : /402/.test(msg) ? 402 : 500;
          return new Response(JSON.stringify({ error: msg }), {
            status,
            headers: { "content-type": "application/json" },
          });
        }
      },
    },
  },
});
