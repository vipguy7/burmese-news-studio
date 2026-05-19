import { useRef, useState } from "react";
import { Upload, Link as LinkIcon, FileText, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SourceKind = "text" | "url" | "file";

export function SourceInput({
  kind,
  setKind,
  text,
  setText,
  url,
  setUrl,
  files,
  setFiles,
}: {
  kind: SourceKind;
  setKind: (k: SourceKind) => void;
  text: string;
  setText: (s: string) => void;
  url: string;
  setUrl: (s: string) => void;
  files: { name: string; content: string }[];
  setFiles: (f: { name: string; content: string }[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setReading(true);
    const next: { name: string; content: string }[] = [];
    for (const f of Array.from(list)) {
      if (f.size > 5 * 1024 * 1024) continue;
      try {
        if (f.type.startsWith("image/")) {
          next.push({
            name: f.name,
            content: `[Image attached: ${f.name} — describe visual context if relevant]`,
          });
        } else if (f.type === "application/pdf") {
          // Light: read as text fallback; complex PDFs may not yield clean text.
          const buf = await f.arrayBuffer();
          const td = new TextDecoder("utf-8", { fatal: false });
          const raw = td.decode(buf);
          const text = raw
            .replace(/[^\x09\x0A\x0D\x20-\x7E\u1000-\u109F\u00A0-\uFFFF]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 12000);
          next.push({ name: f.name, content: text || `[PDF attached: ${f.name}]` });
        } else {
          const t = await f.text();
          next.push({ name: f.name, content: t.slice(0, 20000) });
        }
      } catch {
        next.push({ name: f.name, content: `[Unreadable: ${f.name}]` });
      }
    }
    setFiles([...files, ...next]);
    setReading(false);
  }

  const tabs: { id: SourceKind; label: string; icon: typeof LinkIcon }[] = [
    { id: "text", label: "Direct Input", icon: FileText },
    { id: "url", label: "URL Scraper", icon: LinkIcon },
    { id: "file", label: "File Upload", icon: Upload },
  ];

  return (
    <div className="border border-border bg-card">
      <div className="flex border-b border-border">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = kind === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setKind(t.id)}
              className={cn(
                "flex-1 px-3 py-3 text-xs sm:text-sm font-sans font-medium uppercase tracking-wider flex items-center justify-center gap-2 transition-colors",
                active
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="p-4 sm:p-5">
        {kind === "text" && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste raw notes, keywords, an outline, or a full draft. Burmese (Unicode) and English supported."
            className="w-full min-h-[200px] sm:min-h-[260px] resize-y bg-transparent border-0 focus:outline-none font-serif text-base leading-relaxed placeholder:text-muted-foreground/60"
          />
        )}

        {kind === "url" && (
          <div className="space-y-3">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.bbc.com/burmese/articles/..."
              className="w-full px-3 py-3 bg-background border border-input font-sans text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-xs text-muted-foreground italic">
              We&apos;ll fetch the article, extract its readable text, and use it as the source brief.
            </p>
          </div>
        )}

        {kind === "file" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-sm py-8 text-center hover:bg-muted/50 transition-colors"
            >
              <Upload className="w-6 h-6 mx-auto mb-2 text-muted-foreground" />
              <div className="text-sm font-sans font-medium">
                {reading ? "Reading files…" : "Click to upload text, PDFs, or images"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Up to 5 MB each · attached as context
              </div>
            </button>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept=".txt,.md,.pdf,.json,.csv,image/*"
              onChange={(e) => handleFiles(e.target.files)}
            />
            {files.length > 0 && (
              <ul className="divide-y divide-border border border-border">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between px-3 py-2 text-sm font-sans">
                    <span className="truncate pr-2">{f.name}</span>
                    <button
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove file"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
