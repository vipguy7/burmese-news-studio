import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload,
  Play,
  Pause,
  Scissors,
  Plus,
  Trash2,
  Download,
  Home,
  Film,
  Save,
  Wand2,
  Check,
  X,
  Loader2,
} from "lucide-react";
import { Masthead } from "@/components/newsroom/Masthead";
import { AuthGate } from "@/components/newsroom/AuthGate";
import {
  buildEnvelope,
  suggestSplitPoints,
  withSplitTimes,
  DEFAULT_SUGGEST_OPTIONS,
  type Envelope,
  type SplitSuggestion,
} from "@/lib/split-suggest";


export const Route = createFileRoute("/srt-timeline")({
  head: () => ({
    meta: [
      { title: "Subtitle Timeline Editor — Newsroom" },
      {
        name: "description",
        content:
          "Load the source video and its SRT side-by-side. Adjust cue timecodes on an interactive audio waveform, split at the playhead, and export a clean .srt.",
      },
      { property: "og:title", content: "Subtitle Timeline Editor — Newsroom" },
      {
        property: "og:description",
        content: "Interactive audio-waveform SRT editor for precise timecode adjustments.",
      },
    ],
  }),
  component: () => (
    <AuthGate>
      <TimelineStudio />
    </AuthGate>
  ),
});

// -------- SRT helpers ------------------------------------------------------

type Cue = { id: string; start: number; end: number; text: string };

