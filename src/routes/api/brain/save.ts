import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/ai-quota.server";

const BodySchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(60000),
  source_url: z.string().url().max(2000).optional().nullable(),
  source_type: z.enum(["text", "url", "note", "transcript"]).default("text"),
  language: z.enum(["burmese", "english", "mixed", "unknown"]).default("unknown"),
  tags: z.array(z.string().max(40)).max(12).default([]),
});

export const Route = createFileRoute("/api/brain/save")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in required." }), {
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

        const { embedText } = await import("@/lib/embeddings.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        let embedding: number[] | null = null;
        try {
          embedding = await embedText(`${body.title}\n\n${body.content}`);
        } catch (e) {
          console.error("[brain/save] embed failed", e);
        }

        const admin = supabaseAdmin as unknown as {
          from: (t: string) => {
            insert: (row: Record<string, unknown>) => {
              select: (cols: string) => { single: () => Promise<{ data: unknown; error: unknown }> };
            };
          };
        };
        const { data, error } = await admin
          .from("brain_items")
          .insert({
            created_by: userId,
            title: body.title,
            content: body.content,
            source_url: body.source_url ?? null,
            source_type: body.source_type,
            language: body.language,
            tags: body.tags,
            embedding: embedding ? (embedding as unknown as string) : null,
          })
          .select("id, title, source_url, source_type, language, tags, created_at")
          .single();

        if (error) {
          return new Response(JSON.stringify({ error: String((error as Error).message ?? error) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ item: data, embedded: !!embedding });
      },
    },
  },
});
