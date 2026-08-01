import { useEffect, useMemo, useState } from "react";
import { SkeletonHistory } from "./Skeleton";
import eventsData from "../data/events.json";
// OutputEvolution removed 2026-06-12 — its visual-story-over-time role is
// now served by the per-point hover thumbnail on the line charts above.
// One mental model, one chart per modality, ~200 px less scroll.

// History tab — the R&D story. For each modality, plot every bench run over
// time and overlay a "best-so-far" envelope so the optimization trajectory is
// visible at a glance. Investor-friendly: shows that we are getting faster.
//
// Data source: /api/inference-benchmarks?mode=recent&limit=3000 (chat + image)
// and /api/inference-bench-video (legacy path). Both are already filtered to
// successful runs server-side via lib/bench-runs.ts.
//
// Event annotations overlay hand-curated milestones (harness/model/infra/
// methodology) as dashed vertical lines on each chart — see src/data/events.json.

interface Run {
  run_dir: string;
  ts: string;
  model_id: string;
  modality: string;
  harness_id?: string;
  status: string;
  tok_s: number;
  duration_s: number;
  contention_at_start?: number | null;
  // From Phase 2 (2026-05-24): keyword-match score + curated footprint.
  // Both surfaced via lib/bench-runs.ts → /api/inference-benchmarks?mode=recent.
  quality_score?: number | null;
  size_gb?: number | null;
  rtf?: number | null;
}

interface VideoRun {
  run_dir: string;
  ts: string;
  variant: string;
  width: number;
  height: number;
  duration_seconds: number;
  wall_seconds: number;
  high_noise_steps: number | null;
  low_noise_steps: number | null;
  lightning_lora: string | null;
}
interface VideoModel { model_id: string; runs?: VideoRun[] }

interface Point {
  ts_ms: number;
  value: number;
  model: string;
  harness: string;
  run_dir: string;
  detail?: string;
}

interface ChartSpec {
  modality: string;
  title: string;
  unit: string;
  higherIsBetter: boolean;
  description: string;
  points: Point[];
  // Optional forward-looking target (e.g. Lightning 4-step LoRA goal: 30s/img).
  // Renders as a dashed horizontal line so investors see where we're aiming.
  // Value is in the same `unit` as points (s/img for images, etc).
  targetValue?: number;
  targetLabel?: string;
}

interface Delta {
  modality: string;
  unitLabel: string;
  firstValue: number;
  bestValue: number;
  pctImprovement: number;   // positive = better
  firstDate: number;
  bestDate: number;
  bestModel: string;
}

type EventCategory = "harness" | "model" | "infra" | "methodology";

interface EventAnnotation {
  ts: string;
  label: string;
  category: EventCategory;
  modality?: string[];
  url?: string;
  color?: string;
}

interface EventsFile {
  schema_version: number;
  events: EventAnnotation[];
}

const EVENT_COLOR: Record<EventCategory, string> = {
  harness:     "#a855f7",
  model:       "#10b981",
  infra:       "#f59e0b",
  methodology: "#06b6d4",
};

const EVENT_SYMBOL: Record<EventCategory, string> = {
  harness:     "▼",
  model:       "★",
  infra:       "⚙",
  methodology: "✎",
};

// Parse the curated events file once. ISO-8601 with `Z` parses cleanly via
// Date.parse — we don't share the `isoToMs` helper because that one decodes
// the bench-dir filename convention (dashes between fields), not real ISO.
const ALL_EVENTS: (EventAnnotation & { tsMs: number })[] = (eventsData as EventsFile).events
  .map(e => ({ ...(e as EventAnnotation), tsMs: Date.parse(e.ts) }))
  .filter(e => Number.isFinite(e.tsMs));

// Pleasant categorical palette — 12 distinct colours. Anything beyond falls
// back to a neutral grey so the chart doesn't get noisy.
const PALETTE = [
  "#10b981", "#6366f1", "#a855f7", "#f59e0b",
  "#ef4444", "#06b6d4", "#ec4899", "#84cc16",
  "#14b8a6", "#f97316", "#8b5cf6", "#0ea5e9",
];

const isoToMs = (iso: string): number => {
  // Two formats in the wild:
  //   chat/image: 2026-05-23T13-22-59Z          (no ms)
  //   video:      2026-05-23T13-22-59-770Z      (with ms; legacy bench dir)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{1,3}))?Z?$/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7] : 0);
};

const fmtDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

const fmtDateTime = (ms: number): string => {
  const d = new Date(ms);
  return `${fmtDate(ms)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`;
};

const fmtMetric = (v: number, unit: string): string => {
  if (unit === "tok/s") return `${v.toFixed(1)} tok/s`;
  if (unit === "s/img") return v < 60 ? `${v.toFixed(1)}s` : `${(v / 60).toFixed(1)}min`;
  if (unit === "µs/px/vid-sec") return v.toFixed(2);
  return v.toFixed(2);
};

const HARNESS_LABEL: Record<string, string> = {
  "llama-cpp-vulkan": "llama.cpp Vulkan",
  "vllm-xpu":         "vLLM-XPU",
  "sglang-xpu":       "sglang-XPU",
  "sd-cpp-vulkan":    "sd.cpp Vulkan",
  "wan-diffusers":    "Wan diffusers",
};

const isContaminated = (r: { contention_at_start?: number | null }): boolean =>
  typeof r.contention_at_start === "number" && r.contention_at_start > 0;

// Bench prompts v2 methodology landed 2026-05-20 (see events.json). Runs from
// before this date used different prompts, different harnesses, and (for text)
// the not-yet-validated Qwen3-0.6B "52 tok/s" peak that visually flat-lined
// the chart. Filter to post-cutoff for the investor view — apples-to-apples.
// Users can opt back in via the "include pre-methodology runs" toggle.
const METHODOLOGY_V2_MS = Date.parse("2026-05-20T00:00:00Z");

