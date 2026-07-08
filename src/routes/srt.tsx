import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Captions, Upload, Download, Home } from "lucide-react";
import { Masthead } from "@/components/newsroom/Masthead";
import { AuthGate } from "@/components/newsroom/AuthGate";
import { CopyDownload } from "@/components/newsroom/CopyDownload";

export const Route = createFileRoute("/srt")({
  head: () => ({
    meta: [
      { title: "Burmese SRT Corrector — Newsroom" },
      {
        name: "description",
        content:
          "Upload auto-generated Burmese subtitle files. Fix spelling of names and terms with a shared glossary + AI, and re-wrap lines to broadcast-safe 2 × 42 characters.",
      },
      { property: "og:title", content: "Burmese SRT Corrector — Newsroom" },
      {
        property: "og:description",
        content: "Fix Burmese subtitle spelling and re-wrap lines to broadcast-safe caption widths.",
      },
    ],
  }),
  component: () => (
    <AuthGate>
      <SrtStudio />
    </AuthGate>
  ),
});

type Stats = {
  cues: number;
  glossary_replacements: number;
  ai_fixes: number;
  new_glossary_entries: number;
  overflow_cues: string[];
  glossary_size: number;
  split_cues_added: number;
};

function SrtStudio() {
  const [srt, setSrt] = useState("");
  const [filename, setFilename] = useState<string>("subtitles.srt");
  const [useAi, setUseAi] = useState(true);
  const [maxChars, setMaxChars] = useState(42);
  const [maxLines, setMaxLines] = useState(2);
  const [maxWordsPerLine, setMaxWordsPerLine] = useState(10);
  const [splitLongCues, setSplitLongCues] = useState(true);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("");
  const [stats, setStats] = useState<Stats | null>(null);

  async function onFile(file: File) {
    setFilename(file.name);
    const text = await file.text();
    setSrt(text);
  }

  async function run() {
    setError(null);
    setOutput("");
    setStats(null);
    if (!srt.trim()) {
      setError("Please upload or paste an SRT file.");
      return;
    }
    setLoading(true);
    try {
      const { aiFetch } = await import("@/lib/ai-fetch");
      const res = await aiFetch("/api/srt/correct", {
        method: "POST",
        body: JSON.stringify({
          srt,
          use_ai: useAi,
          max_chars: maxChars,
          max_lines: maxLines,
          max_words_per_line: maxWordsPerLine,
          split_long_cues: splitLongCues,
          extra_notes: notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
        throw new Error(data.error || (res.status === 429 ? "Rate limit reached." : "Correction failed"));
      }
      setOutput(data.corrected_srt);
      setStats(data.stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
      (window as unknown as { __refreshUsage__?: () => void }).__refreshUsage__?.();
    }
  }

  const outFilename = filename.replace(/\.srt$/i, "") + ".corrected.srt";

  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-6xl mx-auto">
      <Masthead />

      <nav className="flex items-center gap-4 border-b-2 border-foreground mb-8 pb-1">
        <div className="px-2 sm:px-4 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-primary">
          <Captions className="w-4 h-4" /> Subtitle Desk
        </div>
        <Link
          to="/"
          className="ml-auto text-sm font-sans text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Home className="w-3.5 h-3.5" /> Newsroom
        </Link>
      </nav>

      <p className="text-sm font-serif text-muted-foreground mb-8 max-w-3xl">
        Upload an auto-generated Burmese <code className="font-mono">.srt</code>. We&apos;ll fix spelling of names,
        places, and political terms using your shared glossary and AI, then re-wrap each cue to broadcast-safe
        widths. Timestamps are never modified. Newly confirmed spellings are added to your workspace glossary.
      </p>

      <section className="grid lg:grid-cols-2 gap-6 lg:gap-8">
        <div className="space-y-5">
          <div className="border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <label className="inline-flex items-center gap-2 text-xs font-sans uppercase tracking-widest cursor-pointer hover:text-primary">
                <Upload className="w-3.5 h-3.5" />
                Upload .srt
                <input
                  type="file"
                  accept=".srt,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onFile(f);
                  }}
                />
              </label>
              <span className="text-xs text-muted-foreground font-sans">
                {srt ? `${srt.length.toLocaleString()} chars · ${filename}` : "no file"}
              </span>
            </div>
            <textarea
              value={srt}
              onChange={(e) => setSrt(e.target.value)}
              placeholder={"1\n00:00:01,000 --> 00:00:04,000\nမြန်မာဘာသာ စာတန်း...\n\n2\n..."}
              className="w-full min-h-[320px] resize-y bg-transparent border-0 p-4 focus:outline-none font-mono text-xs leading-relaxed placeholder:text-muted-foreground/60"
            />
          </div>

          <div className="border border-border bg-card p-4 sm:p-5 space-y-4">
            <label className="flex items-center gap-3 text-sm font-sans">
              <input
                type="checkbox"
                checked={useAi}
                onChange={(e) => setUseAi(e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <span>Use AI spelling review (recommended)</span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                  Max chars / line
                </span>
                <input
                  type="number"
                  min={20}
                  max={80}
                  value={maxChars}
                  onChange={(e) => setMaxChars(Number(e.target.value) || 42)}
                  className="w-full bg-background border border-input px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                  Max lines / cue
                </span>
                <input
                  type="number"
                  min={1}
                  max={3}
                  value={maxLines}
                  onChange={(e) => setMaxLines(Number(e.target.value) || 2)}
                  className="w-full bg-background border border-input px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            </div>

            <div className="grid grid-cols-[1fr_auto] gap-4 items-end">
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                  Max words / line (Netflix style)
                </span>
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={maxWordsPerLine}
                  onChange={(e) => setMaxWordsPerLine(Number(e.target.value) || 10)}
                  className="w-full bg-background border border-input px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-sans pb-2">
                <input
                  type="checkbox"
                  checked={splitLongCues}
                  onChange={(e) => setSplitLongCues(e.target.checked)}
                  className="accent-primary w-4 h-4"
                />
                <span>Split long cues</span>
              </label>
            </div>

            <label className="block">
              <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                Extra notes for the reviewer (optional)
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Speaker is a Yangon politician; prefer official spelling of ministry names."
                className="w-full min-h-[72px] resize-y bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>

          <button
            onClick={run}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans font-semibold uppercase tracking-wider text-sm hover:bg-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Captions className="w-4 h-4" />}
            {loading ? "Correcting…" : "Correct Subtitles"}
          </button>

          {error && (
            <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
              {error}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="border border-border bg-card min-h-[320px]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <span className="text-xs font-sans uppercase tracking-widest">Corrected .srt</span>
              {output && (
                <div className="inline-flex items-center gap-2">
                  <CopyDownload text={output} filename={outFilename} />
                  <a
                    href={URL.createObjectURL(new Blob([output], { type: "application/x-subrip" }))}
                    download={outFilename}
                    className="text-xs font-sans inline-flex items-center gap-1 border border-border px-2 py-1 hover:bg-accent"
                  >
                    <Download className="w-3 h-3" /> .srt
                  </a>
                </div>
              )}
            </div>
            {!output && !loading && (
              <p className="text-muted-foreground italic font-serif text-center py-16 px-4">
                Your corrected subtitle file will appear here.
              </p>
            )}
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin" />
                <p className="text-sm font-sans">Reviewing spelling and re-wrapping cues…</p>
              </div>
            )}
            {output && (
              <pre className="p-4 whitespace-pre-wrap font-mono text-xs leading-relaxed max-h-[520px] overflow-auto">
                {output}
              </pre>
            )}
          </div>

          {stats && (
            <div className="border border-border bg-card p-5">
              <h3 className="font-display text-lg font-bold mb-3">Run summary</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm font-sans">
                <dt className="text-muted-foreground">Cues in output</dt>
                <dd className="font-mono">{stats.cues}</dd>
                <dt className="text-muted-foreground">New cues from splitting</dt>
                <dd className="font-mono">{stats.split_cues_added ?? 0}</dd>
                <dt className="text-muted-foreground">Glossary replacements</dt>
                <dd className="font-mono">{stats.glossary_replacements}</dd>
                <dt className="text-muted-foreground">AI corrections</dt>
                <dd className="font-mono">{stats.ai_fixes}</dd>
                <dt className="text-muted-foreground">New glossary entries</dt>
                <dd className="font-mono">{stats.new_glossary_entries}</dd>
                <dt className="text-muted-foreground">Glossary size</dt>
                <dd className="font-mono">{stats.glossary_size}</dd>
                <dt className="text-muted-foreground">Overflow cues</dt>
                <dd className="font-mono">
                  {stats.overflow_cues.length === 0 ? "0" : stats.overflow_cues.join(", ")}
                </dd>
              </dl>
              {stats.overflow_cues.length > 0 && (
                <p className="mt-3 text-xs font-serif text-muted-foreground">
                  Overflow cues exceed the max chars / line target — content was preserved rather than dropped.
                  Review manually.
                </p>
              )}
              <p className="mt-3 text-xs font-serif text-muted-foreground">
                Confirmed spellings are saved to your shared workspace glossary (tag{" "}
                <code className="font-mono">srt-glossary</code>) and reused on every future run.
              </p>
            </div>
          )}
        </div>
      </section>

      <footer className="mt-16 pt-6 border-t border-border text-center text-xs text-muted-foreground font-sans">
        Subtitle Desk · Timestamps are never modified.
      </footer>
    </main>
  );
}
