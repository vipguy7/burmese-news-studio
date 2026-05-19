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

/** Check quota and atomically increment if allowed. */
export async function checkAndIncrement(userId: string): Promise<QuotaCheck> {
  const period = currentPeriod();
  const current = await getUsage(userId);
  if (current.remaining <= 0) {
    return { ok: false, ...current, reason: `Monthly limit of ${MONTHLY_FREE_LIMIT} AI requests reached. Resets next month.` };
  }

  const newCount = current.used + 1;
  const { error } = await supabaseAdmin
    .from("ai_usage")
    .upsert(
      { user_id: userId, period_start: period, used_count: newCount, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );
  if (error) {
    return { ok: false, used: current.used, limit: MONTHLY_FREE_LIMIT, remaining: current.remaining, reason: "Could not record usage." };
  }
  return { ok: true, used: newCount, limit: MONTHLY_FREE_LIMIT, remaining: MONTHLY_FREE_LIMIT - newCount };
}
