import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-for-user";

export default defineTool({
  name: "search_brain_items",
  title: "Semantic search brain items",
  description:
    "Semantic search over the shared newsroom knowledge base using vector similarity. Returns the items most relevant to the query.",
  inputSchema: {
    query: z.string().min(1).max(2000).describe("Natural-language query to match against stored items."),
    match_count: z.number().int().min(1).max(20).default(6).describe("Max items to return."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, match_count }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { embedText } = await import("@/lib/embeddings.server");
    let embedding: number[];
    try {
      embedding = await embedText(query);
    } catch (e) {
      return { content: [{ type: "text", text: `Embedding failed: ${(e as Error).message}` }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.rpc("match_brain_items", {
      query_embedding: embedding as unknown as string,
      match_count,
    });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const matches = (data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      content:
        typeof r.content === "string" && r.content.length > 600
          ? r.content.slice(0, 600) + "…"
          : r.content,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ matches }, null, 2) }],
      structuredContent: { matches },
    };
  },
});
