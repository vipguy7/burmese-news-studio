// Server-only hardened URL fetcher (SSRF-safe, size/time/content-type limited).
// Mirrors the logic embedded in /api/generate, reusable across server routes.

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const ALLOWED_PORTS = new Set(["", "80", "443"]);
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml", "text/plain"];

function getAllowlist(): string[] | null {
  const raw = process.env.URL_FETCH_ALLOWLIST?.trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim().toLowerCase().replace(/^\.+/, "")).filter(Boolean);
}
function hostMatchesAllowlist(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((entry) => h === entry || h.endsWith(`.${entry}`));
}
function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 10), parseInt(v4[2], 10)];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 192 && b === 0) return true;
    if (a === 198 && b === 51) return true;
    if (a === 203 && b === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;
  if (lower.startsWith("2001:db8")) return true;
  if (lower.startsWith("64:ff9b::")) return true;
  if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
  return false;
}
async function resolveAndCheck(hostname: string): Promise<void> {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":")) {
    const bare = hostname.replace(/^\[|\]$/g, "");
    if (isPrivateIp(bare)) throw new Error("Blocked: private/internal address");
    return;
  }
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".local") ||
    lower === "metadata.google.internal" ||
    lower === "metadata.goog"
  ) throw new Error("Blocked: internal hostname");
  let resolved = false;
  for (const type of ["A", "AAAA"]) {
    try {
      const r = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) },
      );
      if (!r.ok) continue;
      const j = (await r.json()) as { Answer?: { data: string }[] };
      for (const ans of j.Answer ?? []) {
        if (!ans.data) continue;
        resolved = true;
        if (isPrivateIp(ans.data)) throw new Error("Blocked: resolves to private address");
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Blocked:")) throw e;
    }
  }
  if (!resolved) throw new Error("Blocked: hostname did not resolve");
}

export async function fetchUrlText(rawUrl: string): Promise<string> {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new Error("Could not fetch URL: invalid URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("Could not fetch URL: only http(s) URLs are allowed");
  if (parsed.username || parsed.password)
    throw new Error("Could not fetch URL: credentials in URL not allowed");
  if (!ALLOWED_PORTS.has(parsed.port))
    throw new Error("Could not fetch URL: only standard ports allowed");
  const allowlist = getAllowlist();
  if (allowlist && !hostMatchesAllowlist(parsed.hostname, allowlist))
    throw new Error("Could not fetch URL: host not in allowlist");
  await resolveAndCheck(parsed.hostname);

  try {
    const res = await fetch(parsed.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; NewsroomBot/1.0; +https://lovable.dev)",
        accept: "text/html,application/xhtml+xml,text/plain;q=0.8",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) throw new Error("Redirects are not followed");
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const ctype = (res.headers.get("content-type") || "").toLowerCase();
    if (ctype && !ALLOWED_CONTENT_TYPES.some((c) => ctype.includes(c)))
      throw new Error(`Blocked: unsupported content-type (${ctype})`);
    const declared = Number(res.headers.get("content-length") || "0");
    if (declared && declared > MAX_RESPONSE_BYTES)
      throw new Error("Blocked: response exceeds size limit");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("Fetch failed: empty body");
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          try { await reader.cancel(); } catch { /* ignore */ }
          throw new Error("Blocked: response exceeds size limit");
        }
        chunks.push(value);
      }
    }
    const buf = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
    const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<header[\s\S]*?<\/header>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 18000);
    return (title ? `TITLE: ${title}\n\n` : "") + body;
  } catch (e) {
    throw new Error(`Could not fetch URL: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
