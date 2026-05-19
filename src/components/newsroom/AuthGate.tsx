import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Loader2, LogOut, Sparkles, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { aiFetch } from "@/lib/ai-fetch";

type Usage = { used: number; limit: number; remaining: number };
const UsageContext_KEY = "__refreshUsage__";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      setLoading(false);
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signIn() {
    setSigningIn(true);
    setError(null);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        setError(result.error instanceof Error ? result.error.message : String(result.error));
        setSigningIn(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
      setSigningIn(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md w-full border border-border bg-card p-8 text-center">
          <Sparkles className="w-8 h-8 mx-auto text-primary mb-3" />
          <h1 className="font-display text-3xl font-bold mb-2">The Newsroom</h1>
          <p className="text-sm text-muted-foreground font-serif mb-6">
            Sign in with Google to access the AI script architect and proof-editor. Your free
            Gemini AI credits are tied to your account.
          </p>
          <button
            onClick={signIn}
            disabled={signingIn}
            className="w-full inline-flex items-center justify-center gap-3 bg-foreground text-background py-3 font-sans font-semibold text-sm hover:bg-primary transition-colors disabled:opacity-60"
          >
            {signingIn ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <GoogleIcon className="w-4 h-4" />
            )}
            Continue with Google
          </button>
          {error && (
            <p className="mt-4 text-sm text-destructive font-sans">{error}</p>
          )}
        </div>
      </main>
    );
  }

  const user = session.user;
  const name = (user.user_metadata?.full_name as string) || user.email || "Signed in";
  const avatar = user.user_metadata?.avatar_url as string | undefined;

  return (
    <>
      <div className="border-b border-border bg-card/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 py-2 flex items-center justify-end gap-3 text-xs font-sans">
          {avatar && (
            <img src={avatar} alt="" className="w-6 h-6 rounded-full" />
          )}
          <span className="text-muted-foreground">{name}</span>
          <button
            onClick={() => supabase.auth.signOut()}
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="w-3 h-3" /> Sign out
          </button>
        </div>
      </div>
      {children}
    </>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5c-2 1.4-4.6 2.3-7.6 2.3-5.2 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.5 5.5C41.9 35.6 44 30.2 44 24c0-1.2-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
