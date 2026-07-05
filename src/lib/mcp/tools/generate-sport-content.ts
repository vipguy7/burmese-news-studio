import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-for-user";

const TYPE_LABEL: Record<string, string> = {
  match_review:
    "MATCH REVIEW — recap of a finished match. Lead with the result and key moments; end with what it means next.",
  match_preview:
    "MATCH PREVIEW — set the stakes, recent form, key players to watch, likely lineups if mentioned, closer.",
  match_analysis:
    "TACTICAL / MATCH ANALYSIS — how the game was won/lost: formations, pressing, substitutions, manager decisions.",
  highlights: "HIGHLIGHTS RECAP — punchy rundown of standout moments only.",
  player_profile: "PLAYER PROFILE — one player: background, form, role, signature moments.",
  general: "GENERAL SPORTS STORY — transfer news, injury update, federation news, etc.",
};

const TONE_LABEL: Record<string, string> = {
  casual: "casual fan-talk: everyday words, contractions, Myanmar football tea-shop voice",
  hype: "high-energy matchday voice — excited but accurate",
  analytical: "thoughtful pundit voice — conversational with sharp observations",
};

const LANG_INSTR: Record<string, string> = {
  "burmese-casual":
    "Output MUST be Burmese (Myanmar Unicode, no Zawgyi) in casual fan register. Use common Burmese football loanwords fans actually say.",
  english: "Output in clear conversational sports-writing English. Active voice, short paragraphs.",
  bilingual:
    "Output FIRST a faithful casual Burmese (Unicode) version, then a blank line, then '---', then the English version. No labels.",
};

export default defineTool({
  name: "generate_sport_content",
  title: "Generate Burmese sport content",
  description:
    "Take an English (or mixed) sports source URL or raw text and generate a Burmese fan-first football/sports article. Chooses format (match review/preview/analysis/highlights/player profile/general), tone, and language. Uses the shared brain's Burmese sport glossary and name-normalization overrides for consistent club/player spellings.",
  inputSchema: {
    sourceKind: z.enum(["url", "text"]).describe("'url' scrapes the article; 'text' uses the string directly."),
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
    notes: z.string().max(2000).optional().describe("Optional editor notes for angle / must-mentions."),
    use_brain: z.boolean().default(true).describe("Load Burmese sport glossary + name overrides from the brain."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  handler: async (
    { sourceKind, source, contentType, outputLanguage = "burmese-casual", tone = "casual", notes = "", use_brain = true },
    ctx,
  ) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { content: [{ type: "text", text: "Server missing LOVABLE_API_KEY" }], isError: true };

    let sourceText = source;
    if (sourceKind === "url") {
      try {
        const { fetchUrlText } = await import("@/lib/url-fetch.server");
        sourceText = await fetchUrlText(source.trim());
      } catch (e) {
        return { content: [{ type: "text", text: `Fetch failed: ${(e as Error).message}` }], isError: true };
      }
    }

    let brainContext = "";
    const nameOverrides: Record<string, { my: string; short?: string; kind: string }> = {};
    if (use_brain) {
      try {
        const supabase = supabaseForUser(ctx);
        const { data } = await supabase
          .from("brain_items")
          .select("title, content, tags")
          .overlaps("tags", ["sport", "sport-name"])
          .limit(80);
        const glossary: { title: string; content: string }[] = [];
        for (const r of (data ?? []) as { title: string; content: string; tags: string[] | null }[]) {
          if (r.tags?.includes("sport-name")) {
            const [my, short] = r.content.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            if (my) nameOverrides[r.title.trim()] = { my, short: short || undefined, kind: "club" };
          } else {
            glossary.push({ title: r.title, content: r.content });
          }
        }
        if (glossary.length) {
          brainContext = glossary.map((r) => `• ${r.title}: ${r.content.slice(0, 600)}`).join("\n");
        }
      } catch (e) {
        console.error("[mcp generate_sport_content] brain", e);
      }
    }

    const { buildNamePromptTable, normalizeBurmeseNames } = await import("@/lib/sport-name-map");
    const nameTable = buildNamePromptTable(nameOverrides);

    const { generateText } = await import("ai");
    const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway");
    const { cleanNarrative } = await import("@/lib/clean-output");
    const model = createLovableAiGatewayProvider(apiKey)("google/gemini-2.5-flash");

    const system = `You are a Burmese sports writer for a fan-first football/sports outlet.
CONTENT TYPE: ${TYPE_LABEL[contentType]}
VOICE: ${TONE_LABEL[tone]}
LANGUAGE: ${LANG_INSTR[outputLanguage]}

RULES:
1. Translate the *meaning* of the source faithfully — no invented goals/scores/quotes/stats.
2. Output ONLY the finished piece. No labels, no markdown, no meta commentary.
3. NAME CONSISTENCY: When a club/team/competition/stadium/player/manager appears in the NAME NORMALIZATION TABLE below, use the canonical Burmese spelling. Names NOT in the table stay in Latin.${notes ? `\n\nEXTRA EDITOR NOTES: ${notes}` : ""}

NAME NORMALIZATION TABLE (English → canonical Burmese):
${nameTable}`;

    const userPrompt = `${brainContext ? `REFERENCE GLOSSARY & STYLE NOTES:\n${brainContext}\n\n` : ""}SOURCE MATERIAL:\n${sourceText}\n\nNow write the ${contentType.replace("_", " ")}.`;

    try {
      const out = await generateText({ model, system, prompt: userPrompt });
      const raw = cleanNarrative(out.text);
      const cleaned =
        outputLanguage === "english"
          ? raw
          : normalizeBurmeseNames(raw, {
              extra: nameOverrides,
              bilingual: outputLanguage === "bilingual",
            });
      return {
        content: [{ type: "text", text: cleaned }],
        structuredContent: { output: cleaned, contentType, outputLanguage, brainUsed: !!brainContext },
      };
    } catch (e) {
      return { content: [{ type: "text", text: (e as Error).message }], isError: true };
    }
  },
});
