// Simple in-memory LRU-ish cache for AI responses (per server instance).
type Entry = { value: string; expires: number };
const store = new Map<string, Entry>();
const MAX = 200;
const TTL_MS = 1000 * 60 * 30; // 30 min

export function cacheGet(key: string): string | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expires) {
    store.delete(key);
    return null;
  }
  // refresh recency
  store.delete(key);
  store.set(key, e);
  return e.value;
}

export function cacheSet(key: string, value: string) {
  if (store.size >= MAX) {
    const firstKey = store.keys().next().value;
    if (firstKey) store.delete(firstKey);
  }
  store.set(key, { value, expires: Date.now() + TTL_MS });
}

export async function hashKey(obj: unknown): Promise<string> {
  const json = JSON.stringify(obj);
  const data = new TextEncoder().encode(json);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
