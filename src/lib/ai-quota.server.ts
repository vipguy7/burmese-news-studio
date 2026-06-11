import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const MONTHLY_FREE_LIMIT = 25;

export type QuotaCheck =
  | { ok: true; used: number; limit: number; remaining: number }
  | { ok: false; used: number; limit: number; remaining: number; reason: string };

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** Authenticate the bearer token and return the user id, or null. */
export async function getUserIdFromRequest(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

/** Read current usage, resetting if a new month has started. */
export async function getUsage(userId: string): Promise<{ used: number; limit: number; remaining: number }> {
  const period = currentPeriod();
  const { data } = await supabaseAdmin
    .from("ai_usage")
    .select("used_count, period_start")
    .eq("user_id", userId)
    .maybeSingle();

  let used = 0;
  if (data) {
    used = data.period_start === period ? data.used_count : 0;
  }
  return { used, limit: MONTHLY_FREE_LIMIT, remaining: Math.max(0, MONTHLY_FREE_LIMIT - used) };
}

/** Atomically check quota and increment if allowed (single SQL statement). */
export async function checkAndIncrement(userId: string): Promise<QuotaCheck> {
  const { data, error } = await supabaseAdmin.rpc("increment_ai_usage", {
    _user_id: userId,
    _limit: MONTHLY_FREE_LIMIT,
  });
  if (error || !data || !Array.isArray(data) || data.length === 0) {
    const current = await getUsage(userId);
    return {
      ok: false,
      used: current.used,
      limit: MONTHLY_FREE_LIMIT,
      remaining: current.remaining,
      reason: "Could not record usage.",
    };
  }
  const row = data[0] as { allowed: boolean; used: number };
  if (!row.allowed) {
    return {
      ok: false,
      used: row.used,
      limit: MONTHLY_FREE_LIMIT,
      remaining: 0,
      reason: `Monthly limit of ${MONTHLY_FREE_LIMIT} AI requests reached. Resets next month.`,
    };
  }
  return {
    ok: true,
    used: row.used,
    limit: MONTHLY_FREE_LIMIT,
    remaining: Math.max(0, MONTHLY_FREE_LIMIT - row.used),
  };
}
