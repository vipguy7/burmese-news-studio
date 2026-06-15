import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { z } from "zod";
import { getUserIdFromRequest } from "@/lib/ai-quota.server";

const Body = z.object({ id: z.string().uuid() });

export const Route = createFileRoute("/api/brain/delete")({
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
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return new Response(JSON.stringify({ error: "Invalid id" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as {
          from: (t: string) => {
            delete: () => {
              eq: (c: string, v: string) => {
                eq: (c: string, v: string) => Promise<{ error: unknown }>;
              };
            };
          };
        };
        // Enforce ownership at the server layer (RLS would too, but admin bypasses RLS).
        const { error } = await admin
          .from("brain_items")
          .delete()
          .eq("id", body.id)
          .eq("created_by", userId);
        if (error) {
          return new Response(JSON.stringify({ error: String((error as Error).message ?? error) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ ok: true });
      },
    },
  },
});
