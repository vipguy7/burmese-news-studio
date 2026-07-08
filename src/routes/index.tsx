import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Loader2, Sparkles, ScanText, Hash, Tag, AlignLeft, Brain, Trophy, Captions, Film } from "lucide-react";
import { Masthead } from "@/components/newsroom/Masthead";
import { SourceInput, type SourceKind } from "@/components/newsroom/SourceInput";
import { CopyDownload } from "@/components/newsroom/CopyDownload";
import { AuthGate } from "@/components/newsroom/AuthGate";
import { diffWords } from "@/lib/diff";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: () => (
    <AuthGate>
      <Newsroom />
    </AuthGate>
  ),
});

type Mode = "burmese-standard" | "burmese-long" | "english";
type ScriptType = "video" | "web";
type Tone = "professional" | "engaging" | "neutral";

interface GenerateResult {
  narrative: string;
  seo: {
    title: string;
    metaDescription: string;
    hashtags: string[];
    category: string;
    keywords: string[];
  };
  cached?: boolean;
}

interface EditResult {
  original: string;
  edited: string;
  analysis: {
    improvements: { category: string; note: string }[];
    summary: string;
  };
  cached?: boolean;
}

function Newsroom() {
  const [tab, setTab] = useState<"generate" | "edit">("generate");

  // Generate state
  const [kind, setKind] = useState<SourceKind>("text");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);
  const [mode, setMode] = useState<Mode>("burmese-standard");
  const [scriptType, setScriptType] = useState<ScriptType>("web");
  const [tone, setTone] = useState<Tone>("professional");
  const [instructions, setInstructions] = useState("");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [genResult, setGenResult] = useState<GenerateResult | null>(null);

  // Edit state
  const [draft, setDraft] = useState("");
  const [editLang, setEditLang] = useState<"burmese" | "english">("burmese");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editResult, setEditResult] = useState<EditResult | null>(null);

  async function runGenerate() {
    setGenError(null);
    setGenResult(null);

    let source = "";
    let sourceKind: SourceKind = kind;
    if (kind === "url") {
      if (!url.trim()) return setGenError("Please enter a URL.");
      source = url.trim();
    } else if (kind === "file") {
      sourceKind = "text";
      const combined = files.map((f) => `### ${f.name}\n${f.content}`).join("\n\n");
      source = [combined, text].filter(Boolean).join("\n\n");
      if (!source.trim()) return setGenError("Please attach files or add notes.");
    } else {
      source = text.trim();
      if (!source) return setGenError("Please enter some source text.");
    }

    setGenLoading(true);
    try {
      const { aiFetch } = await import("@/lib/ai-fetch");
      const res = await aiFetch("/api/generate", {
        method: "POST",
        body: JSON.stringify({ mode, scriptType, tone, source, sourceKind, instructions }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
        throw new Error(data.error || (res.status === 429 ? "Rate limit reached." : "Generation failed"));
      }
      setGenResult(data);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setGenLoading(false);
      (window as unknown as { __refreshUsage__?: () => void }).__refreshUsage__?.();
    }
  }

  async function runEdit() {
    setEditError(null);
    setEditResult(null);
    if (!draft.trim()) return setEditError("Please paste a draft to edit.");
    setEditLoading(true);
    try {
      const { aiFetch } = await import("@/lib/ai-fetch");
      const res = await aiFetch("/api/edit", {
        method: "POST",
        body: JSON.stringify({ text: draft.trim(), language: editLang }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 402) throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
        throw new Error(data.error || (res.status === 429 ? "Rate limit reached." : "Edit failed"));
      }
      setEditResult(data);
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setEditLoading(false);
      (window as unknown as { __refreshUsage__?: () => void }).__refreshUsage__?.();
    }
  }

  const diffOps = useMemo(
    () => (editResult ? diffWords(editResult.original, editResult.edited) : []),
    [editResult],
  );

  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-6xl mx-auto">
      <Masthead />

      {/* Tabs */}
      <nav className="flex border-b-2 border-foreground mb-8" role="tablist" aria-label="Newsroom sections">
        {[
          { id: "generate" as const, label: "Script Architect", icon: Sparkles },
          { id: "edit" as const, label: "Proof-Editor", icon: ScanText },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.id)}
              className={cn(
                "px-5 sm:px-8 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 transition-colors",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          );
        })}
        <Link
          to="/sport"
          className="ml-auto px-5 sm:px-8 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Trophy className="w-4 h-4" /> Sport Desk
        </Link>
        <Link
          to="/srt"
          className="px-5 sm:px-8 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Captions className="w-4 h-4" /> Subtitle Desk
        </Link>
        <Link
          to="/srt-timeline"
          className="px-5 sm:px-8 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Film className="w-4 h-4" /> Timeline
        </Link>
        <Link
          to="/brain"
          className="px-5 sm:px-8 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors"
        >
          <Brain className="w-4 h-4" /> Second Brain
        </Link>
      </nav>

      {tab === "generate" && (
        <section className="grid lg:grid-cols-5 gap-6 lg:gap-8">
          {/* Left column: input + controls */}
          <div className="lg:col-span-2 space-y-5">
            <SectionTitle eyebrow="Step 01" title="Source" />
            <SourceInput
              kind={kind}
              setKind={setKind}
              text={text}
              setText={setText}
              url={url}
              setUrl={setUrl}
              files={files}
              setFiles={setFiles}
            />

            <SectionTitle eyebrow="Step 02" title="Editorial Profile" />
            <div className="border border-border bg-card p-4 sm:p-5 space-y-4">
              <Field label="Newsroom Standard">
                <SegmentedControl
                  value={mode}
                  onChange={(v) => setMode(v as Mode)}
                  options={[
                    { value: "burmese-standard", label: "Burmese · Standard" },
                    { value: "burmese-long", label: "Burmese · Long Form" },
                    { value: "english", label: "English" },
                  ]}
                />
              </Field>
              <Field label="Format">
                <SegmentedControl
                  value={scriptType}
                  onChange={(v) => setScriptType(v as ScriptType)}
                  options={[
                    { value: "video", label: "Video News" },
                    { value: "web", label: "Web Post" },
                  ]}
                />
              </Field>
              <Field label="Tone">
                <SegmentedControl
                  value={tone}
                  onChange={(v) => setTone(v as Tone)}
                  options={[
                    { value: "professional", label: "Professional" },
                    { value: "engaging", label: "Engaging" },
                    { value: "neutral", label: "Neutral" },
                  ]}
                />
              </Field>
              <Field label="Editor Notes (optional)">
                <textarea
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="e.g. Emphasize the economic angle; keep under 350 words."
                  className="w-full min-h-[72px] resize-y bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </Field>
            </div>

            <button
              onClick={runGenerate}
              disabled={genLoading}
              className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans font-semibold uppercase tracking-wider text-sm hover:bg-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {genLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {genLoading ? "Drafting…" : "Generate Article"}
            </button>

            {genError && (
              <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
                {genError}
              </div>
            )}
          </div>

          {/* Right column: output */}
          <div className="lg:col-span-3 space-y-6">
            <SectionTitle eyebrow="Step 03" title="The Story" />
            <article className="border border-border bg-card p-6 sm:p-8 min-h-[260px]">
              {!genResult && !genLoading && (
                <p className="text-muted-foreground italic font-serif text-center py-16">
                  Your generated narrative will appear here, ready for broadcast or publication.
                </p>
              )}
              {genLoading && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <p className="text-sm font-sans">Composing in {LABEL[mode]}…</p>
                </div>
              )}
              {genResult && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-border">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground font-sans">
                      {genResult.seo.category} · {LABEL[mode]} · {scriptType === "video" ? "Narration" : "Article"}
                      {genResult.cached && <span className="ml-2 italic">(cached)</span>}
                    </div>
                    <CopyDownload
                      text={genResult.narrative}
                      filename={`newsroom-${Date.now()}.txt`}
                    />
                  </div>
                  <h2 className="font-display text-3xl sm:text-4xl font-bold leading-tight mb-5">
                    {genResult.seo.title}
                  </h2>
                  <div className="news-prose whitespace-pre-wrap">{genResult.narrative}</div>
                </div>
              )}
            </article>

            {genResult && <SeoPanel seo={genResult.seo} />}
          </div>
        </section>
      )}

      {tab === "edit" && (
        <section className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <SectionTitle eyebrow="Input" title="Draft for Review" />
              <div className="border border-border bg-card">
                <div className="flex items-center justify-between px-4 py-2 border-b border-border">
                  <SegmentedControl
                    value={editLang}
                    onChange={(v) => setEditLang(v as "burmese" | "english")}
                    options={[
                      { value: "burmese", label: "Burmese" },
                      { value: "english", label: "English" },
                    ]}
                  />
                  <span className="text-xs text-muted-foreground font-sans">
                    {draft.length.toLocaleString()} chars
                  </span>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Paste your Burmese or English draft here. The proof-editor will normalize Unicode, tighten pacing, and sharpen journalistic impact."
                  className="w-full min-h-[320px] resize-y bg-transparent border-0 p-4 focus:outline-none font-serif text-base leading-relaxed placeholder:text-muted-foreground/60"
                />
              </div>
              <button
                onClick={runEdit}
                disabled={editLoading}
                className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-4 font-sans font-semibold uppercase tracking-wider text-sm hover:bg-primary transition-colors disabled:opacity-60"
              >
                {editLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanText className="w-4 h-4" />}
                {editLoading ? "Analyzing…" : "Run Proof-Editor"}
              </button>
              {editError && (
                <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
                  {editError}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <SectionTitle eyebrow="Output" title="Polished Version" />
              <div className="border border-border bg-card p-4 min-h-[320px]">
                {!editResult && !editLoading && (
                  <p className="text-muted-foreground italic font-serif text-center py-16">
                    The polished text and a list of editorial improvements will appear here.
                  </p>
                )}
                {editLoading && (
                  <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <p className="text-sm font-sans">Editing for clarity, pacing, and impact…</p>
                  </div>
                )}
                {editResult && (
                  <div>
                    <div className="flex items-center justify-end mb-3">
                      <CopyDownload text={editResult.edited} filename={`edited-${Date.now()}.txt`} />
                    </div>
                    <div className="news-prose whitespace-pre-wrap">{editResult.edited}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {editResult && (
            <>
              <div className="border border-border bg-card p-5">
                <h3 className="font-display text-xl font-bold mb-3 flex items-center gap-2">
                  <AlignLeft className="w-5 h-5 text-primary" /> Editor&apos;s Notes
                </h3>
                <p className="news-prose italic mb-4">{editResult.analysis.summary}</p>
                <ul className="grid sm:grid-cols-2 gap-3">
                  {editResult.analysis.improvements.map((imp, i) => (
                    <li key={i} className="border-l-2 border-primary pl-3 py-1">
                      <div className="text-[10px] uppercase tracking-widest text-primary font-sans font-semibold">
                        {imp.category}
                      </div>
                      <div className="text-sm font-serif">{imp.note}</div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border border-border bg-card p-5">
                <h3 className="font-display text-xl font-bold mb-1">Track Changes</h3>
                <p className="text-xs text-muted-foreground font-sans mb-4">
                  Word-level diff — <span className="diff-del">removed</span> ·{" "}
                  <span className="diff-add">added</span>
                </p>
                <div className="news-prose whitespace-pre-wrap">
                  {diffOps.map((op, i) =>
                    op.type === "same" ? (
                      <span key={i}>{op.value}</span>
                    ) : op.type === "add" ? (
                      <span key={i} className="diff-add">
                        {op.value}
                      </span>
                    ) : (
                      <span key={i} className="diff-del">
                        {op.value}
                      </span>
                    ),
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}

      <footer className="mt-16 pt-6 border-t border-border text-center text-xs text-muted-foreground font-sans">
        Newsroom · Built for Myanmar media · All AI output is reviewed by a human editor before publication.
      </footer>
    </main>
  );
}

const LABEL: Record<Mode, string> = {
  "burmese-standard": "Burmese",
  "burmese-long": "Burmese (Long Form)",
  english: "English",
};

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.25em] text-primary font-sans font-semibold">
        {eyebrow}
      </div>
      <h2 className="font-display text-2xl font-bold leading-none mt-1">{title}</h2>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold mb-2">
        {label}
      </label>
      {children}
    </div>
  );
}

function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              "px-2.5 py-2 text-xs font-sans font-medium border transition-colors",
              active
                ? "bg-foreground text-background border-foreground"
                : "border-border text-foreground hover:border-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SeoPanel({ seo }: { seo: GenerateResult["seo"] }) {
  return (
    <div className="border border-border bg-card p-5 sm:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <SectionTitle eyebrow="Step 04" title="SEO Suite" />
        <CopyDownload
          text={`Title: ${seo.title}\n\nMeta: ${seo.metaDescription}\n\nCategory: ${seo.category}\n\nHashtags: ${seo.hashtags.join(" ")}\n\nKeywords: ${seo.keywords.join(", ")}`}
          filename={`seo-${Date.now()}.txt`}
        />
      </div>

      <div>
        <Label icon={Tag}>Title</Label>
        <p className="font-display text-lg font-semibold mt-1">{seo.title}</p>
      </div>
      <div>
        <Label icon={AlignLeft}>Meta Description</Label>
        <p className="font-serif mt-1 text-foreground/85">{seo.metaDescription}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <Label icon={Tag}>Category</Label>
          <span className="inline-block mt-1 px-2.5 py-1 bg-foreground text-background text-xs font-sans uppercase tracking-wider">
            {seo.category}
          </span>
        </div>
        <div>
          <Label icon={Hash}>Hashtags</Label>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {seo.hashtags.map((h, i) => (
              <span key={i} className="text-sm font-sans text-primary">
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Label icon={Hash}>Keywords</Label>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {seo.keywords.map((k, i) => (
            <span
              key={i}
              className="px-2 py-0.5 border border-border text-xs font-sans text-muted-foreground"
            >
              {k}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Label({ icon: Icon, children }: { icon: typeof Hash; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold">
      <Icon className="w-3 h-3" /> {children}
    </div>
  );
}