const SRT_BLOCK_RE =
  /(\d+)\s*\n(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*\n(.*?)(?=\n\s*\n|$)/gs;

function tsToSec(s: string): number {
  const m = s.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}
function secToTs(sec: number): string {
  sec = Math.max(0, sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

function parseSrt(text: string): Cue[] {
  const norm = text.replace(/\r\n?/g, "\n").trim() + "\n\n";
  const out: Cue[] = [];
  let i = 0;
  for (const m of norm.matchAll(SRT_BLOCK_RE)) {
    out.push({
      id: `c${Date.now().toString(36)}_${i++}`,
      start: tsToSec(m[2]),
      end: tsToSec(m[3]),
      text: m[4].trim(),
    });
  }
  return out;
}

function renderSrt(cues: Cue[]): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  return (
    sorted
      .map((c, i) => `${i + 1}\n${secToTs(c.start)} --> ${secToTs(c.end)}\n${c.text}`)
      .join("\n\n") + "\n"
  );
}

// -------- Component -------------------------------------------------------

function TimelineStudio() {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoName, setVideoName] = useState<string>("");
  const [srtText, setSrtText] = useState<string>("");
  const [srtName, setSrtName] = useState<string>("subtitles.srt");
  const [cues, setCues] = useState<Cue[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [zoom, setZoom] = useState(80);
  const [error, setError] = useState<string | null>(null);

  // Auto-suggest split points
  const [suggestions, setSuggestions] = useState<SplitSuggestion[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);
  const [minDuration, setMinDuration] = useState(DEFAULT_SUGGEST_OPTIONS.minDuration);
  const [maxWords, setMaxWords] = useState(DEFAULT_SUGGEST_OPTIONS.maxWords);
  const envelopeRef = useRef<Envelope | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const waveContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wavesurferRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regionsRef = useRef<any>(null);
  const cuesRef = useRef<Cue[]>([]);
  cuesRef.current = cues;


  // ---- File handlers
  async function onVideo(file: File) {
    setError(null);
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(URL.createObjectURL(file));
    setVideoName(file.name);
    envelopeRef.current = null;
    setSuggestions([]);
    setAnalyzed(false);
  }
  async function onSrtFile(file: File) {
    setSrtName(file.name);
    const t = await file.text();
    setSrtText(t);
    setCues(parseSrt(t));
    setSuggestions([]);
    setAnalyzed(false);
  }


  // ---- Wavesurfer setup
  useEffect(() => {
    if (!videoUrl || !waveContainerRef.current || !videoRef.current) return;
    let disposed = false;
    let ws: unknown = null;

    (async () => {
      const WaveSurferMod = await import("wavesurfer.js");
      const RegionsMod = await import("wavesurfer.js/dist/plugins/regions.js");
      if (disposed) return;
      const WaveSurfer = WaveSurferMod.default;
      const RegionsPlugin = RegionsMod.default;
      const regions = RegionsPlugin.create();
      const instance = WaveSurfer.create({
        container: waveContainerRef.current!,
        waveColor: "hsl(var(--muted-foreground) / 0.5)",
        progressColor: "hsl(var(--primary))",
        cursorColor: "hsl(var(--foreground))",
        cursorWidth: 2,
        height: 96,
        barWidth: 2,
        barGap: 1,
        barRadius: 1,
        media: videoRef.current!,
        minPxPerSec: zoom,
        plugins: [regions],
      });
      ws = instance;
      wavesurferRef.current = instance;
      regionsRef.current = regions;

      instance.on("ready", () => {
        setDuration(instance.getDuration());
        rebuildRegions();
      });
      instance.on("timeupdate", (t: number) => setCurrentTime(t));
      instance.on("play", () => setPlaying(true));
      instance.on("pause", () => setPlaying(false));

      regions.on("region-updated", (region: { id: string; start: number; end: number }) => {
        setCues((prev) =>
          prev.map((c) => (c.id === region.id ? { ...c, start: region.start, end: region.end } : c)),
        );
      });
      regions.on("region-clicked", (region: { id: string }, e: MouseEvent) => {
        e.stopPropagation();
        setActiveId(region.id);
      });
    })();

    return () => {
      disposed = true;
      try {
        (ws as { destroy: () => void } | null)?.destroy();
      } catch {
        /* noop */
      }
      wavesurferRef.current = null;
      regionsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  // Zoom updates
  useEffect(() => {
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.zoom(zoom);
      } catch {
        /* noop */
      }
    }
  }, [zoom]);

  // ---- Region synchronization
  const rebuildRegions = useCallback(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    regions.clearRegions();
    for (const c of cuesRef.current) {
      regions.addRegion({
        id: c.id,
        start: c.start,
        end: c.end,
        content: c.text.split("\n")[0].slice(0, 40),
        color: "hsl(var(--primary) / 0.18)",
        drag: true,
        resize: true,
      });
    }
  }, []);

  useEffect(() => {
    rebuildRegions();
  }, [cues, rebuildRegions]);

  // ---- Cue operations
  function splitAtPlayhead() {
    const t = currentTime;
    const target = cues.find((c) => t > c.start + 0.05 && t < c.end - 0.05);
    if (!target) {
      setError("Playhead is not inside a cue.");
      return;
    }
    setError(null);
    const words = target.text.split(/\s+/).filter(Boolean);
    const half = Math.max(1, Math.round(words.length / 2));
    const t1 = words.slice(0, half).join(" ");
    const t2 = words.slice(half).join(" ") || target.text;
    const newId = `c${Date.now().toString(36)}`;
    setCues((prev) => {
      const idx = prev.findIndex((c) => c.id === target.id);
      const before = prev.slice(0, idx);
      const after = prev.slice(idx + 1);
      const a: Cue = { ...target, end: t, text: t1 };
      const b: Cue = { id: newId, start: t, end: target.end, text: t2 };
      return [...before, a, b, ...after];
    });
    setActiveId(newId);
  }

  // ---- Auto-suggest split points from the waveform
  async function analyzeSplits() {
    setError(null);
    const ws = wavesurferRef.current;
    if (!ws) {
      setError("Load the source video first.");
      return;
    }
    if (cues.length === 0) {
      setError("Load an .srt first.");
      return;
    }
    setAnalyzing(true);
    try {
      if (!envelopeRef.current) {
        const decoded: AudioBuffer | null = ws.getDecodedData?.() ?? null;
        if (!decoded) {
          setError("Audio is still decoding — try again in a moment.");
          return;
        }
        // Yield a frame so the spinner paints before the heavy loop.
        await new Promise((r) => setTimeout(r, 0));
        envelopeRef.current = buildEnvelope(decoded);
      }
      const found = suggestSplitPoints(cues, envelopeRef.current, {
        ...DEFAULT_SUGGEST_OPTIONS,
        minDuration,
        maxWords,
      });
      setSuggestions(found);
      setAnalyzed(true);
      if (found.length === 0) setError("No long cues need splitting with the current thresholds.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not analyze the audio.");
    } finally {
      setAnalyzing(false);
    }
  }

  function applySuggestion(s: SplitSuggestion) {
    setCues((prev) => {
      const idx = prev.findIndex((c) => c.id === s.cueId);
      if (idx < 0) return prev;
      const base = Date.now().toString(36);
      const made: Cue[] = s.segments.map((seg, i) => ({
        id: i === 0 ? s.cueId : `c${base}_${i}`,
        start: seg.start,
        end: seg.end,
        text: seg.text,
      }));
      return [...prev.slice(0, idx), ...made, ...prev.slice(idx + 1)];
    });
    setSuggestions((prev) => prev.filter((x) => x.cueId !== s.cueId));
    setActiveId(s.cueId);
  }

  function applyAllSuggestions() {
    const list = suggestions;
    setCues((prev) => {
      let next = [...prev];
      for (const s of list) {
        const idx = next.findIndex((c) => c.id === s.cueId);
        if (idx < 0) continue;
        const base = Date.now().toString(36);
        const made: Cue[] = s.segments.map((seg, i) => ({
          id: i === 0 ? s.cueId : `c${base}_${s.cueIndex}_${i}`,
          start: seg.start,
          end: seg.end,
          text: seg.text,
        }));
        next = [...next.slice(0, idx), ...made, ...next.slice(idx + 1)];
      }
      return next;
    });
    setSuggestions([]);
  }

  function dismissSuggestion(cueId: string) {
    setSuggestions((prev) => prev.filter((x) => x.cueId !== cueId));
  }

  function tweakSplit(cueId: string, splitIdx: number, nextTime: number) {
    setSuggestions((prev) =>
      prev.map((s) => {
        if (s.cueId !== cueId) return s;
        const times = [...s.splitTimes];
        times[splitIdx] = Math.round(nextTime * 1000) / 1000;
        return withSplitTimes(s, times);
      }),
    );
  }



  function addCueAtPlayhead() {
    const start = currentTime;
    const end = Math.min(duration || start + 2, start + 2);
    const id = `c${Date.now().toString(36)}`;
    setCues((prev) => [...prev, { id, start, end, text: "" }]);
    setActiveId(id);
  }

  function deleteActive() {
    if (!activeId) return;
    setCues((prev) => prev.filter((c) => c.id !== activeId));
    setActiveId(null);
  }

  function togglePlay() {
    wavesurferRef.current?.playPause();
  }

  function seekTo(sec: number) {
    if (!wavesurferRef.current) return;
    const dur = wavesurferRef.current.getDuration();
    if (dur > 0) wavesurferRef.current.seekTo(Math.max(0, Math.min(sec, dur)) / dur);
  }

  function updateActiveText(text: string) {
    if (!activeId) return;
    setCues((prev) => prev.map((c) => (c.id === activeId ? { ...c, text } : c)));
  }
  function nudgeActive(field: "start" | "end", delta: number) {
    if (!activeId) return;
    setCues((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const next = { ...c, [field]: Math.max(0, c[field] + delta) } as Cue;
        if (next.end <= next.start + 0.05) next.end = next.start + 0.1;
        return next;
      }),
    );
  }

  const activeCue = cues.find((c) => c.id === activeId) || null;
  const outSrt = renderSrt(cues);
  const outName = srtName.replace(/\.srt$/i, "") + ".edited.srt";
  const downloadHref = `data:application/x-subrip;charset=utf-8,${encodeURIComponent(outSrt)}`;

  const sortedForList = [...cues].sort((a, b) => a.start - b.start);

  return (
    <main className="min-h-screen px-4 sm:px-6 lg:px-10 py-6 sm:py-10 max-w-7xl mx-auto">
      <Masthead />

      <nav className="flex items-center gap-2 sm:gap-4 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b-2 border-foreground mb-6 pb-1">
        <div className="shrink-0 px-2 sm:px-4 py-3 -mb-[2px] font-display text-base sm:text-lg font-semibold inline-flex items-center gap-2 border-b-2 border-primary">
          <Film className="w-4 h-4" /> Timeline Editor
        </div>
        <Link
          to="/srt"
          className="shrink-0 text-sm font-sans text-muted-foreground hover:text-foreground"
        >
          Subtitle Desk
        </Link>
        <Link
          to="/"
          className="shrink-0 ml-auto text-sm font-sans text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <Home className="w-3.5 h-3.5" /> Newsroom
        </Link>
      </nav>

      <p className="text-sm font-serif text-muted-foreground mb-6 max-w-3xl">
        Load the source video and its <code className="font-mono">.srt</code>. Cues are drawn as draggable
        regions over the audio waveform — grab an edge to trim, drag the middle to move, or click{" "}
        <b>Split</b> to break a cue at the playhead. Export the adjusted <code className="font-mono">.srt</code>{" "}
        when you&apos;re done.
      </p>

      {/* Upload row */}
      <section className="grid sm:grid-cols-2 gap-4 mb-6">
        <label className="border border-border bg-card px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-accent">
          <Upload className="w-4 h-4" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-widest font-sans">Source video</div>
            <div className="text-xs text-muted-foreground truncate font-mono">
              {videoName || "no file selected"}
            </div>
          </div>
          <input
            type="file"
            accept="video/*,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onVideo(f);
            }}
          />
        </label>
        <label className="border border-border bg-card px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-accent">
          <Upload className="w-4 h-4" />
          <div className="flex-1">
            <div className="text-xs uppercase tracking-widest font-sans">Subtitle .srt</div>
            <div className="text-xs text-muted-foreground truncate font-mono">
              {srtText ? `${srtName} · ${cues.length} cues` : "no file selected"}
            </div>
          </div>
          <input
            type="file"
            accept=".srt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onSrtFile(f);
            }}
          />
        </label>
      </section>

      {/* Video + waveform */}
      <section className="border border-border bg-card mb-4">
        <div className="grid md:grid-cols-[minmax(0,320px)_1fr] gap-0">
          <div className="bg-black flex items-center justify-center min-h-[180px]">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full max-h-[240px]"
                controls={false}
                playsInline
              />
            ) : (
              <div className="text-muted-foreground text-xs font-sans p-6">Load a video to begin.</div>
            )}
          </div>
          <div className="p-3 min-w-0">
            <div
              ref={waveContainerRef}
              className="w-full overflow-x-auto border border-border bg-background"
              style={{ minHeight: 96 }}
            />
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-mono">
              <button
                onClick={togglePlay}
                disabled={!videoUrl}
                className="inline-flex items-center gap-1 border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
              >
                {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                {playing ? "Pause" : "Play"}
              </button>
              <button
                onClick={splitAtPlayhead}
                disabled={!videoUrl || cues.length === 0}
                className="inline-flex items-center gap-1 border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
                title="Split cue at playhead"
              >
                <Scissors className="w-3.5 h-3.5" /> Split
              </button>
              <button
                onClick={analyzeSplits}
                disabled={!videoUrl || cues.length === 0 || analyzing}
                className="inline-flex items-center gap-1 border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
                title="Analyze the waveform for pauses inside long cues"
              >
                {analyzing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {analyzing ? "Analyzing…" : "Suggest splits"}
              </button>

              <button
                onClick={addCueAtPlayhead}
                disabled={!videoUrl}
                className="inline-flex items-center gap-1 border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> Add cue
              </button>
              <button
                onClick={deleteActive}
                disabled={!activeCue}
                className="inline-flex items-center gap-1 border border-border px-3 py-1.5 hover:bg-accent disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
              <span className="ml-auto text-muted-foreground">
                {secToTs(currentTime)} / {secToTs(duration)}
              </span>
              <label className="inline-flex items-center gap-2">
                Zoom
                <input
                  type="range"
                  min={20}
                  max={400}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="accent-primary"
                />
              </label>
            </div>
            {error && (
              <div className="mt-2 border-l-4 border-destructive bg-destructive/5 px-3 py-2 text-xs font-sans text-destructive">
                {error}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Auto-suggested split points */}
      <section className="border border-border bg-card mb-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 sm:px-4 py-2 border-b border-border sm:flex sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Wand2 className="w-3.5 h-3.5 shrink-0 text-primary" />
            <h3 className="truncate text-xs font-sans uppercase tracking-widest">
              Suggested split points{suggestions.length > 0 ? ` (${suggestions.length})` : ""}
            </h3>
          </div>
          {suggestions.length > 0 && (
            <button
              onClick={applyAllSuggestions}
              className="shrink-0 inline-flex items-center gap-1 bg-foreground text-background px-3 py-1.5 font-sans text-xs uppercase tracking-wider hover:bg-primary"
            >
              <Check className="w-3.5 h-3.5" /> Accept all
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-4 px-3 sm:px-4 py-3 border-b border-border">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
              Long cue ≥ (sec)
            </span>
            <input
              type="number"
              min={2}
              max={30}
              step={0.5}
              value={minDuration}
              onChange={(e) => setMinDuration(Number(e.target.value) || 6)}
              className="w-24 bg-background border border-input px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
              Max words / cue
            </span>
            <input
              type="number"
              min={4}
              max={60}
              value={maxWords}
              onChange={(e) => setMaxWords(Number(e.target.value) || 20)}
              className="w-24 bg-background border border-input px-2 py-1 font-mono text-xs"
            />
          </label>
          <p className="text-xs font-serif text-muted-foreground flex-1 min-w-[220px]">
            We scan the audio for pauses and energy drops inside long cues, then propose new time
            ranges. Nudge a split, preview it, then accept.
          </p>
        </div>

        {suggestions.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs font-serif text-muted-foreground">
            {analyzed
              ? "No pending suggestions. Adjust the thresholds and run the analysis again."
              : "Load a video and .srt, then press “Suggest splits” to analyze the waveform."}
          </p>
        ) : (
          <ul className="divide-y divide-border max-h-[420px] overflow-auto">
            {suggestions.map((s) => (
              <li key={s.cueId} className="px-3 sm:px-4 py-3 space-y-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-muted-foreground">
                      #{s.cueIndex + 1} · {secToTs(s.originalStart)} → {secToTs(s.originalEnd)} ·{" "}
                      {s.segments.length} parts
                    </div>
                    <div className="text-[11px] font-sans text-muted-foreground">
                      {s.reason} · confidence{" "}
                      <span
                        className={
                          s.confidence >= 0.6
                            ? "text-primary font-semibold"
                            : "text-muted-foreground font-semibold"
                        }
                      >
                        {Math.round(s.confidence * 100)}%
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => applySuggestion(s)}
                      className="inline-flex items-center gap-1 border border-border px-2 py-1 font-sans text-xs hover:bg-accent"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => dismissSuggestion(s.cueId)}
                      className="inline-flex items-center gap-1 border border-border px-2 py-1 font-sans text-xs hover:bg-accent"
                    >
                      <X className="w-3.5 h-3.5" /> Skip
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {s.splitTimes.map((t, i) => (
                    <div
                      key={i}
                      className="inline-flex items-center gap-1 border border-border bg-background px-2 py-1"
                    >
                      <button
                        onClick={() => tweakSplit(s.cueId, i, t - 0.1)}
                        className="px-1 font-mono text-xs hover:text-primary"
                        title="Move split earlier"
                      >
                        −0.1s
                      </button>
                      <span className="font-mono text-xs">{secToTs(t)}</span>
                      <button
                        onClick={() => tweakSplit(s.cueId, i, t + 0.1)}
                        className="px-1 font-mono text-xs hover:text-primary"
                        title="Move split later"
                      >
                        +0.1s
                      </button>
                      <button
                        onClick={() => seekTo(t)}
                        className="px-1 font-mono text-xs hover:text-primary"
                        title="Preview at this split"
                      >
                        ⏵
                      </button>
                      <button
                        onClick={() => tweakSplit(s.cueId, i, currentTime)}
                        className="px-1 font-sans text-[10px] uppercase tracking-wider hover:text-primary"
                        title="Move this split to the playhead"
                      >
                        set
                      </button>
                    </div>
                  ))}
                </div>

                <ul className="grid gap-1 sm:grid-cols-2">
                  {s.segments.map((seg, i) => (
                    <li key={i} className="border border-border bg-background px-2 py-1">
                      <div className="text-[10px] font-mono text-muted-foreground">
                        {secToTs(seg.start)} → {secToTs(seg.end)} · {(seg.end - seg.start).toFixed(2)}s
                      </div>
                      <div className="text-xs font-mono line-clamp-2 whitespace-pre-wrap">
                        {seg.text || <span className="italic text-muted-foreground">(empty)</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>



      {/* Editor + list */}
      <section className="grid lg:grid-cols-[1fr_minmax(0,360px)] gap-4">
        <div className="border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">
              {activeCue ? "Selected cue" : "No cue selected"}
            </h3>
            {activeCue && (
              <span className="text-xs font-mono text-muted-foreground">id {activeCue.id}</span>
            )}
          </div>
          {activeCue ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                    Start
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => nudgeActive("start", -0.1)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                    >
                      −0.1s
                    </button>
                    <input
                      value={secToTs(activeCue.start)}
                      onChange={(e) => {
                        const v = tsToSec(e.target.value);
                        setCues((prev) => prev.map((c) => (c.id === activeCue.id ? { ...c, start: v } : c)));
                      }}
                      className="flex-1 bg-background border border-input px-2 py-1 font-mono text-xs"
                    />
                    <button
                      onClick={() => nudgeActive("start", 0.1)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                    >
                      +0.1s
                    </button>
                    <button
                      onClick={() => seekTo(activeCue.start)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                      title="Seek"
                    >
                      ⏵
                    </button>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                    End
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => nudgeActive("end", -0.1)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                    >
                      −0.1s
                    </button>
                    <input
                      value={secToTs(activeCue.end)}
                      onChange={(e) => {
                        const v = tsToSec(e.target.value);
                        setCues((prev) => prev.map((c) => (c.id === activeCue.id ? { ...c, end: v } : c)));
                      }}
                      className="flex-1 bg-background border border-input px-2 py-1 font-mono text-xs"
                    />
                    <button
                      onClick={() => nudgeActive("end", 0.1)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                    >
                      +0.1s
                    </button>
                    <button
                      onClick={() => seekTo(activeCue.end)}
                      className="border border-border px-2 py-1 font-mono text-xs hover:bg-accent"
                      title="Seek"
                    >
                      ⏵
                    </button>
                  </div>
                </div>
              </div>
              <label className="block">
                <span className="block text-[10px] uppercase tracking-widest font-sans text-muted-foreground mb-1">
                  Text
                </span>
                <textarea
                  value={activeCue.text}
                  onChange={(e) => updateActiveText(e.target.value)}
                  className="w-full min-h-[80px] bg-background border border-input px-3 py-2 font-mono text-sm"
                />
              </label>
              <p className="text-xs text-muted-foreground font-sans">
                Duration {(activeCue.end - activeCue.start).toFixed(2)}s
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm font-serif">
              Click a region on the waveform, or a row in the cue list, to edit it here.
            </p>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <a
              href={downloadHref}
              download={outName}
              className={`inline-flex items-center gap-1 bg-foreground text-background px-4 py-2 font-sans text-sm uppercase tracking-wider hover:bg-primary ${cues.length === 0 ? "opacity-50 pointer-events-none" : ""}`}
            >
              <Download className="w-3.5 h-3.5" /> Export .srt
            </a>
            <button
              onClick={() => {
                setSrtText(outSrt);
                navigator.clipboard.writeText(outSrt).catch(() => {});
              }}
              disabled={cues.length === 0}
              className="inline-flex items-center gap-1 border border-border px-3 py-2 font-sans text-sm hover:bg-accent disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" /> Copy
            </button>
          </div>
        </div>

        <div className="border border-border bg-card">
          <div className="px-3 py-2 border-b border-border text-xs font-sans uppercase tracking-widest">
            Cues ({cues.length})
          </div>
          <ul className="max-h-[520px] overflow-auto divide-y divide-border">
            {sortedForList.map((c, i) => (
              <li
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  seekTo(c.start);
                }}
                className={`px-3 py-2 cursor-pointer hover:bg-accent ${activeId === c.id ? "bg-accent" : ""}`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                  <span>#{i + 1}</span>
                  <span>
                    {secToTs(c.start)} → {secToTs(c.end)}
                  </span>
                </div>
                <div className="text-xs font-mono whitespace-pre-wrap line-clamp-2">
                  {c.text || <span className="italic text-muted-foreground">(empty)</span>}
                </div>
              </li>
            ))}
            {cues.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-muted-foreground italic">
                Load an .srt to populate the timeline.
              </li>
            )}
          </ul>
        </div>
      </section>

      <footer className="mt-12 pt-6 border-t border-border text-center text-xs text-muted-foreground font-sans">
        Timeline Editor · All processing runs in your browser — the video never leaves your device.
      </footer>
    </main>
  );
}
