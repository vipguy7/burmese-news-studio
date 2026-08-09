import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-for-user";

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

export default defineTool({
  name: "translate_from_brain",
  title: "Translate & rewrite from brain",
  description:
    "Retrieval-augmented generation: pull knowledge-base items (explicitly by id or via semantic recall on the brief) and rewrite them into the chosen publishing format and language. Use for translating Burmese ↔ English and packaging into video script, web article, social post, or newsletter.",
  inputSchema: {
    brief: z.string().min(1).max(4000).describe("What the piece should be about (angle, key facts, audience)."),
    target_format: z.enum(["video_script", "web_article", "social_post", "newsletter"]),
    target_language: z.enum(["burmese-standard", "burmese-long", "english"]),
    tone: z.enum(["professional", "engaging", "neutral"]).default("professional"),
    item_ids: z.array(z.string().uuid()).max(20).default([]).describe("Optional brain_items ids to include as primary sources."),
    use_semantic_recall: z.boolean().default(true).describe("Also recall additional items by vector similarity to the brief."),
    recall_count: z.number().int().min(1).max(10).default(5),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async (
    {
      brief,
      target_format,
      target_language,
      tone = "professional",
      item_ids = [],
      use_semantic_recall = true,
      recall_count = 5,
    },
    ctx,
  ) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { content: [{ type: "text", text: "Server missing LOVABLE_API_KEY" }], isError: true };

    const supabase = supabaseForUser(ctx);
    type Row = {
      id: string;
      title: string;
      content: string;
      source_url: string | null;
      language: string;
      tags: string[] | null;
    };
    const seen = new Set<string>();
    const sources: (Row & { selected: boolean; similarity?: number })[] = [];

    if (item_ids.length) {
      const { data } = await supabase
        .from("brain_items")
        .select("id, title, content, source_url, language, tags")
        .in("id", item_ids);
      for (const r of (data ?? []) as Row[]) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          sources.push({ ...r, selected: true });
        }
      }
    }

    if (use_semantic_recall) {
      try {
        const { embedText } = await import("@/lib/embeddings.server");
        const q = await embedText(brief);
        const { data } = await supabase.rpc("match_brain_items", {
          query_embedding: q as unknown as string,
          match_count: recall_count,
        });
        for (const r of (data ?? []) as (Row & { similarity: number })[]) {
          if (seen.has(r.id)) continue;
          if ((r.similarity ?? 0) < 0.15) continue;
          seen.add(r.id);
          sources.push({ ...r, selected: false, similarity: r.similarity });
        }
      } catch (e) {
        console.error("[mcp translate_from_brain] recall", e);
      }
    }

    const { cleanNarrative } = await import("@/lib/clean-output");
    const { budgetText, BUDGETS, newLedger, runTextJob, verifyAndRepair } = await import(
      "@/lib/ai-pipeline.server"
    );
    const ledger = newLedger();
    const perItem = Math.max(400, Math.floor(BUDGETS.source / Math.max(1, sources.length)));

    const corpus = sources
      .map(
        (s, i) =>
          `[#${i + 1}] ${s.selected ? "(manually selected)" : "(recalled)"} ${s.title} (${s.language})${
            s.source_url ? `\nSOURCE URL: ${s.source_url}` : ""
          }\n${budgetText(s.content, perItem).text}`,
      )
      .join("\n\n---\n\n");

    const system = `You are a senior multilingual editor for a Myanmar-based newsroom.
TARGET LANGUAGE: ${LANG_LABEL[target_language]}
TARGET FORMAT: ${FORMAT_RULES[target_format]}
TONE: ${TONE_LABEL[tone]}

CRITICAL RULES:
1. Output ONLY the final piece in the target language and format. No preamble, no meta commentary, no markdown, no structural labels.
2. For Burmese output: modern Unicode only (no Zawgyi). For English output: clear wire-service style.
3. Do NOT invent facts, names, numbers, dates, or quotes. If the source corpus lacks a detail, omit it.
4. Treat (recalled) items as background; treat (manually selected) items as primary source material.`;

    try {
      const draft = cleanNarrative(
        await runTextJob({
          apiKey,
          job: "draft",
          system,
          prompt: `EDITOR BRIEF:\n${brief}\n\nKNOWLEDGE BASE EXCERPTS:\n${
            corpus || "(none — write only what the brief supports)"
          }\n\nNow produce the ${target_format.replace("_", " ")} in ${LANG_LABEL[target_language]}.`,
          ledger,
        }),
      );
      const verified = await verifyAndRepair({
        apiKey,
        source: corpus,
        draft,
        ledger,
        enabled: sources.length > 0,
      });
      const cleaned = cleanNarrative(verified.text);
      return {
        content: [{ type: "text", text: cleaned }],
        structuredContent: {
          output: cleaned,
          grounding: verified.grounding,
          sources: sources.map((s) => ({
            id: s.id,
            title: s.title,
            source_url: s.source_url,
            language: s.language,
            selected: s.selected,
            similarity: s.similarity,
          })),
        },
      };
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  },
});
