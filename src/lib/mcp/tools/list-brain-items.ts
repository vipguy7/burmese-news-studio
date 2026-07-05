import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-for-user";

export default defineTool({
  name: "list_brain_items",
  title: "List brain items",
  description:
    "List the most recent items in the shared newsroom knowledge base ('second brain'). Optionally filter by tag (e.g. 'sport', 'sport-name') or free-text substring match on the title.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).default(20).describe("Max items to return (default 20)."),
    tag: z.string().max(40).optional().describe("Return only items whose tags array contains this tag."),
    title_contains: z.string().max(200).optional().describe("Case-insensitive substring match on title."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, tag, title_contains }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("brain_items")
      .select("id, created_by, title, content, source_url, source_type, language, tags, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (tag) q = q.contains("tags", [tag]);
    if (title_contains) q = q.ilike("title", `%${title_contains}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const items = (data ?? []).map((r) => ({
      ...r,
      content: r.content && r.content.length > 500 ? r.content.slice(0, 500) + "…" : r.content,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify({ items }, null, 2) }],
      structuredContent: { items },
    };
  },
});
