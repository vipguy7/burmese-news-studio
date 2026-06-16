import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Trophy, ArrowLeft, Link as LinkIcon, FileText } from "lucide-react";
import { AuthGate } from "@/components/newsroom/AuthGate";
import { CopyDownload } from "@/components/newsroom/CopyDownload";
import { aiFetch } from "@/lib/ai-fetch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/sport")({
  component: () => (
    <AuthGate>
      <SportPage />
    </AuthGate>
  ),
});

type ContentType =
  | "match_review"
  | "match_preview"
  | "match_analysis"
  | "highlights"
  | "player_profile"
  | "general";

type OutLang = "burmese-casual" | "english" | "bilingual";
type Tone = "casual" | "hype" | "analytical";

type Result = {
  output: string;
  seo: { title: string; metaDescription: string; hashtags: string[] };
  contentType: ContentType;
  outputLanguage: OutLang;
  cached?: boolean;
  brainUsed?: boolean;
};

const TYPES: { id: ContentType; label: string; hint: string }[] = [
  { id: "match_review", label: "Match Review", hint: "Recap a finished game" },
  { id: "match_preview", label: "Match Preview", hint: "Build-up before kickoff" },
  { id: "match_analysis", label: "Match Analysis", hint: "Tactical deep-dive" },
  { id: "highlights", label: "Highlights", hint: "Punchy moments rundown" },
  { id: "player_profile", label: "Player Profile", hint: "Focus on one player" },
  { id: "general", label: "General Story", hint: "Transfers, injuries, news" },
];

