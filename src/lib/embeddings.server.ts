/** Server-only: get a 1536-dim embedding via the Lovable AI Gateway. */
export async function embedText(input: string): Promise<number[]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
  const trimmed = input.slice(0, 8000);
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "vercel-ai-sdk",
    },
    body: JSON.stringify({
      model: "openai/text-embedding-3-small",
      input: trimmed,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { embedding: number[] }[] };
  const vec = json.data?.[0]?.embedding;
  if (!vec || vec.length === 0) throw new Error("Embedding response missing vector");
  return vec;
}
