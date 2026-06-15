import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
  ArrowLeft,
  ExternalLink,
} from "lucide-react";
import { AuthGate } from "@/components/newsroom/AuthGate";
import { CopyDownload } from "@/components/newsroom/CopyDownload";
import { aiFetch } from "@/lib/ai-fetch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/brain")({
  component: () => (
    <AuthGate>
      <BrainPage />
    </AuthGate>
  ),
});

type Item = {
  id: string;
  created_by: string;
  title: string;
  content: string;
  source_url: string | null;
  source_type: "text" | "url" | "note" | "transcript";
  language: "burmese" | "english" | "mixed" | "unknown";
  tags: string[];
  created_at: string;
};

type TranslateResult = {
  output: string;
  sources: {
    id: string;
    title: string;
    source_url: string | null;
    language: string;
    selected: boolean;
    similarity?: number;
  }[];
  target_format: string;
  target_language: string;
  cached?: boolean;
};

const FORMATS = [
  { value: "video_script", label: "Video Narration", hint: "Broadcast-ready spoken script" },
  { value: "web_article", label: "Web Article", hint: "Publishable news prose" },
  { value: "social_post", label: "Social Post", hint: "<280 chars + hashtags" },
  { value: "newsletter", label: "Newsletter", hint: "Subject + email body" },
] as const;

const LANGUAGES = [
  { value: "burmese-standard", label: "Burmese · Standard" },
  { value: "burmese-long", label: "Burmese · Long Form" },
  { value: "english", label: "English" },
] as const;

function BrainPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [viewerId, setViewerId] = useState<string>("");
  const [loadingList, setLoadingList] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Save form
  const [showAdd, setShowAdd] = useState(false);
  const [addTitle, setAddTitle] = useState("");
  const [addContent, setAddContent] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addLang, setAddLang] = useState<Item["language"]>("unknown");
  const [addTags, setAddTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Translate
  const [brief, setBrief] = useState("");
  const [format, setFormat] = useState<(typeof FORMATS)[number]["value"]>("web_article");
  const [lang, setLang] = useState<(typeof LANGUAGES)[number]["value"]>("english");
  const [tone, setTone] = useState<"professional" | "engaging" | "neutral">("professional");
  const [useRecall, setUseRecall] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [result, setResult] = useState<TranslateResult | null>(null);

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const r = await aiFetch("/api/brain/list");
      const d = await r.json();
      if (r.ok) {
        setItems(d.items ?? []);
        setViewerId(d.viewer ?? "");
      }
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.content.toLowerCase().includes(q) ||
        i.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [items, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveItem() {
    setSaveError(null);
    if (!addTitle.trim() || !addContent.trim()) {
      setSaveError("Title and content are required.");
      return;
    }
    setSaving(true);
    try {
      const tags = addTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 12);
      const r = await aiFetch("/api/brain/save", {
        method: "POST",
        body: JSON.stringify({
          title: addTitle.trim(),
          content: addContent.trim(),
          source_url: addUrl.trim() || null,
          source_type: addUrl.trim() ? "url" : "text",
          language: addLang,
          tags,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Save failed");
      setAddTitle("");
      setAddContent("");
      setAddUrl("");
      setAddTags("");
      setAddLang("unknown");
      setShowAdd(false);
      await refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (!confirm("Remove this item from the brain?")) return;
    const r = await aiFetch("/api/brain/delete", {
      method: "POST",
      body: JSON.stringify({ id }),
    });
    if (r.ok) {
      setSelected((p) => {
        const n = new Set(p);
        n.delete(id);
        return n;
      });
      await refresh();
    }
  }

  async function runTranslate() {
    setTranslateError(null);
    setResult(null);
    if (!brief.trim()) {
      setTranslateError("Write a short editor brief first.");
      return;
    }
    setTranslating(true);
    try {
      const r = await aiFetch("/api/brain/translate", {
        method: "POST",
        body: JSON.stringify({
          brief: brief.trim(),
          target_format: format,
          target_language: lang,
          tone,
          item_ids: [...selected],
          use_semantic_recall: useRecall,
          recall_count: 5,
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 402)
          throw new Error("AI credits exhausted. Add credits in Workspace → Usage.");
        throw new Error(d.error || (r.status === 429 ? "Rate limit reached." : "Generation failed"));
      }
      setResult(d);
    } catch (e) {
      setTranslateError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setTranslating(false);
      (window as unknown as { __refreshUsage__?: () => void }).__refreshUsage__?.();
    }
  }

  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-8 pb-4 border-b-2 border-foreground">
        <div className="flex items-center gap-3">
          <Brain className="w-7 h-7 text-primary" />
          <div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-primary font-sans font-semibold">
              Newsroom · Second Brain
            </div>
            <h1 className="font-display text-3xl font-bold leading-none mt-1">Knowledge Studio</h1>
          </div>
        </div>
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm font-sans text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Script Architect
        </Link>
      </header>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Library */}
        <aside className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl font-bold">Shared Library</h2>
            <button
              onClick={() => setShowAdd((v) => !v)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-sans font-medium uppercase tracking-wider border border-border hover:bg-foreground hover:text-background transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> {showAdd ? "Cancel" : "Add"}
            </button>
          </div>

          {showAdd && (
            <div className="border border-border bg-card p-4 space-y-3">
              <input
                value={addTitle}
                onChange={(e) => setAddTitle(e.target.value)}
                placeholder="Title (e.g. Reuters Aug 14 — currency)"
                className="w-full bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <textarea
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
                placeholder="Paste source text, transcript, notes, or article body…"
                className="w-full min-h-[120px] resize-y bg-background border border-input px-3 py-2 font-serif text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <input
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                placeholder="Optional source URL"
                className="w-full bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  value={addLang}
                  onChange={(e) => setAddLang(e.target.value as Item["language"])}
                  className="bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="unknown">Language: unknown</option>
                  <option value="english">English</option>
                  <option value="burmese">Burmese</option>
                  <option value="mixed">Mixed</option>
                </select>
                <input
                  value={addTags}
                  onChange={(e) => setAddTags(e.target.value)}
                  placeholder="tags, comma separated"
                  className="bg-background border border-input px-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              {saveError && (
                <div className="text-xs text-destructive font-sans">{saveError}</div>
              )}
              <button
                onClick={saveItem}
                disabled={saving}
                className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-2.5 font-sans font-semibold text-sm hover:bg-primary transition-colors disabled:opacity-60"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {saving ? "Saving & embedding…" : "Save to Brain"}
              </button>
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter saved items…"
              className="w-full bg-background border border-input pl-8 pr-3 py-2 font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="text-xs text-muted-foreground font-sans">
            {selected.size > 0
              ? `${selected.size} selected as primary source`
              : "Tap items to use as primary sources. Semantic recall will auto-pull related background."}
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {loadingList && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
            {!loadingList && filtered.length === 0 && (
              <p className="text-sm italic font-serif text-muted-foreground text-center py-10">
                {items.length === 0
                  ? "The shared brain is empty. Add the first source above."
                  : "No items match that filter."}
              </p>
            )}
            {filtered.map((item) => {
              const isSel = selected.has(item.id);
              const mine = item.created_by === viewerId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggle(item.id)}
                  className={cn(
                    "w-full text-left border px-3 py-2.5 transition-colors group",
                    isSel
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-foreground/40",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-display text-sm font-semibold leading-snug">
                      {item.title}
                    </div>
                    {mine && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteItem(item.id);
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.stopPropagation();
                            deleteItem(item.id);
                          }
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition cursor-pointer"
                        aria-label="Delete item"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-serif text-muted-foreground mt-1 line-clamp-2">
                    {item.content.slice(0, 200)}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2 text-[10px] uppercase tracking-wider font-sans text-muted-foreground">
                    <span className="px-1.5 py-0.5 border border-border">{item.language}</span>
                    {item.tags.slice(0, 4).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 border border-border">
                        {t}
                      </span>
                    ))}
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 hover:text-foreground"
                      >
                        <ExternalLink className="w-3 h-3" /> link
                      </a>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Translate panel */}
        <section className="lg:col-span-3 space-y-5">
          <h2 className="font-display text-xl font-bold">Write into a Format</h2>
          <div className="border border-border bg-card p-5 space-y-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold mb-2">
                Editor Brief
              </label>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Write a Burmese narration about the September inflation numbers — focus on rice prices and central bank response."
                className="w-full min-h-[100px] resize-y bg-background border border-input px-3 py-2 font-serif text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold mb-2">
                Target Format
              </label>
              <div className="grid grid-cols-2 gap-2">
                {FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    className={cn(
                      "text-left border px-3 py-2 transition-colors",
                      format === f.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-foreground/40",
                    )}
                  >
                    <div className="font-display text-sm font-semibold">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground font-sans">{f.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold mb-2">
                  Target Language
                </label>
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value as typeof lang)}
                  className="w-full bg-background border border-input px-3 py-2 font-sans text-sm"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-muted-foreground font-sans font-semibold mb-2">
                  Tone
                </label>
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value as typeof tone)}
                  className="w-full bg-background border border-input px-3 py-2 font-sans text-sm"
                >
                  <option value="professional">Professional</option>
                  <option value="engaging">Engaging</option>
                  <option value="neutral">Neutral</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-sans text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={useRecall}
                onChange={(e) => setUseRecall(e.target.checked)}
                className="accent-primary"
              />
              Auto-recall related items from the brain
            </label>

            <button
              onClick={runTranslate}
              disabled={translating}
              className="w-full inline-flex items-center justify-center gap-2 bg-foreground text-background py-3 font-sans font-semibold uppercase tracking-wider text-sm hover:bg-primary transition-colors disabled:opacity-60"
            >
              {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
              {translating ? "Composing…" : "Translate into Format"}
            </button>

            {translateError && (
              <div className="border-l-4 border-destructive bg-destructive/5 px-4 py-3 text-sm font-sans text-destructive">
                {translateError}
              </div>
            )}
          </div>

          {result && (
            <article className="border border-border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-border">
                <div className="text-xs uppercase tracking-widest text-muted-foreground font-sans">
                  {result.target_format.replace("_", " ")} · {result.target_language}
                  {result.cached && <span className="ml-2 italic">(cached)</span>}
                </div>
                <CopyDownload text={result.output} filename={`brain-${Date.now()}.txt`} />
              </div>
              <div className="news-prose whitespace-pre-wrap">{result.output}</div>
              {result.sources.length > 0 && (
                <div className="mt-6 pt-4 border-t border-border">
                  <div className="text-[10px] uppercase tracking-widest text-primary font-sans font-semibold mb-2">
                    Sources used
                  </div>
                  <ul className="space-y-1 text-xs font-sans text-muted-foreground">
                    {result.sources.map((s) => (
                      <li key={s.id} className="flex items-center gap-2">
                        <Sparkles
                          className={cn("w-3 h-3", s.selected ? "text-primary" : "text-muted-foreground/50")}
                        />
                        <span>{s.title}</span>
                        {typeof s.similarity === "number" && (
                          <span className="text-muted-foreground/60">
                            · {(s.similarity * 100).toFixed(0)}% match
                          </span>
                        )}
                        {s.source_url && (
                          <a
                            href={s.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 hover:text-foreground"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
          )}
        </section>
      </div>
    </main>
  );
}
