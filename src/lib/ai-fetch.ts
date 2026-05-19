import { supabase } from "@/integrations/supabase/client";

/** Fetch wrapper that attaches the current Supabase access token. */
export async function aiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (!headers.has("content-type") && init.body) headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}
