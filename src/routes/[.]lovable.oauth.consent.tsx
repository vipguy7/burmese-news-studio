import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

// Supabase's auth-js has `supabase.auth.oauth` in beta; type it locally so we
// don't need to grep node_modules for the exact export.
type OAuthClientInfo = { name?: string; logo_url?: string | null };
type AuthorizationDetails = {
  client?: OAuthClientInfo | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};
type OAuthApi = {
  getAuthorizationDetails: (
    id: string,
  ) => Promise<{ data: AuthorizationDetails | null; error: Error | null }>;
  approveAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: Error | null;
  }>;
  denyAuthorization: (id: string) => Promise<{
    data: { redirect_url?: string; redirect_to?: string } | null;
    error: Error | null;
  }>;
};
function oauth(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  // Browser-only: the Supabase client reads its session from localStorage,
  // which is absent during SSR. Without this the loader runs server-side with
  // no session and bounces every signed-in user.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id") ?? "";
    if (!authorizationId) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    if (!data.session) return { needsAuth: true, details: null, authorizationId };
    const { data: details, error } = await oauth().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    // Already-approved client resolves immediately — bounce.
    const immediate = details?.redirect_url ?? details?.redirect_to;
    if (immediate && !details?.client) throw redirect({ href: immediate });
    return { needsAuth: false, details, authorizationId };
  },
  component: ConsentPage,
  errorComponent: ({ error }) => (
    <main className="min-h-screen flex items-center justify-center px-4 text-center">
      <div className="max-w-md">
        <h1 className="font-display text-2xl font-bold mb-2">Authorization error</h1>
        <p className="text-sm text-muted-foreground">
          {String((error as Error)?.message ?? error)}
        </p>
      </div>
    </main>
  ),
});

function ConsentPage() {
  const initial = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [session, setSession] = useState<Session | null>(null);
  const [details, setDetails] = useState(initial.details);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // After sign-in, fetch authorization details client-side.
  useEffect(() => {
    if (!session || details) return;
    let cancelled = false;
    oauth()
      .getAuthorizationDetails(authorization_id)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return setError(error.message);
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      });
    return () => {
      cancelled = true;
    };
  }, [session, details, authorization_id]);

  async function signIn() {
    setError(null);
    setBusy(true);
    try {
      // Return to THIS consent URL after Google so the same authorization_id resumes.
      const back = `${window.location.origin}/.lovable/oauth/consent?authorization_id=${encodeURIComponent(authorization_id)}`;
      const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: back });
      if (r.error) {
        setError(r.error instanceof Error ? r.error.message : String(r.error));
        setBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setBusy(false);
    }
  }

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorization_id)
      : await oauth().denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full border border-border bg-card p-8 text-center">
          <h1 className="font-display text-2xl font-bold mb-2">Sign in to continue</h1>
          <p className="text-sm text-muted-foreground font-serif mb-6">
            An external app is asking to connect to your Burmese News Studio account. Sign in to
            review the request.
          </p>
          <button
            onClick={signIn}
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-3 bg-foreground text-background py-3 font-sans font-semibold text-sm hover:bg-primary transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Continue with Google
          </button>
          {error && <p className="mt-4 text-sm text-destructive font-sans">{error}</p>}
        </div>
      </main>
    );
  }

  if (!details) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  const clientName = details.client?.name ?? "An external app";
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md w-full border border-border bg-card p-8">
        <h1 className="font-display text-2xl font-bold mb-2">
          Connect <span className="text-primary">{clientName}</span>
        </h1>
        <p className="text-sm text-muted-foreground font-serif mb-6">
          {clientName} will be able to act as you inside Burmese News Studio: read the shared
          knowledge base, save items, translate content, and generate sport articles. You can revoke
          access at any time.
        </p>
        {error && <p className="mb-4 text-sm text-destructive font-sans">{error}</p>}
        <div className="flex gap-3">
          <button
            disabled={busy}
            onClick={() => decide(true)}
            className="flex-1 bg-foreground text-background py-3 font-sans font-semibold text-sm hover:bg-primary transition-colors disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Approve"}
          </button>
          <button
            disabled={busy}
            onClick={() => decide(false)}
            className="flex-1 border border-border py-3 font-sans font-semibold text-sm hover:bg-muted transition-colors disabled:opacity-60"
          >
            Deny
          </button>
        </div>
      </div>
    </main>
  );
}