export function BenchHistory() {
  const [chatRuns, setChatRuns] = useState<Run[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeContaminated, setIncludeContaminated] = useState(false);
  // Default: hide pre-methodology-v2 runs (mostly unverified Qwen3-0.6B day-1
  // measurements that flat-lined the text chart at "no progress"). Investor
  // view defaults to apples-to-apples comparable runs only.
  const [includePreMethodology, setIncludePreMethodology] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, v] = await Promise.all([
          fetch("/api/inference-benchmarks?mode=recent&limit=3000", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
          fetch("/api/inference-bench-video", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
        ]);
        if (!cancelled) { setChatRuns(c?.runs ?? []); setVideoModels(v?.models ?? []); }
      } catch {
        if (!cancelled) { setChatRuns([]); setVideoModels([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  }, []);

  const okRuns = useMemo(() => chatRuns.filter(r => r.status === "ok"), [chatRuns]);
  const contaminatedCount = useMemo(() => okRuns.filter(isContaminated).length, [okRuns]);
  const preMethodologyCount = useMemo(
    () => okRuns.filter(r => isoToMs(r.ts) < METHODOLOGY_V2_MS).length,
    [okRuns],
  );
  const usableRuns = useMemo(() => {
    let xs = includeContaminated ? okRuns : okRuns.filter(r => !isContaminated(r));
    if (!includePreMethodology) xs = xs.filter(r => isoToMs(r.ts) >= METHODOLOGY_V2_MS);
    return xs;
  }, [okRuns, includeContaminated, includePreMethodology]);

  const charts: ChartSpec[] = useMemo(() => {
    const out: ChartSpec[] = [];

    // Text: tok/s, higher = better
    const textPts: Point[] = [];
    for (const r of usableRuns) {
      if (!["chat", "coding", "agents"].includes(r.modality)) continue;
      if (r.tok_s <= 0) continue;
      const ts = isoToMs(r.ts);
      if (!Number.isFinite(ts)) continue;
      textPts.push({
        ts_ms: ts, value: r.tok_s,
        model: r.model_id, harness: r.harness_id ?? "llama-cpp-vulkan",
        run_dir: r.run_dir,
        detail: `${r.tok_s.toFixed(1)} tok/s`,
      });
    }
    if (textPts.length) out.push({
      modality: "text", title: "Text generation · tok/s over time",
      unit: "tok/s", higherIsBetter: true,
      description: "Every chat/coding/agent bench. Bold line = best ever achieved up to that date.",
      points: textPts,
    });

    // Image: seconds per image, lower = better.
    // 2026-06-12: tightened the duration filter — `undefined <= 0` is false in
    // JS, so prior `r.duration_s <= 0` let null/undefined/NaN through and the
    // "best ever" calc picked them as 0.0s. Use Number.isFinite + > 0 instead.
    const imgPts: Point[] = [];
    for (const r of usableRuns) {
      if (r.modality !== "image") continue;
      if (!Number.isFinite(r.duration_s) || r.duration_s <= 0) continue;
      const ts = isoToMs(r.ts);
      if (!Number.isFinite(ts)) continue;
      imgPts.push({
        ts_ms: ts, value: r.duration_s,
        model: r.model_id, harness: r.harness_id ?? "sd-cpp-vulkan",
        run_dir: r.run_dir,
        detail: r.duration_s < 60 ? `${r.duration_s.toFixed(0)}s` : `${(r.duration_s / 60).toFixed(1)}min`,
      });
    }
    if (imgPts.length) out.push({
      modality: "image", title: "Image generation · seconds per image",
      unit: "s/img", higherIsBetter: false,
      description: "Wall-clock per generated image. Bold line = best (lowest) ever achieved.",
      points: imgPts,
      // Lightning-4steps LoRA target per Sam's 2026-05-25 chat: vllm-omni
      // image-gen at 4 steps instead of 50 = ~30s gens once Sam uploads PEFT.
      targetValue: 30,
      targetLabel: "Lightning 4-step target",
    });

    // Video: µs/pixel/vid-sec (resolution-normalised), lower = better
    const vidPts: Point[] = [];
    for (const m of videoModels) {
      for (const r of m.runs ?? []) {
        const ts = isoToMs(r.ts);
        if (!Number.isFinite(ts)) continue;
        const uspx = (r.wall_seconds * 1_000_000) / (r.width * r.height) / r.duration_seconds;
        if (!Number.isFinite(uspx) || uspx <= 0) continue;
        vidPts.push({
          ts_ms: ts, value: uspx,
          model: m.model_id, harness: r.lightning_lora ? "wan-diffusers · LoRA" : "wan-diffusers",
          run_dir: r.run_dir,
          detail: `${uspx.toFixed(2)} µs/px/vid-sec · ${r.width}×${r.height}`,
        });
      }
    }
    if (vidPts.length) out.push({
      modality: "video", title: "Video generation · µs / pixel / video-sec",
      unit: "µs/px/vid-sec", higherIsBetter: false,
      description: "Resolution-normalised wall time per generated video-second. Bold line = best ever achieved.",
      points: vidPts,
      // Wan2.2 + Lightning LoRA on Vulkan target: 500 µs/px/vid-sec
      // (already achieved once; line shows the floor we're trying to hold).
      targetValue: 500,
      targetLabel: "Lightning LoRA target",
    });

    // Voice (TTS + STT): realtime speedup = audio ÷ wall seconds, higher = better.
    // (Stored on disk as rtf=wall÷audio; we invert here so the chart reads
    // "up-and-right = faster", matching every other history graph.)
    const voicePts: Point[] = [];
    for (const r of usableRuns) {
      if (!["tts", "stt", "voice", "audio"].includes(r.modality)) continue;
      const rtf = r.rtf;
      if (typeof rtf !== "number" || !Number.isFinite(rtf) || rtf <= 0) continue;
      const ts = isoToMs(r.ts);
      if (!Number.isFinite(ts)) continue;
      const speedup = 1 / rtf;
      voicePts.push({
        ts_ms: ts, value: speedup,
        model: r.model_id,
        harness: r.harness_id ?? (r.modality === "stt" ? "whisper-cpp" : "piper"),
        run_dir: r.run_dir,
        detail: `${speedup.toFixed(2)}× realtime · ${r.modality.toUpperCase()}`,
      });
    }
    if (voicePts.length) out.push({
      modality: "voice", title: "Voice · realtime speedup (audio ÷ wall)",
      unit: "× realtime", higherIsBetter: true,
      description: "TTS + STT speed relative to realtime. Above 1× = faster than realtime. Bold line = best (highest) ever.",
      points: voicePts,
      targetValue: 1,
      targetLabel: "realtime (1×)",
    });

    // Upscale: seconds per image, lower = better.
    const upPts: Point[] = [];
    for (const r of usableRuns) {
      // Same defensive filter as image — undefined/NaN durations leak through `<= 0`.
      if (r.modality !== "upscale") continue;
      if (!Number.isFinite(r.duration_s) || r.duration_s <= 0) continue;
      const ts = isoToMs(r.ts);
      if (!Number.isFinite(ts)) continue;
      upPts.push({
        ts_ms: ts, value: r.duration_s,
        model: r.model_id, harness: r.harness_id ?? "realesrgan",
        run_dir: r.run_dir,
        detail: r.duration_s < 60 ? `${r.duration_s.toFixed(1)}s` : `${(r.duration_s / 60).toFixed(1)}min`,
      });
    }
    if (upPts.length) out.push({
      modality: "upscale", title: "Upscale · seconds per image",
      unit: "s/img", higherIsBetter: false,
      description: "Wall-clock per upscaled image (Real-ESRGAN). Bold line = best (lowest) ever.",
      points: upPts,
    });

    return out;
  }, [usableRuns, videoModels]);

  if (loading) return <SkeletonHistory />;
  if (!charts.length) return <div className="text-center text-sm text-white/40 py-12">No bench history yet.</div>;

  const dateRange = (() => {
    const all: number[] = [];
    for (const c of charts) for (const p of c.points) all.push(p.ts_ms);
    if (!all.length) return null;
    return { min: Math.min(...all), max: Math.max(...all), count: all.length };
  })();

  // Per-modality "first ever measurement vs best ever measurement" delta.
  // This is the investor headline — what we measured on day 1 vs today's best.
  // 2026-06-12: filter out non-finite + non-positive values before sorting so
  // a bogus 0/NaN can never win the best-ever race (which was showing 0.0s on
  // the Image card).
  const deltas: Delta[] = charts.flatMap((c) => {
    const valid = c.points.filter((p) => Number.isFinite(p.value) && p.value > 0);
    if (!valid.length) return [];   // skip modality entirely if no valid points
    const sorted = valid.slice().sort((a, b) => a.ts_ms - b.ts_ms);
    const first = sorted[0];
    let best = first;
    for (const p of sorted) {
      const improved = c.higherIsBetter ? p.value > best.value : p.value < best.value;
      if (improved) best = p;
    }
    const pct = c.higherIsBetter
      ? ((best.value - first.value) / first.value) * 100
      : ((first.value - best.value) / first.value) * 100;
    return [{
      modality: c.title.split(" · ")[0],
      unitLabel: c.unit,
      firstValue: first.value, bestValue: best.value,
      pctImprovement: pct,
      firstDate: first.ts_ms, bestDate: best.ts_ms,
      bestModel: best.model,
    }];
  });

  const totalDays = dateRange ? Math.max(1, Math.round((dateRange.max - dateRange.min) / 86400000)) : 0;

  const allRows = usableRuns
    .map(r => ({ ...r, ts_ms: isoToMs(r.ts) }))
    .filter(r => Number.isFinite(r.ts_ms))
    .sort((a, b) => b.ts_ms - a.ts_ms);

  return (
    <div className="space-y-6">
      <div
        className="rounded-2xl p-8 border border-white/[0.08] relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(16,185,129,0.08), rgba(99,102,241,0.10) 50%, rgba(168,85,247,0.08))",
        }}
      >
        <div className="absolute inset-0 opacity-30 pointer-events-none" style={{
          background: "radial-gradient(circle at 80% 0%, rgba(16,185,129,0.25), transparent 50%)",
        }} />
        <div className="relative">
          <div
            className="text-[10px] uppercase tracking-[0.2em] text-emerald-300/80 font-bold mb-2 cursor-help inline-block"
            title='Every benchmark on this Own1 since day one. The bold line on each chart is the best result observed up to that date — the curve that matters when someone asks "is it getting faster?"'
          >R&amp;D Progress · Live ⓘ</div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            {totalDays} days of optimisation. {dateRange ? `${dateRange.count.toLocaleString()} measured runs.` : ""}
          </h1>

          {deltas.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-6">
              {deltas.map((d) => {
                const improved = d.pctImprovement > 0.5;
                const arrow = improved ? "↑" : (d.pctImprovement < -0.5 ? "↓" : "→");
                const tone = improved
                  ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/[0.08]"
                  : d.pctImprovement < -0.5
                    ? "text-rose-300 border-rose-500/30 bg-rose-500/[0.08]"
                    : "text-white/70 border-white/15 bg-white/[0.04]";
                return (
                  <div key={d.modality} className={`rounded-xl border p-4 ${tone}`}>
                    <div className="text-[9px] uppercase tracking-wider opacity-70 font-bold">{d.modality}</div>
                    <div className="flex items-baseline gap-2 mt-1.5">
                      <span className="text-2xl font-mono tabular-nums font-bold">
                        {arrow} {Math.abs(d.pctImprovement).toFixed(0)}%
                      </span>
                      <span className="text-[10px] opacity-60 uppercase tracking-wider">
                        {improved ? "faster" : d.pctImprovement < -0.5 ? "slower" : "stable"}
                      </span>
                    </div>
                    <div className="text-[10px] mt-2 opacity-70 leading-snug font-mono">
                      {fmtMetric(d.firstValue, d.unitLabel)} → <span className="font-bold">{fmtMetric(d.bestValue, d.unitLabel)}</span>
                    </div>
                    <div className="text-[9px] mt-1 opacity-50 leading-snug truncate" title={d.bestModel}>
                      best: {d.bestModel}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-5">
            {preMethodologyCount > 0 && (
              <label className="flex items-center gap-2 text-[10px] text-white/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includePreMethodology}
                  onChange={(e) => setIncludePreMethodology(e.target.checked)}
                  className="accent-cyan-400"
                />
                Include pre-v2-methodology runs ({preMethodologyCount})
                <span className="text-white/30" title="Runs from before 2026-05-20 used different prompts/harnesses than today's bench. Hidden by default for apples-to-apples investor view.">ⓘ</span>
              </label>
            )}
            {contaminatedCount > 0 && (
              <label className="flex items-center gap-2 text-[10px] text-white/50 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={includeContaminated}
                  onChange={(e) => setIncludeContaminated(e.target.checked)}
                  className="accent-amber-400"
                />
                Include contaminated runs ({contaminatedCount})
                <span className="text-white/30" title="Runs where another bench job was inflight at start — measurement unreliable.">ⓘ</span>
              </label>
            )}
          </div>
        </div>
      </div>

      {charts.map((c) => (
        <section
          key={c.modality}
          className="rounded-2xl p-6 border border-white/[0.06]"
          style={{ background: "rgba(20,20,28,0.55)" }}
        >
          <div className="flex items-baseline justify-between mb-4 gap-3">
            <h2 className="text-base font-medium tracking-tight">{c.title}</h2>
            <span
              className="text-[10px] text-white/30 font-mono uppercase tracking-wider cursor-help shrink-0"
              title={c.description}
            >
              {c.points.length} runs · {c.higherIsBetter ? "higher = better" : "lower = better"} ⓘ
            </span>
          </div>
          <Chart spec={c} events={ALL_EVENTS} />
        </section>
      ))}

      <ParetoScatter runs={usableRuns} />


      <section
        className="rounded-2xl p-6 border border-white/[0.06]"
        style={{ background: "rgba(20,20,28,0.55)" }}
      >
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-medium tracking-tight">Raw runs · newest first</h2>
          <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">
            {allRows.length} chat / image runs · video listed separately
          </span>
        </div>
        <div className="overflow-x-auto -mx-2 max-h-[600px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-[rgba(20,20,28,0.95)] text-white/50 uppercase tracking-wider text-[9px]">
              <tr>
                <th className="text-left px-2 py-2 font-medium">When (UTC)</th>
                <th className="text-left px-2 py-2 font-medium">Modality</th>
                <th className="text-left px-2 py-2 font-medium">Model</th>
                <th className="text-left px-2 py-2 font-medium">Harness</th>
                <th className="text-right px-2 py-2 font-medium">Metric</th>
                <th className="text-left px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map(r => {
                const harness = HARNESS_LABEL[r.harness_id ?? "llama-cpp-vulkan"] ?? r.harness_id ?? "—";
                const metric = ["chat", "coding", "agents"].includes(r.modality)
                  ? (r.tok_s > 0 ? `${r.tok_s.toFixed(1)} tok/s` : "—")
                  : r.modality === "image"
                    ? (r.duration_s > 0 ? (r.duration_s < 60 ? `${r.duration_s.toFixed(1)}s` : `${(r.duration_s / 60).toFixed(1)}min`) : "—")
                    : "—";
                return (
                  <tr key={r.run_dir} className="border-t border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-2 py-1.5 text-white/70 font-mono">{fmtDateTime(r.ts_ms)}</td>
                    <td className="px-2 py-1.5 text-white/60">{r.modality}</td>
                    <td className="px-2 py-1.5 text-white/85 truncate max-w-[280px]" title={r.model_id}>{r.model_id}</td>
                    <td className="px-2 py-1.5 text-white/60">{harness}</td>
                    <td className="px-2 py-1.5 text-right text-white/90 font-mono tabular-nums">{metric}</td>
                    <td className="px-2 py-1.5">
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}

// Pareto-frontier scatter: (speed, quality) for every text model. Frontier
// points (non-dominated — no other model is both faster AND higher quality)
// are connected by a bold line; dominated points are dimmer. Dot size encodes
// model footprint (GB). Click → opens the same RunDetailModal as the leaderboard.
//
// Why text-only: quality_score requires expected_keywords (only chat/coding/
// agents have them today). Image/video are visualised by the time-series
// charts above. When voice/STT prompts grow expected_keywords we can extend.
interface ParetoPoint {
  model: string;
  harness: string;
  tok_s: number;       // mean across runs
  quality: number;     // mean keyword-match (0..1)
  size_gb: number | null;
  runs: number;
  representative_run_dir: string;  // for click → modal
  on_frontier: boolean;
}

const computePareto = (pts: { tok_s: number; quality: number }[]): boolean[] => {
  // A point (x, y) is on the frontier if no OTHER point has x' >= x AND y' >= y
  // with strict inequality on at least one axis. Both higher-is-better.
  return pts.map((p, i) =>
    pts.every((q, j) =>
      i === j || !(q.tok_s >= p.tok_s && q.quality >= p.quality && (q.tok_s > p.tok_s || q.quality > p.quality)),
    ),
  );
};

const ParetoScatter = ({ runs }: { runs: Run[] }) => {
  // Aggregate per (model, harness): mean tok_s + mean quality + first size_gb seen + representative run_dir
  const byKey = useMemo(() => {
    const m = new Map<string, {
      model: string; harness: string;
      tokSum: number; tokCount: number;
      qSum: number;   qCount: number;
      size_gb: number | null;
      runs: number;
      newest_run_dir: string;
      newest_ts: string;
    }>();
    for (const r of runs) {
      if (!["chat", "coding", "agents"].includes(r.modality)) continue;
      if (r.tok_s <= 0) continue;
      const harness = r.harness_id ?? "llama-cpp-vulkan";
      const key = `${harness}::${r.model_id}`;
      let cur = m.get(key);
      if (!cur) {
        cur = {
          model: r.model_id, harness,
          tokSum: 0, tokCount: 0, qSum: 0, qCount: 0,
          size_gb: typeof r.size_gb === "number" ? r.size_gb : null,
          runs: 0, newest_run_dir: r.run_dir, newest_ts: r.ts,
        };
        m.set(key, cur);
      }
      cur.tokSum += r.tok_s; cur.tokCount++;
      if (typeof r.quality_score === "number") { cur.qSum += r.quality_score; cur.qCount++; }
      if (cur.size_gb == null && typeof r.size_gb === "number") cur.size_gb = r.size_gb;
      cur.runs++;
      if (r.ts > cur.newest_ts) { cur.newest_ts = r.ts; cur.newest_run_dir = r.run_dir; }
    }
    return m;
  }, [runs]);

  const points = useMemo<ParetoPoint[]>(() => {
    const arr: { model: string; harness: string; tok_s: number; quality: number; size_gb: number | null; runs: number; representative_run_dir: string }[] = [];
    for (const v of byKey.values()) {
      // Skip models with no measurable quality — they can't sit on a Pareto
      // frontier of (speed, quality) by definition.
      if (v.qCount === 0) continue;
      arr.push({
        model: v.model, harness: v.harness,
        tok_s: v.tokSum / v.tokCount,
        quality: v.qSum / v.qCount,
        size_gb: v.size_gb,
        runs: v.runs,
        representative_run_dir: v.newest_run_dir,
      });
    }
    const flags = computePareto(arr);
    return arr.map((p, i) => ({ ...p, on_frontier: flags[i] }));
  }, [byKey]);

  if (points.length < 2) {
    return null;  // Need at least 2 models to draw a frontier
  }

  return (
    <section
      className="rounded-2xl p-6 border border-white/[0.06]"
      style={{ background: "rgba(20,20,28,0.55)" }}
    >
      <div className="flex items-baseline justify-between mb-4 gap-3">
        <h2 className="text-base font-medium tracking-tight">Speed vs Quality · Pareto frontier</h2>
        <span
          className="text-[10px] text-white/30 font-mono uppercase tracking-wider cursor-help shrink-0"
          title="Each dot = one (model · harness) averaged over its bench runs. Models on the Pareto frontier are non-dominated — no other model is both faster AND higher quality. Quality = mean keyword-match across canonical prompts. Dot size = curated footprint (GB)."
        >
          {points.length} models · {points.filter(p => p.on_frontier).length} on frontier ⓘ
        </span>
      </div>
      <ParetoChart points={points} />
    </section>
  );
};

const ParetoChart = ({ points }: { points: ParetoPoint[] }) => {
  const W = 1000, H = 360;
  const PAD_L = 56, PAD_R = 24, PAD_T = 20, PAD_B = 48;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const xs = points.map(p => p.tok_s);
  const xMax = Math.max(...xs) * 1.08;
  const xMin = 0;
  const yMin = 0, yMax = 1;  // quality 0..1

  const x = (v: number): number => PAD_L + (plotW * (v - xMin)) / Math.max(1e-6, xMax - xMin);
  const y = (v: number): number => PAD_T + plotH - (plotH * (v - yMin)) / Math.max(1e-6, yMax - yMin);

  // Dot radius: footprint-driven, 3..9 px. null size_gb → minimum.
  const minSize = 1, maxSize = Math.max(8, ...points.map(p => p.size_gb ?? 1));
  const r = (size_gb: number | null): number => {
    if (size_gb == null) return 3;
    const t = (size_gb - minSize) / Math.max(1, maxSize - minSize);
    return 3 + t * 6;
  };

  // Frontier polyline — sort by tok_s ascending so the line goes left→right.
  const frontier = points.filter(p => p.on_frontier).slice().sort((a, b) => a.tok_s - b.tok_s);
  const frontierD = frontier.length > 1
    ? "M" + frontier.map(p => `${x(p.tok_s)},${y(p.quality)}`).join("L")
    : null;

  // X-axis ticks at 0, 25%, 50%, 75%, 100% of xMax.
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(t => t * xMax);
  // Y-axis ticks at 0, 25, 50, 75, 100%.
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  const [hover, setHover] = useState<ParetoPoint | null>(null);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" style={{ aspectRatio: `${W} / ${H}` }}>
        {/* Quadrant lines */}
        <line x1={PAD_L} y1={PAD_T + plotH / 2} x2={PAD_L + plotW} y2={PAD_T + plotH / 2}
              stroke="rgba(255,255,255,0.04)" strokeDasharray="3,4" />
        <line x1={PAD_L + plotW / 2} y1={PAD_T} x2={PAD_L + plotW / 2} y2={PAD_T + plotH}
              stroke="rgba(255,255,255,0.04)" strokeDasharray="3,4" />

        {/* Y-axis */}
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.12)" />
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L - 4} y1={y(t)} x2={PAD_L} y2={y(t)} stroke="rgba(255,255,255,0.18)" />
            <text x={PAD_L - 8} y={y(t) + 3} textAnchor="end" fill="rgba(255,255,255,0.45)" fontSize="10">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        <text x={16} y={PAD_T + plotH / 2} textAnchor="middle" fill="rgba(255,255,255,0.55)"
              fontSize="11" transform={`rotate(-90 16 ${PAD_T + plotH / 2})`}>
          Quality · keyword match
        </text>

        {/* X-axis */}
        <line x1={PAD_L} y1={PAD_T + plotH} x2={PAD_L + plotW} y2={PAD_T + plotH} stroke="rgba(255,255,255,0.12)" />
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={x(t)} y1={PAD_T + plotH} x2={x(t)} y2={PAD_T + plotH + 4} stroke="rgba(255,255,255,0.18)" />
            <text x={x(t)} y={PAD_T + plotH + 16} textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="10">
              {t.toFixed(1)}
            </text>
          </g>
        ))}
        <text x={PAD_L + plotW / 2} y={H - 8} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="11">
          Speed · tokens / second
        </text>

        {/* Frontier line */}
        {frontierD && (
          <path d={frontierD} fill="none" stroke="#10b981" strokeWidth="2"
                strokeOpacity="0.7" strokeLinecap="round" />
        )}

        {/* Dominated points first (so frontier sits on top) */}
        {points.filter(p => !p.on_frontier).map((p, i) => (
          <circle
            key={`d-${i}`}
            cx={x(p.tok_s)} cy={y(p.quality)} r={r(p.size_gb)}
            fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.35)" strokeWidth="0.5"
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }}
          />
        ))}

        {/* Frontier points last */}
        {points.filter(p => p.on_frontier).map((p, i) => (
          <circle
            key={`f-${i}`}
            cx={x(p.tok_s)} cy={y(p.quality)} r={r(p.size_gb) + 1.5}
            fill="#10b981" stroke="#a7f3d0" strokeWidth="1.2" fillOpacity="0.95"
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }}
          />
        ))}
      </svg>

      {hover && (
        <div
          className="absolute pointer-events-none rounded-md border border-white/15 bg-black/85 backdrop-blur-sm px-2.5 py-1.5 text-[10px] font-mono text-white/85"
          style={{
            left: `${(x(hover.tok_s) / W) * 100}%`,
            top:  `${(y(hover.quality) / H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 12px))",
            whiteSpace: "nowrap",
          }}
        >
          <div className={`uppercase tracking-wider text-[8px] mb-0.5 ${hover.on_frontier ? "text-emerald-300" : "text-white/45"}`}>
            {hover.on_frontier ? "★ Frontier" : "Dominated"}
          </div>
          <div className="text-white/95">{hover.model}</div>
          <div className="text-white/55">{hover.harness}</div>
          <div className="text-white/75 mt-1">
            {hover.tok_s.toFixed(1)} tok/s · {Math.round(hover.quality * 100)}% match
            {hover.size_gb != null && ` · ${hover.size_gb} GB`}
          </div>
          <div className="text-white/35 text-[9px]">{hover.runs} runs</div>
        </div>
      )}
    </div>
  );
};

const Chart = ({
  spec,
  events = [],
}: {
  spec: ChartSpec;
  events?: (EventAnnotation & { tsMs: number })[];
}) => {
  const W = 1000;       // viewBox width
  const H = 320;        // viewBox height
  const PAD_L = 60, PAD_R = 20, PAD_T = 20, PAD_B = 40;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const [hover, setHover] = useState<Point | null>(null);
  // Click a legend row to isolate a series. null = show everything.
  // When isolated, the envelope rebuilds from that series alone so it shows
  // *that model's* trajectory, not just the global best.
  const [isolatedSeries, setIsolatedSeries] = useState<string | null>(null);

  // Axes
  const xs = spec.points.map(p => p.ts_ms);
  const ys = spec.points.map(p => p.value);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = 0;
  let yMax = Math.max(...ys);
  // For low-is-better metrics with a huge range, log-ish scaling would help —
  // but linear is fine for first pass; pad the top by 5%.
  yMax = yMax * 1.05;

  const x = (ts: number): number => PAD_L + (plotW * (ts - xMin)) / Math.max(1, xMax - xMin);
  // INVERT y for lower-is-better metrics. Result: faster gens render at the
  // TOP, slower ones at the BOTTOM — so improvement (lower numbers) shows
  // as the trajectory going UP on screen. Matches investor mental model.
  // Higher-is-better metrics use the natural orientation (high values up).
  const y = (v: number): number => spec.higherIsBetter
    ? PAD_T + plotH - (plotH * (v - yMin)) / Math.max(0.0001, yMax - yMin)
    : PAD_T + (plotH * (v - yMin)) / Math.max(0.0001, yMax - yMin);

  // Per-(model, harness) colours so the same model on a different harness
  // (e.g. Qwen3 on llama.cpp Vulkan vs vllm-omni) gets a distinct series.
  // Same-model-different-harness was previously indistinguishable.
  const seriesKey = (p: { model: string; harness: string }): string => `${p.model}::${p.harness}`;
  const seriesLabel = (key: string): string => {
    const [m, h] = key.split("::");
    const harnessLabel = HARNESS_LABEL[h] ?? h;
    return `${m} · ${harnessLabel}`;
  };
  const series = Array.from(new Set(spec.points.map(seriesKey))).sort();
  const colorFor = (key: string): string => {
    const i = series.indexOf(key);
    if (i < 0 || i >= PALETTE.length) return "#94a3b8";
    return PALETTE[i];
  };

  // Best-so-far envelope. When isolated, build from that series only — so the
  // green line traces *that model's* improvement instead of the global best
  // (which is often pinned by day-1 readings of a different model).
  const envelopePts = isolatedSeries
    ? spec.points.filter(p => seriesKey(p) === isolatedSeries)
    : spec.points;
  const sorted = envelopePts.slice().sort((a, b) => a.ts_ms - b.ts_ms);
  const envelope: { ts_ms: number; value: number }[] = [];
  let best = spec.higherIsBetter ? -Infinity : Infinity;
  for (const p of sorted) {
    const improved = spec.higherIsBetter ? p.value > best : p.value < best;
    if (improved) { best = p.value; envelope.push({ ts_ms: p.ts_ms, value: best }); }
    else {
      envelope.push({ ts_ms: p.ts_ms, value: best });
    }
  }

  // Generate ~5 x-axis ticks (date labels) and 5 y-axis ticks.
  const xTicks = Array.from({ length: 5 }, (_, i) => xMin + (i * (xMax - xMin)) / 4);
  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + (i * (yMax - yMin)) / 4);

  return (
    <div className="space-y-3">
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none">
        {/* Y grid */}
        {yTicks.map((t, i) => (
          <g key={`y${i}`}>
            <line x1={PAD_L} y1={y(t)} x2={W - PAD_R} y2={y(t)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
            <text x={PAD_L - 8} y={y(t)} fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="end" dominantBaseline="middle">
              {fmtMetric(t, spec.unit)}
            </text>
          </g>
        ))}
        {/* X grid */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={x(t)} y1={PAD_T} x2={x(t)} y2={H - PAD_B} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
            <text x={x(t)} y={H - PAD_B + 16} fill="rgba(255,255,255,0.4)" fontSize="10" textAnchor="middle">
              {fmtDate(t)}
            </text>
          </g>
        ))}
        {/* "▲ Better" indicator near the top of the y-axis — clears up the
            up/down ambiguity for lower-is-better charts (where we inverted
            the axis). Always at the top because we always orient so "up =
            improvement" after inversion. */}
        <g style={{ pointerEvents: "none" }}>
          <text x={PAD_L + 8} y={PAD_T + 4} fill="rgba(16,185,129,0.85)" fontSize="10" fontWeight="700" textAnchor="start" dominantBaseline="hanging">
            ▲ Better
          </text>
        </g>
        {/* Forward-looking target line (dashed horizontal) — shows where we
            are aiming. Investor scaffolding: when an upcoming optimisation
            lands (e.g. Lightning LoRA for image-gen), the envelope shoots
            toward this line. Only renders if targetValue + targetLabel set. */}
        {typeof spec.targetValue === "number" && (() => {
          const ty = y(spec.targetValue);
          // Don't render if target is off-chart (above yMax or below 0)
          if (ty < PAD_T - 2 || ty > PAD_T + plotH + 2) return null;
          return (
            <g style={{ pointerEvents: "none" }}>
              <line
                x1={PAD_L} y1={ty} x2={W - PAD_R} y2={ty}
                stroke="rgba(245,158,11,0.55)"
                strokeWidth="1.5"
                strokeDasharray="6 4"
              />
              <rect
                x={W - PAD_R - 168} y={ty - 8} width={166} height={16}
                fill="rgba(20,20,28,0.85)" rx={3}
              />
              <text
                x={W - PAD_R - 6} y={ty + 1}
                fill="rgba(245,158,11,0.95)" fontSize="10" fontWeight="600"
                textAnchor="end" dominantBaseline="middle"
              >
                {spec.targetLabel ?? "Target"}: {fmtMetric(spec.targetValue, spec.unit)}
              </text>
            </g>
          );
        })()}
        {/* Area-fill under best-so-far envelope — drawn FIRST so it sits
            under the dots and doesn't swallow hover events. pointer-events
            none on every envelope element so the hit-targets below them
            always win. */}
        {envelope.length > 1 && (() => {
          const baseY = spec.higherIsBetter ? y(yMin) : y(yMax);
          const pathPts = envelope.map(e => `${x(e.ts_ms)},${y(e.value)}`).join(" ");
          const firstX = x(envelope[0].ts_ms);
          const lastX  = x(envelope[envelope.length - 1].ts_ms);
          return (
            <g style={{ pointerEvents: "none" }}>
              <defs>
                <linearGradient id={`grad-${spec.modality}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%"  stopColor="rgba(16,185,129,0.35)" />
                  <stop offset="100%" stopColor="rgba(16,185,129,0.02)" />
                </linearGradient>
              </defs>
              <polygon
                fill={`url(#grad-${spec.modality})`}
                points={`${firstX},${baseY} ${pathPts} ${lastX},${baseY}`}
              />
              <polyline
                fill="none"
                stroke="rgba(16,185,129,0.95)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                points={pathPts}
              />
              <circle
                cx={x(envelope[envelope.length - 1].ts_ms)}
                cy={y(envelope[envelope.length - 1].value)}
                r={5}
                fill="rgba(16,185,129,1)"
                stroke="rgba(20,20,28,0.9)"
                strokeWidth="2"
              />
            </g>
          );
        })()}
        {/* Scatter dots — coloured per series. When isolated, non-isolated
            points fade to background. Drawn AFTER envelope so dots sit on top. */}
        {spec.points.map((p, i) => {
          const key = seriesKey(p);
          const dimmed = isolatedSeries !== null && key !== isolatedSeries;
          return (
            <g key={i}>
              <circle
                cx={x(p.ts_ms)} cy={y(p.value)} r={10}
                fill="transparent" style={{ cursor: "pointer" }}
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover((cur) => (cur === p ? null : cur))}
              />
              <circle
                cx={x(p.ts_ms)} cy={y(p.value)}
                r={hover === p ? 5 : 3}
                fill={colorFor(key)}
                fillOpacity={dimmed ? 0.08 : (hover === p ? 1 : 0.55)}
                stroke={hover === p ? "white" : "none"}
                strokeWidth={hover === p ? 1.5 : 0}
                style={{ pointerEvents: "none", transition: "r 0.1s ease, fill-opacity 0.15s ease" }}
              />
            </g>
          );
        })}
        {/* Event annotations — dashed verticals + staggered labels, rendered
            AFTER the envelope so labels sit above the curve. */}
        <EventAnnotations
          events={events}
          modality={spec.modality}
          xMin={xMin}
          xMax={xMax}
          x={x}
          padT={PAD_T}
          padB={PAD_B}
          width={W}
          height={H}
        />
      </svg>
      {hover && (
        <div
          className="absolute pointer-events-none rounded-md border border-white/15 bg-black/90 backdrop-blur-sm px-2.5 py-1.5 text-[10px] font-mono text-white/85 shadow-xl"
          style={{
            left: `${(x(hover.ts_ms) / W) * 100}%`,
            top:  `${(y(hover.value) / H) * 100}%`,
            transform: "translate(-50%, calc(-100% - 12px))",
            whiteSpace: "nowrap",
            zIndex: 10,
          }}
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(seriesKey(hover)) }} />
            <span className="text-white/95">{hover.model}</span>
          </div>
          <div className="text-white/55">{HARNESS_LABEL[hover.harness] ?? hover.harness}</div>
          <div className="text-white/85 mt-1">{hover.detail ?? fmtMetric(hover.value, spec.unit)}</div>
          <div className="text-white/40 text-[9px] mt-0.5">{fmtDateTime(hover.ts_ms)}</div>
          {/* 2026-06-12: visual evolution moved here from the (deleted) Output
              Evolution wall. For image/video runs, hover shows the actual
              generated output inline so the dot's value gains a visual at the
              same time + place. Replaces ~200 px of dashboard scroll. */}
          {(spec.modality === "image" || spec.modality === "video") && hover.run_dir && (
            <div className="mt-2 pt-2 border-t border-white/10">
              <img
                src={spec.modality === "video"
                  ? `/api/video-thumb/${encodeURIComponent(hover.run_dir)}`
                  : `/api/bench-png/${encodeURIComponent(hover.run_dir)}`}
                alt=""
                width={120}
                height={120}
                style={{ display: "block", borderRadius: "4px", objectFit: "cover" }}
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
              />
            </div>
          )}
        </div>
      )}
      </div>
      {/* Legend — clickable. One click isolates a series (others fade, green
          envelope rebuilds from that model's runs). Click again to clear. */}
      <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-white/60 items-center">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-[2px] bg-emerald-400 rounded" />
          {isolatedSeries ? `best so far (${seriesLabel(isolatedSeries).split(" · ")[0]})` : "best so far"}
        </span>
        {isolatedSeries && (
          <button
            type="button"
            onClick={() => setIsolatedSeries(null)}
            className="px-1.5 py-0.5 rounded border border-emerald-400/40 bg-emerald-500/[0.08] text-emerald-300 hover:bg-emerald-500/15 transition-colors text-[9px] uppercase tracking-wider"
          >
            clear filter
          </button>
        )}
        <span className="flex items-center gap-1.5 text-white/45" title="Curated milestones from src/data/events.json">
          events:
          {(["harness", "model", "infra", "methodology"] as EventCategory[]).map(cat => (
            <span key={cat} className="flex items-center gap-1 ml-1">
              <span style={{ color: EVENT_COLOR[cat] }}>{EVENT_SYMBOL[cat]}</span>
              <span>{cat}</span>
            </span>
          ))}
        </span>
        <span className="text-white/30 text-[9px] uppercase tracking-wider ml-1">click a series →</span>
        {series.slice(0, PALETTE.length).map((k) => {
          const active = isolatedSeries === k;
          const dimmed = isolatedSeries !== null && !active;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setIsolatedSeries(active ? null : k)}
              title={`${seriesLabel(k)} — click to ${active ? "clear" : "isolate"}`}
              className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded border transition-all cursor-pointer ${
                active
                  ? "border-white/40 bg-white/[0.08]"
                  : dimmed
                    ? "border-transparent opacity-35 hover:opacity-70"
                    : "border-transparent hover:bg-white/[0.04]"
              }`}
            >
              <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(k) }} />
              <span className="truncate max-w-[260px]">{seriesLabel(k)}</span>
            </button>
          );
        })}
        {series.length > PALETTE.length && (
          <span className="text-white/30">+{series.length - PALETTE.length} more</span>
        )}
      </div>
    </div>
  );
};

// Renders dashed vertical lines + staggered labels for curated milestones
// falling inside the chart's date range. Labels alternate top/bottom to avoid
// overlap when events cluster; ties are broken by simple horizontal nudging.
const EventAnnotations = ({
  events,
  modality,
  xMin,
  xMax,
  x,
  padT,
  padB,
  width,
  height,
}: {
  events: (EventAnnotation & { tsMs: number })[];
  modality: string;
  xMin: number;
  xMax: number;
  x: (ts: number) => number;
  padT: number;
  padB: number;
  width: number;
  height: number;
}) => {
  // Filter: in date range + (no modality filter OR includes this chart's modality)
  const visible = events
    .filter(e => e.tsMs >= xMin && e.tsMs <= xMax)
    .filter(e => !e.modality || e.modality.includes(modality))
    .sort((a, b) => a.tsMs - b.tsMs);

  if (!visible.length) return null;

  const topY  = padT + 4;
  const botY  = height - padB - 6;
  const lineTop = padT;
  const lineBot = height - padB;

  // Stagger: alternate top/bottom; if two consecutive labels would overlap
  // horizontally (within 140px), nudge the second one further down a row.
  const PX_BUDGET = 140;
  const placed: { x: number; band: 0 | 1 | 2 | 3 }[] = [];
  visible.forEach((e, i) => {
    const px = x(e.tsMs);
    let band: 0 | 1 | 2 | 3 = (i % 2) as 0 | 1;
    const last = placed[placed.length - 1];
    if (last && Math.abs(px - last.x) < PX_BUDGET && last.band === band) {
      band = (band + 2) as 2 | 3;
    }
    placed.push({ x: px, band });
  });

  return (
    <g className="event-annotations">
      {visible.map((e, i) => {
        const px = x(e.tsMs);
        const color = e.color ?? EVENT_COLOR[e.category];
        const symbol = EVENT_SYMBOL[e.category] ?? "•";
        const band = placed[i].band;
        const isTop = band === 0 || band === 2;
        const labelY = isTop
          ? topY + (band === 2 ? 14 : 0)
          : botY - (band === 3 ? 14 : 0);
        const symbolY = isTop ? labelY + 9 : labelY - 9;
        const dateLabel = fmtDate(e.tsMs);
        const tooltip = `${e.label}\n${dateLabel} · ${e.category}${e.url ? "\n" + e.url : ""}`;
        return (
          <g key={`${e.ts}-${i}`}>
            <line
              x1={px} x2={px}
              y1={lineTop} y2={lineBot}
              stroke={color}
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={px} y={symbolY}
              fill={color}
              fontSize={11}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {symbol}
              <title>{tooltip}</title>
            </text>
            <text
              x={px} y={labelY}
              fill="rgba(255,255,255,0.75)"
              fontSize={9}
              textAnchor="middle"
              dominantBaseline={isTop ? "hanging" : "auto"}
              style={{ paintOrder: "stroke", stroke: "rgba(20,20,28,0.85)", strokeWidth: 3 }}
            >
              {e.label.length > 36 ? e.label.slice(0, 34) + "…" : e.label}
              <title>{tooltip}</title>
            </text>
          </g>
        );
      })}
    </g>
  );
};
