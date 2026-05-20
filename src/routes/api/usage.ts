import { createFileRoute } from "@tanstack/react-router";
import "@tanstack/react-start";
import { getUsage, getUserIdFromRequest, MONTHLY_FREE_LIMIT } from "@/lib/ai-quota.server";

export const Route = createFileRoute("/api/usage")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const usage = await getUsage(userId);
        return Response.json({ ...usage, limit: MONTHLY_FREE_LIMIT });
      },
    },
  },
});