function SportPage() {
  const [kind, setKind] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [contentType, setContentType] = useState<ContentType>("match_review");
  const [outLang, setOutLang] = useState<OutLang>("burmese-casual");
  const [tone, setTone] = useState<Tone>("casual");
  const [notes, setNotes] = useState("");
  const [useBrain, setUseBrain] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    const source = kind === "url" ? url.trim() : text.trim();
    if (!source) return setError(kind === "url" ? "Paste a sports article URL." : "Paste source text.");
    setLoading(true);
    try {
      const res = await aiFetch("/api/sport/generate", {
        method: "POST",
        body: JSON.stringify({
          sourceKind: kind, source, contentType,
          outputLanguage: outLang, tone, notes, use_brain: useBrain,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error("AI credits exhausted.");
        throw new Error(data.error || (res.status === 429 ? "Rate limit reached." : "Generation failed"));
      }
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      (window as unknown as { __refreshUsage__?: () => void }).__refreshUsage__?.();
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-sans text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Back to Newsroom
        </Link>
        <Link to="/brain" className="text-sm font-sans text-muted-foreground hover:text-foreground">Second Brain →</Link>
      </div>

      <header className="masthead-rule py-6 mb-8 text-center">
        <div className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-3">
          <Trophy className="w-4 h-4" /> Sport Desk
        </div>
        <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-black tracking-tight leading-none">
          Sport Content Studio
        </h1>
        <p className="mt-3 text-sm sm:text-base italic text-muted-foreground font-serif">
          Drop a link or paste text — get fan-style Burmese match reviews, previews, profiles &amp; more.
        </p>
      </header>

      <section className="grid lg:grid-cols-5 gap-6 lg:gap-8">
        {/* Left: input */}
        <div className="lg:col-span-2 space-y-5">
          <div className="border border-border bg-card">
            <div className="flex border-b border-border">
              {([
                { id: "url" as const, label: "URL", icon: LinkIcon },
                { id: "text" as const, label: "Paste Text", icon: FileText },
              ]).map((t) => {
                const Icon = t.icon;
                const active = kind === t.id;
                return (
                  <button
                    key={t.id} type="button" onClick={() => setKind(t.id)}
                    className={cn(
                      "flex-1 px-3 py-3 text-xs sm:text-sm font-sans font-medium uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-colors",
                      active ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="w-4 h-4" /> {t.label}
                  </button>
                );
              })}
            </div>
            <div className="p-4 sm:p-5">
              {kind === "url" ? (
                <div className="space-y-3">
                  <input
                    type="url" value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.bbc.com/sport/football/..."
                    className="w-full px-3 py-3 bg-background border border-input font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground italic">We&apos;ll scrape the article text, then write your Burmese sports piece.</p>
                </div>
              ) : (
                <textarea
                  value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Paste an English match report, player news, transfer story, etc."
                  className="w-full min-h-[200px] resize-y bg-transparent border-0 focus:outline-none font-serif text-base leading-relaxed placeholder:text-muted-foreground/60"
                />
              )}
            </div>
          </div>

          <div className="border border-border bg-card p-4 sm:p-5 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-sans">Content Type</div>
              <div className="grid grid-cols-2 gap-2">
                {TYPES.map((t) => (
                  <button key={t.id} type="button" onClick={() => setContentType(t.id)}
                    className={cn(
                      "text-left px-3 py-2 border text-xs font-sans transition-colors",
                      contentType === t.id
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-background hover:border-foreground",
                    )}>
                    <div className="font-semibold">{t.label}</div>
                    <div className={cn("text-[10px] mt-0.5", contentType === t.id ? "text-background/70" : "text-muted-foreground")}>{t.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <Field label="Output Language">
              <Seg value={outLang} onChange={(v) => setOutLang(v as OutLang)}
                options={[
                  { value: "burmese-casual", label: "Burmese (Fan style)" },
                  { value: "bilingual", label: "Both" },
                  { value: "english", label: "English" },
                ]} />
            </Field>
            <Field label="Voice">
              <Seg value={tone} onChange={(v) => setTone(v as Tone)}
                options={[
                  { value: "casual", label: "Casual" },
                  { value: "hype", label: "Hype" },
                  { value: "analytical", label: "Analytical" },
                ]} />
            </Field>
            <Field label="Editor Notes (optional)">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. focus on Man City's midfield; keep under 300 words"
                className="w-full min-h-[64px] resize-y bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </Field>
            <label className="flex items-center gap-2 text-xs font-sans text-muted-foreground">
              <input type="checkbox" checked={useBrain} onChange={(e) => setUseBrain(e.target.checked)} />
              Use Sport Brain glossary (Burmese football vocab, club &amp; player names)
            </label>
          </div>

          <button onClick={run} disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans font-semibold uppercase tracking-wider text-sm hover:bg-primary transition-colors disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trophy className="w-4 h-4" />}
            {loading ? "Writing…" : "Generate Sport Content"}
          </button>

          {error && (
            <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">{error}</div>
          )}
        </div>

        {/* Right: output */}
        <div className="lg:col-span-3">
          <article className="border border-border bg-card p-6 sm:p-8 min-h-[320px]">
            {!result && !loading && (
              <p className="text-muted-foreground italic font-serif text-center py-16">
                Your Burmese sports piece will appear here.
              </p>
            )}
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm font-sans">Fetching, translating, and writing…</p>
              </div>
            )}
            {result && (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-border">
                  <div className="text-xs uppercase tracking-widest text-muted-foreground font-sans">
                    {result.contentType.replace("_", " ")} · {result.outputLanguage}
                    {result.brainUsed && <span className="ml-2 italic">· brain-assisted</span>}
                    {result.cached && <span className="ml-2 italic">(cached)</span>}
                  </div>
                  <CopyDownload text={result.output} filename={`sport-${Date.now()}.txt`} />
                </div>
                {result.seo.title && (
                  <h2 className="font-display text-2xl sm:text-3xl font-bold leading-tight mb-4">{result.seo.title}</h2>
                )}
                <div className="prose prose-neutral max-w-none font-serif whitespace-pre-wrap leading-relaxed text-[15px]">
                  {result.output}
                </div>
                {result.seo.hashtags?.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-border flex flex-wrap gap-2">
                    {result.seo.hashtags.map((h, i) => (
                      <span key={i} className="text-xs font-sans px-2 py-1 bg-muted text-foreground">{h}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2 font-sans">{label}</div>
      {children}
    </div>
  );
}
function Seg<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 p-1 bg-muted">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-sans transition-colors",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
