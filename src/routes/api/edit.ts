import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
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

        // Scope cache per-user: prevents cross-user quota bypass + usage leakage.
        const key = await hashKey({ kind: "edit", userId, ...body });
        const cached = cacheGet(key);
        if (cached) return Response.json({ ...JSON.parse(cached), cached: true });

        const quota = await checkAndIncrement(userId);
        if (!quota.ok) {
          return new Response(
            JSON.stringify({ error: quota.reason, used: quota.used, limit: quota.limit }),
            { status: 429, headers: { "content-type": "application/json" } },
          );
        }

        const { budgetText, BUDGETS, newLedger, runTextJob, runJsonJob } =
          await import("@/lib/ai-pipeline.server");
        const ledger = newLedger();
        const draftIn = budgetText(body.text, BUDGETS.source);

        const system = `You are a senior copy editor for a Myanmar newsroom (Mizzima / BBC Burmese / RFA standard).
Your job: proof-edit the user's draft for ${body.language === "burmese" ? "Burmese Unicode consistency (no Zawgyi), Burmese grammar and journalistic register" : "English news register, AP-style clarity"}, pacing, and journalistic impact.

RULES:
- Preserve the writer's facts and intent. Do not invent, add, or remove facts, names, numbers, dates, or quotes.
- Output PURE narrative prose only. No markdown, no headings, no labels, no bullets.
- If the input contained Zawgyi-encoded Burmese, normalize to standard Unicode silently.
- Keep paragraph structure where it serves clarity.`;

        try {
          // Job 1 — copy edit
          const editedClean = cleanNarrative(
            await runTextJob({
              apiKey,
              job: "copy-edit",
              system,
              prompt: `DRAFT:\n${draftIn.text}\n\nReturn the polished version only.`,
              ledger,
            }),
          );

          // Job 2 — change report (budgeted inputs on both sides)
          const analysis = await runJsonJob({
            apiKey,
            job: "change-report",
            system:
              'You analyze two versions of a news draft and list concrete editorial improvements. Output ONLY a JSON object, no markdown. Schema: {"improvements": [{"category": "Unicode"|"Grammar"|"Pacing"|"Clarity"|"Impact"|"Attribution"|"Style", "note": string}], "summary": string}. 1-10 improvements. Be specific, terse, professional.',
            prompt: `ORIGINAL:\n${budgetText(body.text, BUDGETS.draft).text}\n\nEDITED:\n${budgetText(editedClean, BUDGETS.draft).text}\n\nReturn the JSON object now.`,
            fallback: {
              improvements: [] as { category: string; note: string }[],
              summary: "Edits applied for clarity, pacing, and journalistic impact.",
            },
            ledger,
          });

          const result = {
            original: body.text,
            edited: editedClean,
            analysis,
            cached: false,
            pipeline: { jobs: ledger.jobs, tokens: ledger, sourceTruncated: draftIn.truncated },
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
