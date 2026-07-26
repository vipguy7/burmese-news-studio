/**
 * Audio-driven split-point suggestions for subtitle cues.
 *
 * Runs entirely in the browser on decoded PCM data from wavesurfer.
 * Strategy: build a short-window RMS envelope, find pauses (runs below an
 * adaptive noise floor) and energy drops inside long cues, then propose
 * split times that break the cue into readable segments.
 */

export type SuggestedSegment = {
  start: number;
  end: number;
  text: string;
};

export type SplitSuggestion = {
  cueId: string;
  cueIndex: number;
  originalStart: number;
  originalEnd: number;
  /** Split times inside the cue, ascending. */
  splitTimes: number[];
  /** Resulting segments if accepted. */
  segments: SuggestedSegment[];
  /** 0..1 — how clean the detected pauses are. */
  confidence: number;
  reason: string;
};

export type SuggestOptions = {
  /** Cues longer than this (seconds) are candidates. */
  minDuration: number;
  /** Cues with more words than this are candidates. */
  maxWords: number;
  /** Never create a segment shorter than this. */
  minSegment: number;
};

export const DEFAULT_SUGGEST_OPTIONS: SuggestOptions = {
  minDuration: 6,
  maxWords: 20,
  minSegment: 1.2,
};

const WINDOW_SEC = 0.02;

export type Envelope = {
  rms: Float32Array;
  hop: number; // seconds per bin
  floor: number; // adaptive silence threshold
};

/** Build a 20ms RMS envelope from decoded audio (mono-mixed). */
export function buildEnvelope(buffer: AudioBuffer): Envelope {
  const sr = buffer.sampleRate;
  const win = Math.max(1, Math.round(WINDOW_SEC * sr));
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const frames = Math.floor(buffer.length / win);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const offset = f * win;
    let sum = 0;
    for (let i = 0; i < win; i++) {
      let v = 0;
      for (let c = 0; c < channels.length; c++) v += channels[c][offset + i] || 0;
      v /= channels.length;
      sum += v * v;
    }
    rms[f] = Math.sqrt(sum / win);
  }

  // Adaptive noise floor: 15th percentile of non-zero energy, scaled up.
  const sorted = Array.from(rms).filter((v) => v > 0).sort((a, b) => a - b);
  const p15 = sorted.length ? sorted[Math.floor(sorted.length * 0.15)] : 0;
  const p60 = sorted.length ? sorted[Math.floor(sorted.length * 0.6)] : 0;
  const floor = Math.max(p15 * 2.2, p60 * 0.22, 1e-4);

  return { rms, hop: win / sr, floor };
}

type Pause = { center: number; length: number; depth: number };

/** Find pause candidates (low-energy runs) inside a time window. */
function findPauses(env: Envelope, start: number, end: number): Pause[] {
  const a = Math.max(0, Math.floor(start / env.hop));
  const b = Math.min(env.rms.length - 1, Math.ceil(end / env.hop));
  const out: Pause[] = [];
  let runStart = -1;
  let runMin = Infinity;
  for (let i = a; i <= b; i++) {
    const v = env.rms[i];
    if (v < env.floor) {
      if (runStart < 0) {
        runStart = i;
        runMin = v;
      } else if (v < runMin) runMin = v;
    } else if (runStart >= 0) {
      pushRun(out, env, runStart, i - 1, runMin);
      runStart = -1;
      runMin = Infinity;
    }
  }
  if (runStart >= 0) pushRun(out, env, runStart, b, runMin);
  return out;
}

function pushRun(out: Pause[], env: Envelope, from: number, to: number, minVal: number) {
  const length = (to - from + 1) * env.hop;
  if (length < 0.08) return; // ignore micro gaps
  out.push({
    center: ((from + to) / 2 + 0.5) * env.hop,
    length,
    depth: Math.max(0, 1 - minVal / env.floor),
  });
}

/** Fallback: the lowest-energy instant in a window. */
function lowestEnergyPoint(env: Envelope, start: number, end: number): Pause | null {
  const a = Math.max(0, Math.floor(start / env.hop));
  const b = Math.min(env.rms.length - 1, Math.ceil(end / env.hop));
  if (b <= a) return null;
  let bestIdx = -1;
  let best = Infinity;
  for (let i = a; i <= b; i++) {
    if (env.rms[i] < best) {
      best = env.rms[i];
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return { center: (bestIdx + 0.5) * env.hop, length: env.hop, depth: 0 };
}

function countWords(text: string): number {
  const spaced = text.trim().split(/\s+/).filter(Boolean);
  if (spaced.length > 1) return spaced.length;
  // Burmese and other unspaced scripts: approximate by syllable-ish clusters.
  return Math.max(1, Math.ceil(text.replace(/\s/g, "").length / 4));
}

/** Split a cue's text proportionally to the segment durations. */
function splitTextByRatios(text: string, ratios: number[]): string[] {
  const parts = text.split(/(\s+)/); // keep whitespace so we can rejoin cleanly
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= ratios.length) {
    const out: string[] = [];
    let used = 0;
    for (let i = 0; i < ratios.length; i++) {
      const take =
        i === ratios.length - 1
          ? tokens.length - used
          : Math.max(1, Math.round(tokens.length * ratios[i]));
      out.push(tokens.slice(used, used + take).join(" "));
      used += take;
    }
    return out.map((s, i) => s || tokens[Math.min(i, tokens.length - 1)] || "");
  }
  // Unspaced script — split by character count.
  const chars = parts.join("").trim();
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < ratios.length; i++) {
    const take =
      i === ratios.length - 1 ? chars.length - used : Math.max(1, Math.round(chars.length * ratios[i]));
    out.push(chars.slice(used, used + take).trim());
    used += take;
  }
  return out;
}

