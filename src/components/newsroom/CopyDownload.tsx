import { Copy, Download, Check } from "lucide-react";
import { useState } from "react";

export function CopyDownload({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans font-medium uppercase tracking-wider border border-border hover:bg-foreground hover:text-background transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        onClick={download}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans font-medium uppercase tracking-wider border border-border hover:bg-foreground hover:text-background transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        .txt
      </button>
    </div>
  );
}
