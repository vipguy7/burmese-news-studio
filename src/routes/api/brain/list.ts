import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { getUserIdFromRequest } from "@/lib/ai-quota.server";

export const Route = createFileRoute("/api/brain/list")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Sign in required." }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              order: (c: string, o: { ascending: boolean }) => {
                limit: (n: number) => Promise<{ data: unknown; error: unknown }>;
              };
            };
          };
        };
        const { data, error } = await admin
          .from("brain_items")
          .select("id, created_by, title, content, source_url, source_type, language, tags, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) {
          return new Response(JSON.stringify({ error: String((error as Error).message ?? error) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ items: data, viewer: userId });
      },
    },
  },
});