export type CueLike = { id: string; start: number; end: number; text: string };

export function suggestSplitPoints(
  cues: CueLike[],
  env: Envelope,
  opts: SuggestOptions = DEFAULT_SUGGEST_OPTIONS,
): SplitSuggestion[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const suggestions: SplitSuggestion[] = [];

  sorted.forEach((cue, index) => {
    const dur = cue.end - cue.start;
    const words = countWords(cue.text);
    const longByTime = dur >= opts.minDuration;
    const longByWords = words > opts.maxWords;
    if (!longByTime && !longByWords) return;
    if (dur < opts.minSegment * 2) return;

    const targetByWords = Math.ceil(words / opts.maxWords);
    const targetByTime = Math.ceil(dur / Math.max(opts.minDuration, opts.minSegment * 2));
    const pieces = Math.min(
      Math.max(2, targetByWords, targetByTime),
      Math.max(2, Math.floor(dur / opts.minSegment)),
    );
    const wanted = pieces - 1;
    if (wanted < 1) return;

    const inner = findPauses(env, cue.start + opts.minSegment, cue.end - opts.minSegment)
      .map((p) => ({ ...p, score: p.length * 2 + p.depth }))
      .sort((a, b) => b.score - a.score);

    const chosen: Pause[] = [];
    for (const p of inner) {
      if (chosen.length >= wanted) break;
      if (chosen.every((c) => Math.abs(c.center - p.center) >= opts.minSegment)) chosen.push(p);
    }

    let usedFallback = false;
    while (chosen.length < wanted) {
      // Fill remaining splits at the quietest instant of the widest gap.
      const marks = [cue.start, ...chosen.map((c) => c.center), cue.end].sort((a, b) => a - b);
      let gapA = marks[0];
      let gapB = marks[1];
      for (let i = 0; i < marks.length - 1; i++) {
        if (marks[i + 1] - marks[i] > gapB - gapA) {
          gapA = marks[i];
          gapB = marks[i + 1];
        }
      }
      if (gapB - gapA < opts.minSegment * 2) break;
      const p = lowestEnergyPoint(env, gapA + opts.minSegment, gapB - opts.minSegment);
      if (!p) break;
      usedFallback = true;
      chosen.push(p);
    }

    if (chosen.length === 0) return;

    const splitTimes = chosen
      .map((c) => Math.round(c.center * 1000) / 1000)
      .sort((a, b) => a - b);

    const bounds = [cue.start, ...splitTimes, cue.end];
    const durations = bounds.slice(1).map((b, i) => b - bounds[i]);
    const total = durations.reduce((s, d) => s + d, 0) || 1;
    const texts = splitTextByRatios(cue.text, durations.map((d) => d / total));
    const segments: SuggestedSegment[] = durations.map((d, i) => ({
      start: bounds[i],
      end: bounds[i + 1],
      text: texts[i] ?? "",
    }));

    const avgLen = chosen.reduce((s, c) => s + c.length, 0) / chosen.length;
    const avgDepth = chosen.reduce((s, c) => s + c.depth, 0) / chosen.length;
    const confidence = usedFallback
      ? Math.min(0.45, 0.2 + avgDepth * 0.25)
      : Math.max(0.3, Math.min(1, avgLen / 0.45) * 0.6 + avgDepth * 0.4);

    suggestions.push({
      cueId: cue.id,
      cueIndex: index,
      originalStart: cue.start,
      originalEnd: cue.end,
      splitTimes,
      segments,
      confidence: Math.round(confidence * 100) / 100,
      reason: usedFallback
        ? `${dur.toFixed(1)}s cue · no clear pause, using quietest point`
        : `${dur.toFixed(1)}s cue · ${chosen.length} pause${chosen.length > 1 ? "s" : ""} detected (avg ${(avgLen * 1000).toFixed(0)}ms)`,
    });
  });

  return suggestions;
}

/** Recompute segments after the user tweaks a split time. */
export function withSplitTimes(s: SplitSuggestion, splitTimes: number[]): SplitSuggestion {
  const clean = [...splitTimes]
    .map((t) => Math.min(Math.max(t, s.originalStart + 0.05), s.originalEnd - 0.05))
    .sort((a, b) => a - b);
  const bounds = [s.originalStart, ...clean, s.originalEnd];
  const durations = bounds.slice(1).map((b, i) => b - bounds[i]);
  const total = durations.reduce((sum, d) => sum + d, 0) || 1;
  const texts = splitTextByRatios(
    s.segments.map((seg) => seg.text).join(" ").trim(),
    durations.map((d) => d / total),
  );
  return {
    ...s,
    splitTimes: clean,
    segments: durations.map((d, i) => ({
      start: bounds[i],
      end: bounds[i + 1],
      text: texts[i] ?? "",
    })),
  };
}
