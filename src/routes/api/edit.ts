import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "@/lib/ai-gateway";
import { cleanNarrative } from "@/lib/clean-output";
import { cacheGet, cacheSet, hashKey } from "@/lib/ai-cache";
import { checkAndIncrement, getUserIdFromRequest } from "@/lib/ai-quota.server";

const BodySchema = z.object({
  text: z.string().min(1).max(60000),
  language: z.enum(["burmese", "english"]).default("burmese"),
});

export const Route = createFileRoute("/api/edit")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) return new Response("Missing LOVABLE_API_KEY", { status: 500 });

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
          return new Response(JSON.stringify({ error: "Invalid request", detail: String(e) }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const key = await hashKey({ kind: "edit", ...body });
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

        const system = `You are a senior copy editor for a Myanmar newsroom (Mizzima / BBC Burmese / RFA standard).
Your job: proof-edit the user's draft for ${body.language === "burmese" ? "Burmese Unicode consistency (no Zawgyi), Burmese grammar and journalistic register" : "English news register, AP-style clarity"}, pacing, and journalistic impact.

RULES:
- Preserve the writer's facts and intent. Do not invent.
- Output PURE narrative prose only. No markdown, no headings, no labels, no bullets.
- If the input contained Zawgyi-encoded Burmese, normalize to standard Unicode silently.
- Keep paragraph structure where it serves clarity.`;

        try {
          const edited = await generateText({
            model,
            system,
            prompt: `DRAFT:\n${body.text}\n\nReturn the polished version only.`,
          });
          const editedClean = cleanNarrative(edited.text);

          const diffRaw = await generateText({
            model,
            system:
              'You analyze two versions of a news draft and list concrete editorial improvements. Output ONLY a JSON object, no markdown. Schema: {"improvements": [{"category": "Unicode"|"Grammar"|"Pacing"|"Clarity"|"Impact"|"Attribution"|"Style", "note": string}], "summary": string}. 1-10 improvements. Be specific, terse, professional.',
            prompt: `ORIGINAL:\n${body.text}\n\nEDITED:\n${editedClean}\n\nReturn the JSON object now.`,
          });
          let analysis: { improvements: { category: string; note: string }[]; summary: string } = {
            improvements: [],
            summary: "Edits applied for clarity, pacing, and journalistic impact.",
          };
          try {
            const raw = diffRaw.text.trim().replace(/^```json\s*|\s*```$/g, "").replace(/^```\s*|\s*```$/g, "");
            const match = raw.match(/\{[\s\S]*\}/);
            if (match) analysis = { ...analysis, ...JSON.parse(match[0]) };
          } catch {
            /* keep defaults */
          }

          const result = {
            original: body.text,
            edited: editedClean,
            analysis,
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
