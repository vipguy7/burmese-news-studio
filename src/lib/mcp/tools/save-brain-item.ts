import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser } from "../supabase-for-user";

export default defineTool({
  name: "save_brain_item",
  title: "Save brain item",
  description:
    "Save a new item into the shared newsroom knowledge base ('second brain'). The item becomes available for future semantic recall and format generation.",
  inputSchema: {
    title: z.string().min(1).max(300),
    content: z
      .string()
      .min(1)
      .max(60000)
      .describe("Full text body: notes, transcript, article body, or research."),
    source_url: z.string().url().max(2000).optional().describe("Optional source URL."),
    source_type: z.enum(["text", "url", "note", "transcript"]).default("text"),
    language: z.enum(["burmese", "english", "mixed", "unknown"]).default("unknown"),
    tags: z
      .array(z.string().max(40))
      .max(12)
      .default([])
      .describe("Freeform tags. Use 'sport' or 'sport-name' for sport-desk items."),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (
    { title, content, source_url, source_type = "text", language = "unknown", tags = [] },
    ctx,
  ) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const { embedText } = await import("@/lib/embeddings.server");
    let embedding: number[] | null = null;
    try {
      embedding = await embedText(`${title}\n\n${content}`);
    } catch (e) {
      console.error("[mcp save_brain_item] embed failed", e);
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("brain_items")
      .insert({
        created_by: ctx.getUserId()!,
        title,
        content,
        source_url: source_url ?? null,
        source_type,
        language,
        tags,
        embedding: embedding ? (embedding as unknown as string) : null,
      })
      .select("id, title, source_url, source_type, language, tags, created_at")
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Saved: ${data.id}` }],
      structuredContent: { item: data, embedded: !!embedding },
    };
  },
});
