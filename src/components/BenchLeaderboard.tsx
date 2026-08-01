import { useEffect, useState } from "react";
import { SkeletonLeaderboard } from "./Skeleton";
import { RunDetailModal, type RunModalState } from "./RunDetailModal";

// One consolidated leaderboard. Sections per modality (Text / Image / Video /
// …). Each row is a (model, harness) tuple, ranked within its modality.
// Image and video rows include inline thumbnail strips. Video references
// (Plopmenz HunyuanVideo) appear inline with a REFERENCE badge.
//
// Replaces the prior BenchGraph + VideoBenchGraph + AllCombinationsLeaderboard
// trio; same data sources, one place.

interface ChatImageRun {
  run_dir: string;
  ts: string;
  model_id: string;
  modality: string;
  harness_id?: string;
  status: string;
  tok_s: number;
  duration_s: number;
  contention_at_start?: number | null;
  // Image-specific (now surfaced by bench-runs.ts after sidecar merge)
  width?: number | null;
  height?: number | null;
  source?: "bench" | "user" | null;
  prompt?: string | null;
  thumb_url?: string | null;
  // Curated footprint from /etc/own1-inference/recommendations.json (matrix +
  // snapshot_pilots). null when the model isn't in the curated catalog.
  size_gb?: number | null;
  // Soft-validation keyword-match score for chat/coding/agents (0..1). null on
  // image/video and on prompts without expected_keywords.
  quality_score?: number | null;
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
  has_thumb?: boolean;
}

interface VideoModel { model_id: string; runs?: VideoRun[] }

// External reference points. Reported numbers for the same diffusion model
// on a fundamentally different hardware class — discrete dGPU vs Own1's
// integrated iGPU. The comparison answers "what would this look like on
// a desktop card?", not "is Own1 slow." Source provenance kept in `source`.
// 2026-06-17: HunyuanVideo external references dropped — they were on a
// different hardware class and added noise without helping users pick a model.
// Replace with locally-running rows once a 3rd video model lands on Own1.
const VIDEO_REFERENCES: {
  label: string;
  hardware: string;
  width: number;
  height: number;
  min_per_video_second: number;
  source: string;
}[] = [];

const HARNESS_LABEL: Record<string, string> = {
  "llama-cpp-vulkan": "llama.cpp Vulkan",
  "vllm-xpu":         "vLLM-XPU (TRITON)",
  "vllm-omni":        "vLLM-omni (TRITON)",
  "sglang-xpu":       "sglang-XPU",
  "sd-cpp-vulkan":    "sd.cpp Vulkan",
  "wan-diffusers":    "Wan diffusers",
  "comfyui-xpu":      "ComfyUI torch.xpu",
  "piper":            "piper",
  "whisper-cpp":      "whisper.cpp",
};

const HARNESS_COLOR: Record<string, string> = {
  "llama-cpp-vulkan": "rgba(16,185,129,0.85)",
  "vllm-xpu":         "rgba(99,102,241,0.85)",
  "sglang-xpu":       "rgba(217,70,239,0.85)",
  "sd-cpp-vulkan":    "rgba(168,85,247,0.85)",
  "wan-diffusers":    "rgba(99,102,241,0.85)",
  "piper":            "rgba(20,184,166,0.85)",
  "whisper-cpp":      "rgba(6,182,212,0.85)",
};

const referenceColor = "rgba(251,191,36,0.65)";
const fallbackColor  = "rgba(148,163,184,0.7)";

// Retired prompts / entry-IDs — runs are KEPT on disk and KEPT in the History
// timeline graph (so the "how far we've come" plot still shows them), but the
// thumbnail tile is hidden from the leaderboard image/video cards. Reason:
// these were earlier-iteration prompts that aren't representative of the
// current "push the limits" benchmark suite. Editing this set is the
// canonical way to retire visual showcase entries without losing the data.
const RETIRED_ENTRY_ID_SUBSTRINGS: string[] = [
  "image-006-tiny-stress-test",     // smiling cartoon sun — too easy, not showcase-worthy
];
const RETIRED_PROMPT_SUBSTRINGS: string[] = [
  // Fallback match by prompt text when entry-id missing from run_dir.
  "smiling sun in a clear blue sky",
];
const isRetiredFromLeaderboard = (run_dir: string, prompt: string | null | undefined): boolean => {
  const rd = (run_dir ?? "").toLowerCase();
  if (RETIRED_ENTRY_ID_SUBSTRINGS.some(s => rd.includes(s.toLowerCase()))) return true;
  const p = (prompt ?? "").toLowerCase();
  if (p && RETIRED_PROMPT_SUBSTRINGS.some(s => p.includes(s.toLowerCase()))) return true;
  return false;
};

const modelBadge = (model_id: string): { letter: string; bg: string } => {
  const id = model_id.toLowerCase();
  if (/^z-/.test(id))    return { letter: "Z", bg: "bg-emerald-800/80" };
  if (/^qwen/.test(id))  return { letter: "Q", bg: "bg-amber-800/80" };
  if (/^sd/.test(id))    return { letter: "S", bg: "bg-purple-800/80" };
  if (/^flux/.test(id))  return { letter: "F", bg: "bg-rose-800/80" };
  if (/^wan/.test(id))   return { letter: "W", bg: "bg-indigo-800/80" };
  if (/^hermes/.test(id))return { letter: "H", bg: "bg-cyan-800/80" };
  return { letter: (id[0] ?? "?").toUpperCase(), bg: "bg-slate-700/80" };
};

const fmtDur = (s: number): string => (s < 60 ? `${Math.round(s)}s` : `${Math.round(s / 60)}m`);
const fmtMin = (s: number): string => (s < 60 ? `${s.toFixed(1)}s` : `${(s / 60).toFixed(1)}min`);

const isContaminated = (r: { contention_at_start?: number | null }): boolean =>
  typeof r.contention_at_start === "number" && r.contention_at_start > 0;

type Unit = "tok/s" | "s/img" | "µs/px/vid-sec";

interface Thumb { run_dir: string; ts: string; subtitle: string; src: string; href: string }

interface Row {
  key: string;
  model: string;
  harness_id: string;
  harness_label: string;
  value: number;
  display: string;       // formatted value for the right-side label
  sub?: string;          // small line under value (e.g. "5.5 min/sec")
  higherIsBetter: boolean;
  isReference?: boolean;
  sourceNote?: string;   // for reference rows: provenance / how this number was obtained
  runCount?: number;
  thumbs?: Thumb[];      // optional inline thumbnail strip
  // Curated GB footprint; drives role-based picks (workhorse / heavyweight /
  // efficient). null when this row's model isn't in recommendations.json.
  size_gb?: number | null;
  // Mean soft-validation score across this row's bench runs (0..1). null when
  // no run carried an expected_keywords contract (image/video, custom prompts).
  // Drives the quality-gated role filters + the "Best Quality" pick.
  quality_score?: number | null;
  audioSampleUrl?: string | null;
}

// Module-singleton — only one voice sample plays at a time across the page.
// All VoicePlayButton instances share this ref via a tiny pub-sub so each
// button can flip its local icon when another one takes over.
const voiceAudio: { current: HTMLAudioElement | null; url: string | null } = { current: null, url: null };
const voiceSubs = new Set<() => void>();
const voiceNotify = () => voiceSubs.forEach(fn => fn());

function VoicePlayButton({ url }: { url: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const sub = () => force(n => n + 1);
    voiceSubs.add(sub);
    return () => { voiceSubs.delete(sub); };
  }, []);
  const isPlaying = voiceAudio.url === url && voiceAudio.current !== null && !voiceAudio.current.paused;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // If THIS row is playing, stop + reset.
    if (isPlaying) {
      voiceAudio.current?.pause();
      voiceAudio.current = null;
      voiceAudio.url = null;
      voiceNotify();
      return;
    }
    // Otherwise: stop whatever else is playing, start this one.
    if (voiceAudio.current) {
      voiceAudio.current.pause();
      voiceAudio.current = null;
      voiceAudio.url = null;
    }
    const a = new Audio(url);
    a.addEventListener("ended", () => {
      if (voiceAudio.current === a) { voiceAudio.current = null; voiceAudio.url = null; voiceNotify(); }
    });
    a.addEventListener("pause", () => {
      // Triggers re-render even on programmatic pause from another button.
      voiceNotify();
    });
    voiceAudio.current = a;
    voiceAudio.url = url;
    a.play().catch(() => {
      if (voiceAudio.current === a) { voiceAudio.current = null; voiceAudio.url = null; voiceNotify(); }
    });
    voiceNotify();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={isPlaying ? "Stop sample" : "Play voice sample"}
      className={`shrink-0 relative inline-flex items-center justify-center w-9 h-5 rounded transition-colors ${
        isPlaying ? "text-emerald-300" : "text-white/70 hover:text-emerald-300"
      }`}
    >
      <svg width="36" height="20" viewBox="0 0 36 20" aria-hidden className="absolute inset-0">
        <path d="M0 10 Q3 5 6 10 T12 10 T18 10 T24 10 T30 10 T36 10" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.55" />
        <path d="M0 10 Q3 13 6 10 T12 10 T18 10 T24 10 T30 10 T36 10" stroke="currentColor" strokeWidth="1.2" fill="none" opacity="0.3" />
      </svg>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="relative">
        <circle cx="5" cy="5" r="5" fill="currentColor" opacity="0.85" />
        {isPlaying ? (
          <>
            <rect x="3" y="2.8" width="1.6" height="4.4" fill="#0a0a0f" />
            <rect x="5.4" y="2.8" width="1.6" height="4.4" fill="#0a0a0f" />
          </>
        ) : (
          <path d="M3.5 2.5 L7.5 5 L3.5 7.5 Z" fill="#0a0a0f" />
        )}
      </svg>
    </button>
  );
}

// Role taxonomy — multiple "Best for X" picks per modality, industry-standard
// nuance (cf. Artificial Analysis "Best Cheap"/"Best Quality", LMSYS arena
// categories, HELM scenario splits). One row can win multiple roles; some
// roles may be empty (no model satisfies them in the current data set).
type ModelRoleId = "speed-king" | "workhorse" | "heavyweight" | "efficient" | "quality";

interface RoleProfile {
  id: ModelRoleId;
  label: string;
  description: string;
  color: string;
  pickFrom: (rows: Row[]) => Row | null;
}

// Per-modality footprint cuts. Text models are 0.5–4GB for workhorse and
// 4–8GB for heavyweight; image models start at 10.5GB (Z-Image-Turbo) and top
// out at 26.4GB (Qwen-Image-2512); video models are 1.2GB (LTX-Video) to
// 14GB+ (Wan2.2-Animate / wan2.2-t2v-a14b). Voice is a TBD bucket (no rows yet).
// Without per-modality cuts the leaderboard's image rows can't qualify for
// workhorse/heavyweight at all (since every image model exceeds 4GB).
interface SizeCut { workhorseMax: number; heavyweightMin: number }
const SIZE_CUTS: Record<string, SizeCut> = {
  text:  { workhorseMax: 4,  heavyweightMin: 8  },
  image: { workhorseMax: 12, heavyweightMin: 20 },
  video: { workhorseMax: 6,  heavyweightMin: 10 },
  voice: { workhorseMax: 2,  heavyweightMin: 5  },
};
const DEFAULT_CUT: SizeCut = { workhorseMax: 4, heavyweightMin: 8 };
const cutFor = (modality: string): SizeCut => SIZE_CUTS[modality] ?? DEFAULT_CUT;

// Quality floor: keyword-match score below this is treated as "model is
// effectively broken / hallucinating" and excluded from workhorse / heavyweight /
// efficient picks. Tuned conservatively: 0.3 means ≥30% of expected keywords
// landed — below that, the answer isn't on-topic. Rows with quality_score = null
// (no expected_keywords contract) are NOT filtered out — we just can't judge.
const QUALITY_FLOOR = 0.3;

const passesQualityFloor = (r: Row): boolean =>
  r.quality_score == null || r.quality_score >= QUALITY_FLOOR;

const byBest = (rows: Row[]): Row[] =>
  rows.slice().sort((a, b) => a.higherIsBetter ? b.value - a.value : a.value - b.value);

const efficiencyScore = (r: Row): number => {
  // tok/s/GB for higher-is-better; (1/s)/GB ≡ 1/(s·GB) for lower-is-better.
  // Both reduce to "more output per GB-second" so larger = more efficient.
  if (!r.size_gb || r.size_gb <= 0) return -Infinity;
  return r.higherIsBetter ? r.value / r.size_gb : 1 / (r.value * r.size_gb);
};

const profilesFor = (modality: string): RoleProfile[] => {
  const cut = cutFor(modality);
  // Fallback rule (added 2026-06-01): if absolute size threshold eliminates
  // every row, fall back to "best smallest-half" for workhorse / "best largest-half"
  // for heavyweight so the role cards stay populated for modalities with limited
  // model variety (video + voice). Without this, video shows only Top Speed and
  // workhorse/heavyweight cards are empty even though wan2.2-A14B is the only
  // local video model — a 1-row dataset can still rank in 3 slots.
  return [
    {
      id: "speed-king",
      label: "Top Speed",
      description: "Best raw performance regardless of footprint — for streaming UX where wall-clock matters most.",
      color: "#10b981",  // emerald
      pickFrom: (rows) => byBest(rows.filter(r => !r.isReference))[0] ?? null,
    },
    {
      id: "workhorse",
      label: "Best Workhorse",
      description: `Best performance among models ≤ ${cut.workhorseMax} GB that pass the quality floor (${Math.round(QUALITY_FLOOR * 100)}% keyword match where measured) — the everyday default; small footprint + good throughput + on-topic answers.`,
      color: "#6366f1",  // indigo
      pickFrom: (rows) => {
        const eligible = rows.filter(r => !r.isReference && passesQualityFloor(r));
        const sized = eligible.filter(r => r.size_gb != null && r.size_gb <= cut.workhorseMax);
        if (sized.length) return byBest(sized)[0] ?? null;
        // Fallback: smaller half by size_gb (if available), else first available
        const withSize = eligible.filter(r => r.size_gb != null);
        if (withSize.length >= 2) {
          const sorted = withSize.slice().sort((a, b) => (a.size_gb ?? 0) - (b.size_gb ?? 0));
          const smallerHalf = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
          return byBest(smallerHalf)[0] ?? null;
        }
        return byBest(eligible)[0] ?? null;
      },
    },
    {
      id: "heavyweight",
      label: "Best Heavyweight",
      description: `Best performance among models ≥ ${cut.heavyweightMin} GB that pass the quality floor — for one-shot deep reasoning where quality > latency.`,
      color: "#a855f7",  // purple
      pickFrom: (rows) => {
        const eligible = rows.filter(r => !r.isReference && passesQualityFloor(r));
        const sized = eligible.filter(r => r.size_gb != null && r.size_gb >= cut.heavyweightMin);
        if (sized.length) return byBest(sized)[0] ?? null;
        // Fallback: larger half by size_gb (if available), else first available
        const withSize = eligible.filter(r => r.size_gb != null);
        if (withSize.length >= 2) {
          const sorted = withSize.slice().sort((a, b) => (b.size_gb ?? 0) - (a.size_gb ?? 0));
          const largerHalf = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
          return byBest(largerHalf)[0] ?? null;
        }
        return byBest(eligible)[0] ?? null;
      },
    },
    {
      id: "efficient",
      label: "Most Efficient",
      description: "Highest throughput per GB of RAM among models that pass the quality floor — best on-topic output per byte of model footprint.",
      color: "#f59e0b",  // amber
      pickFrom: (rows) => {
        const eligible = rows.filter(r => !r.isReference && r.size_gb != null && r.size_gb > 0 && passesQualityFloor(r));
        if (!eligible.length) return null;
        return eligible.slice().sort((a, b) => efficiencyScore(b) - efficiencyScore(a))[0] ?? null;
      },
    },
    {
      id: "quality",
      label: "Best Quality",
      description: "Highest keyword-match score across canonical prompts. Speed-agnostic — for tasks where being correct matters more than being fast. Only ranks rows with a quality_score (text modalities running canonical entries).",
      color: "#ec4899",  // pink
      pickFrom: (rows) => {
        const eligible = rows.filter(r => !r.isReference && typeof r.quality_score === "number");
        if (!eligible.length) return null;
        return eligible.slice().sort((a, b) => {
          const dq = (b.quality_score ?? 0) - (a.quality_score ?? 0);
          if (Math.abs(dq) > 1e-9) return dq;
          return a.higherIsBetter ? b.value - a.value : a.value - b.value;
        })[0] ?? null;
      },
    },
  ];
};

interface Section {
  modality: string;
  title: string;
  unitLabel: string;     // header right-side metadata
  refLine: string;       // short hint of what the workload looks like
  rows: Row[];
}

type ModalState = RunModalState;

// Top-N cap per modality keeps the leaderboard scannable once the
// combinatorial runner starts producing dozens of (model, harness, resolution)
// rows. References (HunyuanVideo etc.) are always shown — they're anchors,
// not competitors.
const TOP_N_DEFAULT = 3;

export function BenchLeaderboard() {
  const [chatRuns, setChatRuns] = useState<ChatImageRun[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [sizeGbByModel, setSizeGbByModel] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [includeContaminated, setIncludeContaminated] = useState(false);
  const [modal, setModal] = useState<ModalState | null>(null);
  // Per-modality expand state — when false, only top-N own rows are shown.
  // References always shown regardless.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // One-button "run all benchmarks now" trigger with progressive feedback.
  // Click → POST /api/bench-trigger (drops bench-run-now sentinel) → then
  // POLL /api/bench-status every 5s for the next 5 min to show:
  //   - what's currently running (entry + model + elapsed seconds)
  //   - how many runs have completed since the trigger
  //   - the most-recently-finished bench (entry + status + duration)
  // bench-worker writes current_run / last_run on each dispatch boundary so
  // the polled status is fresh, not waiting for the 30s heartbeat.
  interface BenchStatus {
    state?: string;
    runs_completed_session?: number;
    uptime_s?: number;
    current_run?: { mode: string; entry_id: string; model: string; started_at: number } | null;
    last_run?: { mode: string; entry_id: string; model: string; status: string; duration_s?: number; finished_at: number } | null;
  }
  const [trigger, setTrigger] = useState<{
    state: "idle" | "posting" | "ok" | "err";
    msg: string;
    triggeredAt: number | null;
    runsAtTrigger: number | null;
    status: BenchStatus | null;
  }>({ state: "idle", msg: "", triggeredAt: null, runsAtTrigger: null, status: null });

  // Tick once per second so "elapsed" counters update visibly without a state thrash.
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (trigger.state !== "ok" && !liveStatus?.current_run) return;
    const id = setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [trigger.state]);

  // 2026-06-12: a SECOND, always-on bench-status poller (10s cadence).
  // Independent of the user-initiated trigger so the per-row "🔄 running"
  // spinner + ETA badge work even when nobody pressed the Run-All button.
  // The trigger flow above keeps its own 5s poll for sub-second feedback
  // while a manual trigger is active.
  const [liveStatus, setLiveStatus] = useState<BenchStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/bench-status", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!cancelled && j?.ok) setLiveStatus(j as BenchStatus);
      } catch { /* swallow */ }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Poll bench-status every 5s while a trigger is "live" (within 5 min window).
  useEffect(() => {
    if (trigger.state !== "ok" || trigger.triggeredAt == null) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await fetch("/api/bench-status", { cache: "no-store" });
        const j = await r.json().catch(() => ({}));
        if (!cancelled && j?.ok) {
          setTrigger((t) => ({ ...t, status: j as BenchStatus }));
        }
      } catch { /* swallow — next tick will retry */ }
    };
    poll();  // immediate
    const id = setInterval(poll, 5000);
    // Stop polling after 5 min — the user has moved on by then.
    const stop = setTimeout(() => clearInterval(id), 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); clearTimeout(stop); };
  }, [trigger.state, trigger.triggeredAt]);

  const triggerBench = async () => {
    setTrigger((t) => ({ ...t, state: "posting", msg: "" }));
    try {
      // content-type + body required for Astro CSRF strict-mode same-origin
      // POSTs. Without these the server 403s "Cross-site POST form submissions
      // are forbidden" even from the same origin.
      const r = await fetch("/api/bench-trigger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) {
        setTrigger({
          state: "ok",
          msg: "Triggered — polling status…",
          triggeredAt: Math.floor(Date.now() / 1000),
          runsAtTrigger: typeof j.runs_completed_session === "number" ? j.runs_completed_session : 0,
          status: j as BenchStatus,
        });
      } else {
        setTrigger((t) => ({ ...t, state: "err", msg: j?.error ?? `HTTP ${r.status}` }));
        setTimeout(() => setTrigger({ state: "idle", msg: "", triggeredAt: null, runsAtTrigger: null, status: null }), 8000);
      }
    } catch (e: any) {
      setTrigger((t) => ({ ...t, state: "err", msg: String(e?.message ?? e) }));
      setTimeout(() => setTrigger({ state: "idle", msg: "", triggeredAt: null, runsAtTrigger: null, status: null }), 8000);
    }
  };
  const triggerReset = () => setTrigger({ state: "idle", msg: "", triggeredAt: null, runsAtTrigger: null, status: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [c, v, recs] = await Promise.all([
          fetch("/api/inference-benchmarks?mode=recent&limit=3000", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
          fetch("/api/inference-bench-video", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
          fetch("/api/inference-benchmarks?mode=recommendations", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
        ]);
        if (!cancelled) {
          setChatRuns(c?.runs ?? []);
          setVideoModels(v?.models ?? []);
          setSizeGbByModel(recs?.sizes ?? {});
        }
      } catch {
        if (!cancelled) { setChatRuns([]); setVideoModels([]); setSizeGbByModel({}); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loading) return <SkeletonLeaderboard />;

  const okRuns = chatRuns.filter(r => r.status === "ok");
  const contaminatedCount = okRuns.filter(isContaminated).length;
  const usableRuns = includeContaminated ? okRuns : okRuns.filter(r => !isContaminated(r));

  const sections: Section[] = [];

  // ---- Text generation ----
  // group by (model, harness) → best tok/s; no thumbs
  const textBy = new Map<string, { tok: number; model: string; harness: string; count: number; size_gb: number | null; qSum: number; qCount: number }>();
  for (const r of usableRuns) {
    if (!["chat", "coding", "agents"].includes(r.modality)) continue;
    if (r.tok_s <= 0) continue;
    const harness = r.harness_id ?? "llama-cpp-vulkan";
    const key = `${harness}::${r.model_id}`;
    const cur = textBy.get(key);
    const size_gb = typeof r.size_gb === "number" ? r.size_gb : null;
    const q = typeof r.quality_score === "number" ? r.quality_score : null;
    if (!cur) {
      textBy.set(key, {
        tok: r.tok_s, model: r.model_id, harness, count: 1, size_gb,
        qSum: q ?? 0, qCount: q != null ? 1 : 0,
      });
    } else {
      cur.count++;
      if (r.tok_s > cur.tok) cur.tok = r.tok_s;
      if (cur.size_gb == null && size_gb != null) cur.size_gb = size_gb;
      if (q != null) { cur.qSum += q; cur.qCount++; }
    }
  }
  const textRows: Row[] = [...textBy.values()].map(({ tok, model, harness, count, size_gb, qSum, qCount }) => ({
    key: `${harness}::${model}`,
    model, harness_id: harness,
    harness_label: HARNESS_LABEL[harness] ?? harness,
    value: tok, display: `${tok.toFixed(1)} tok/s`,
    higherIsBetter: true, runCount: count, size_gb,
    quality_score: qCount > 0 ? qSum / qCount : null,
  })).sort((a, b) => b.value - a.value);
  if (textRows.length) sections.push({
    modality: "text",
    title: "Text generation",
    unitLabel: "tokens / second · higher = faster",
    refLine: "Short chat / coding / agent prompts (~50–500 output tokens). Sustained streaming throughput.",
    rows: textRows,
  });

  // ---- Image generation ----
  // Group by (model, resolution). Harness intentionally dropped from the key
  // 2026-06-01 — three "qwen-image-2512-lightning8 · 512×512" rows splitting
  // by harness (bench vs user-gen) looked sparse (1 image each). Merging into
  // a single (model, res) row populates the thumb strip with all runs across
  // sources, which is what users actually want to see at a glance.
  const imgBy = new Map<string, { model: string; harness: string; w: number | null; h: number | null; runs: ChatImageRun[]; size_gb: number | null }>();
  for (const r of usableRuns) {
    if (r.modality !== "image" || r.duration_s <= 0) continue;
    const harness = r.harness_id ?? "sd-cpp-vulkan";
    const w = r.width ?? null;
    const h = r.height ?? null;
    const resKey = (w && h) ? `${w}x${h}` : "unknown-res";
    const key = `${r.model_id}::${resKey}`;
    if (!imgBy.has(key)) imgBy.set(key, { model: r.model_id, harness, w, h, runs: [], size_gb: typeof r.size_gb === "number" ? r.size_gb : null });
    const slot = imgBy.get(key)!;
    slot.runs.push(r);
    if (slot.size_gb == null && typeof r.size_gb === "number") slot.size_gb = r.size_gb;
  }
  const thumbUrlFor = (r: ChatImageRun): { src: string; href: string } => {
    // Bench-source: /api/bench-png/<run_dir> (output.png on disk via runPngPath)
    // User-source: /api/image-job-png/<id> (proxied to stats-sidecar)
    if (r.source === "user") {
      const id = encodeURIComponent(r.run_dir);
      return { src: `/api/image-job-png/${id}`, href: `/api/image-job-png/${id}` };
    }
    return {
      src:  `/api/bench-png/${encodeURIComponent(r.run_dir)}`,
      href: `/api/bench-png/${encodeURIComponent(r.run_dir)}`,
    };
  };
  const imgRows: Row[] = [...imgBy.values()].map(({ model, harness, w, h, runs, size_gb }) => {
    const durs = runs.map(r => r.duration_s).sort((a, b) => a - b);
    const median = durs[Math.floor(durs.length / 2)];
    const userCount = runs.filter(r => r.source === "user").length;
    const benchCount = runs.length - userCount;
    // One thumb per distinct prompt/entry (per source); repeats still counted
    // (runCount) + plotted on the graph. Distinct prompts + user gens are kept.
    // Retired entries (see RETIRED_ENTRY_ID_SUBSTRINGS) are filtered from
    // thumbnails but ARE counted in runCount + visible on the History timeline.
    const seenImg = new Set<string>();
    const thumbs: Thumb[] = runs
      .slice()
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .filter(r => !isRetiredFromLeaderboard(r.run_dir, r.prompt))
      .filter(r => {
        const k = `${(r.prompt ?? r.run_dir).trim().toLowerCase().slice(0, 80)}|${r.source ?? "bench"}`;
        if (seenImg.has(k)) return false;
        seenImg.add(k); return true;
      })
      .map(r => {
        const { src, href } = thumbUrlFor(r);
        return {
          run_dir: r.run_dir, ts: r.ts,
          subtitle: fmtDur(r.duration_s),
          src, href,
        };
      });
    const resLabel = (w && h) ? `${w}×${h}` : "?×?";
    // Append a tiny "u" or "b" hint to harness label so mixed-source rows are
    // visually distinguishable without an extra column.
    const sourceTag = userCount > 0 && benchCount > 0
      ? ` · ${benchCount} bench + ${userCount} user`
      : userCount > 0 ? ` · user generations` : "";
    return {
      key: `${harness}::${model}::${resLabel}`,
      model: `${model} · ${resLabel}`,
      harness_id: harness,
      harness_label: `${HARNESS_LABEL[harness] ?? harness}${sourceTag}`,
      value: median, display: fmtMin(median),
      higherIsBetter: false, runCount: runs.length, thumbs, size_gb,
    };
  }).sort((a, b) => a.value - b.value);
  if (imgRows.length) sections.push({
    modality: "image",
    title: "Image generation",
    unitLabel: "median seconds / image · lower = faster · click thumb for detail",
    refLine: "One row per (model · harness · resolution). Bench-worker runs + user generations from Own Images all rank here together. 512×512 vs 1024×1024 are very different workloads — kept separate.",
    rows: imgRows,
  });

  // ---- Video generation ----
  // bars per (canonical-model, harness) keeping fastest variant by µs/px/vid-sec
  const vidRows: Row[] = [];
  // Best-effort size lookup for video models. Canonical ids from the video
  // endpoint don't carry size, so try a few obvious key variants.
  const videoSizeFor = (canonical: string): number | null => {
    const c = canonical.toLowerCase();
    if (sizeGbByModel[c] != null) return sizeGbByModel[c];
    // Try common matrix ids by family
    if (c.startsWith("wan")) return sizeGbByModel["wan2.2-animate-14b-q4"] ?? null;
    if (c.startsWith("ltx")) return sizeGbByModel["ltx-video-2b-q4"] ?? null;
    return null;
  };
  for (const m of videoModels) {
    const runs = (m.runs ?? []);
    if (!runs.length) continue;
    let best = runs[0];
    let bestUsPx = Infinity;
    for (const r of runs) {
      const uspx = (r.wall_seconds * 1_000_000) / (r.width * r.height) / r.duration_seconds;
      if (uspx < bestUsPx) { bestUsPx = uspx; best = r; }
    }
    const harness = "wan-diffusers";
    // Thumbnail strip: one tile per DISTINCT combo (model+res+steps+lora+prompt),
    // newest kept. Repeats of the same combo are still counted (runCount) and
    // still plotted on the History graph — we just don't show 80 identical clips.
    const seenVid = new Set<string>();
    const thumbs: Thumb[] = runs
      .slice()
      .filter(r => r.has_thumb !== false)
      // Retired entries: still counted in runCount + plotted on History timeline,
      // but hidden from the leaderboard thumbnail strip.
      .filter(r => !isRetiredFromLeaderboard(r.run_dir, r.variant))
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .filter(r => {
        // 2026-06-16: include prompt in the dedup key. Without it, every
        // lightning4-step run shared (variant, size, duration, steps, lora)
        // and collapsed 20 distinct prompts down to one thumb.
        const prompt = ((r as { prompt?: string }).prompt ?? r.run_dir).trim().toLowerCase().slice(0, 80);
        const k = `${prompt}|${r.variant}|${r.width}x${r.height}|${r.duration_seconds}|${r.high_noise_steps ?? "-"}|${r.low_noise_steps ?? "-"}|${r.lightning_lora ?? "-"}`;
        if (seenVid.has(k)) return false;
        seenVid.add(k); return true;
      })
      .map(r => ({
        run_dir: r.run_dir, ts: r.ts,
        subtitle: fmtDur(r.wall_seconds),
        src:  `/api/video-thumb/${encodeURIComponent(r.run_dir)}`,
        href: `/api/video-thumb/${encodeURIComponent(r.run_dir)}`,
      }));
    vidRows.push({
      key: `${harness}::${m.model_id}`,
      model: m.model_id, harness_id: harness,
      harness_label: HARNESS_LABEL[harness] ?? harness,
      value: bestUsPx, display: bestUsPx.toFixed(2),
      sub: `${((best.wall_seconds / 60) / best.duration_seconds).toFixed(1)} min/sec · ${best.width}×${best.height}`,
      higherIsBetter: false, runCount: runs.length, thumbs,
      size_gb: videoSizeFor(m.model_id),
    });
  }
  for (const ref of VIDEO_REFERENCES) {
    const uspx = (ref.min_per_video_second * 60 * 1_000_000) / (ref.width * ref.height);
    vidRows.push({
      key: `ref::${ref.label}`,
      model: ref.label, harness_id: "reference",
      harness_label: ref.hardware,
      value: uspx, display: uspx.toFixed(2),
      sub: `${ref.min_per_video_second} min/sec · ${ref.width}×${ref.height}`,
      higherIsBetter: false, isReference: true,
      sourceNote: ref.source,
    });
  }
  vidRows.sort((a, b) => a.value - b.value);
  if (vidRows.length) sections.push({
    modality: "video",
    title: "Video generation",
    unitLabel: "µs / pixel / video-sec · lower = faster",
    refLine: "Short t2v clip, varies by config (resolution + step count shown per row). Normalised per pixel per video-second for cross-resolution comparison.",
    rows: vidRows,
  });

  // ---- Voice (TTS + STT in one section) ----
  // Both directions of voice work share an investor pitch: "Own1 talks to you
  // and listens." Render them in one section with per-row direction badges so
  // the units don't visually collide.
  const voiceRows: Row[] = [];
  const ttsBy = new Map<string, { model: string; harness: string; runs: ChatImageRun[] }>();
  const sttBy = new Map<string, { model: string; harness: string; runs: ChatImageRun[] }>();
  for (const r of usableRuns) {
    if (r.modality === "voice" || r.modality === "tts") {
      const harness = r.harness_id ?? "piper";
      const key = `${harness}::${r.model_id}`;
      if (!ttsBy.has(key)) ttsBy.set(key, { model: r.model_id, harness, runs: [] });
      ttsBy.get(key)!.runs.push(r);
    } else if (r.modality === "stt" || r.modality === "asr") {
      const harness = r.harness_id ?? "whisper-cpp";
      const key = `${harness}::${r.model_id}`;
      if (!sttBy.has(key)) sttBy.set(key, { model: r.model_id, harness, runs: [] });
      sttBy.get(key)!.runs.push(r);
    }
  }
  for (const { model, harness, runs } of ttsBy.values()) {
    const best = Math.max(...runs.map(r => r.tok_s));
    const latest = runs.reduce((a, b) => a.ts >= b.ts ? a : b);
    voiceRows.push({
      key: `tts::${harness}::${model}`,
      model, harness_id: harness,
      harness_label: `${HARNESS_LABEL[harness] ?? harness} · text → speech`,
      value: best, display: `${best.toFixed(1)} chars/s`,
      higherIsBetter: true, runCount: runs.length,
      audioSampleUrl: `/api/bench-audio/${encodeURIComponent(latest.run_dir)}`,
    });
  }
  for (const { model, harness, runs } of sttBy.values()) {
    const best = Math.max(...runs.map(r => r.tok_s));
    voiceRows.push({
      key: `stt::${harness}::${model}`,
      model, harness_id: harness,
      harness_label: `${HARNESS_LABEL[harness] ?? harness} · speech → text`,
      value: best, display: `${best.toFixed(2)}× RTF`,
      higherIsBetter: true, runCount: runs.length,
    });
  }
  voiceRows.sort((a, b) => b.value - a.value);
  sections.push({
    modality: "voice",
    title: "Voice generation",
    unitLabel: "text → speech (chars/s) · speech → text (real-time factor) · higher = faster",
    refLine: "Two directions in one section. TTS candidates on Own1: OuteTTS-0.3 (gguf via llama.cpp) · Qwen3-TTS (vLLM-omni — blocked upstream). STT candidates: whisper.cpp Vulkan · Qwen3-ASR-1.7B (vLLM-omni with TRITON_ATTN — Plopmenz-confirmed). Populates once bench-worker writes voice runs.",
    rows: voiceRows,
  });

  if (!sections.length) return null;

  return (
    <div className="space-y-6">
      <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white/95 mb-1">
        Leaderboards
      </h2>
      {contaminatedCount > 0 && (
        <div className="flex items-center justify-end">
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
        </div>
      )}

      {modal && <RunDetailModal state={modal} onClose={() => setModal(null)} />}

      {sections.map((sec) => {
        // Bar scaling: best entry in this section sets the 100%
        const maxVisual = Math.max(1, ...sec.rows.map(r => r.higherIsBetter ? r.value : 1 / r.value));
        return (
          <section
            key={sec.modality}
            className="rounded-2xl p-6 border border-white/[0.06]"
            style={{ background: "rgba(20,20,28,0.55)" }}
          >
            <div className="flex items-baseline justify-between gap-3 mb-5">
              <div className="flex items-baseline gap-3 min-w-0">
                <h2 className="text-base font-medium tracking-tight">{sec.title}</h2>
                {/* 2026-06-13: scheduling-policy hint. Hover to read why thumb
                    strips grow slowly even when many runs are recorded — same
                    prompt × same model = ONE thumb (de-duped). Bench-worker now
                    enforces "every catalog entry must be benched at least once
                    on a model before ANY re-bench" — see ENGINEERING/2026-06-13_
                    BENCH-WORKER-SCHEDULING-POLICY.md. */}
                {(sec.modality === "image" || sec.modality === "video" || sec.modality === "chat" || sec.modality === "coding" || sec.modality === "agents" || sec.modality === "tts" || sec.modality === "stt") && (
                  <span
                    className="text-[10px] text-white/35 font-mono cursor-help shrink-0"
                    title={
                      `BENCH-WORKER SCHEDULING POLICY\n\n` +
                      `Thumb strips de-dup by (prompt × model × resolution × steps). Re-running the same combo never adds new thumbs.\n\n` +
                      `Bench-worker enforces CATALOG-EXHAUSTION mode: every catalog entry must run at least once on a (model, mode) before ANY re-bench. Per-mode coverage floor:\n` +
                      `  • image, video: 14 distinct entries\n` +
                      `  • chat, coding, agents, tts, stt: 3 distinct entries\n\n` +
                      `Once the floor is met, normal freshness-window rotation kicks in for History timeline data. ` +
                      `Adding a new catalog entry re-enters coverage phase so the new entry is benched on every model before any others repeat.\n\n` +
                      `Doc: ENGINEERING/2026-06-13_BENCH-WORKER-SCHEDULING-POLICY.md`
                    }
                  >
                    bench-schedule ⓘ
                  </span>
                )}
              </div>
              <span
                className="text-[10px] text-white/30 font-mono uppercase tracking-wider cursor-help shrink-0"
                title={`${sec.unitLabel}\n\n${sec.refLine}${sec.modality === "video" ? "\n\nWhy per-pixel? Resolution dominates wall time in diffusion. µs / pixel / video-sec normalises across resolutions so a 320×192 run is directly comparable to a 1280×704 one.\n\nReference rows are external numbers reported on a different hardware class (discrete GPU) for the same model family. They set the \"what a desktop card looks like\" anchor; Own1 entries are Arc 140T iGPU on the Beelink GTi15. Hover the reference badge for provenance." : ""}`}
              >
                {sec.unitLabel} ⓘ
              </span>
            </div>

            {sec.rows.length === 0 && (
              <div className="text-[11px] text-white/40 py-4">
                No <code className="text-white/60">{sec.modality}</code> runs yet — bench-worker will populate this automatically.
              </div>
            )}

            {sec.rows.filter(r => !r.isReference).length > 0 && (
              <RoleGrid rows={sec.rows} modality={sec.modality} />
            )}

            {(() => {
              // Split rows into Own1 vs reference. Own1 capped to top-N
              // unless expanded; references always shown beneath.
              // Visibility gate. Image + video are thumb-driven so we gate on
              // visible-thumb count (qwen-image · 256×256 was leaking through
              // with 18 retired-prompt runs but 0 displayable thumbs). For
              // voice + text + every other modality there's no thumb concept,
              // so fall back to runCount. Without this fallback, voice rows
              // (audio playback hidden behind the row) and text rows all got
              // nuked together with the empty-thumb image row.
              const isVisualMode = sec.modality === "image" || sec.modality === "video";
              const ownRows = sec.rows.filter(r => {
                if (r.isReference) return false;
                if (isVisualMode) return (r.thumbs?.length ?? 0) >= 3;
                return (r.runCount ?? 0) >= 3;
              });
              const refRows = sec.rows.filter(r =>  r.isReference);
              const isExpanded = !!expanded[sec.modality];
              const visibleOwn = isExpanded ? ownRows : ownRows.slice(0, TOP_N_DEFAULT);
              const hiddenCount = ownRows.length - visibleOwn.length;

              // 2026-06-12: per-row spinner + ETA. If bench-worker's current_run
              // points at this row's model (case-insensitive substring match — the
              // bench-status model_id is the file basename, the leaderboard row's
              // model_id is the canonical lowercase form), show a 🔄 + elapsed/ETA.
              // ETA = max(0, median_wall_seconds_for_this_modality - elapsed).
              // Median is computed from the section's existing rows' run values
              // (rows already have their representative timing in row.value, but
              // we need raw wall_seconds for image/video — use row.value as the
              // proxy since the section unit is "seconds per image" / similar).
              const cr = liveStatus?.current_run;
              const medianForSection = (() => {
                const vals = sec.rows
                  .filter((r) => !r.isReference && Number.isFinite(r.value) && r.value > 0)
                  .map((r) => r.value)
                  .sort((a, b) => a - b);
                if (!vals.length) return null;
                return vals[Math.floor(vals.length / 2)];
              })();
              const isRowRunning = (row: Row): boolean => {
                if (!cr?.model) return false;
                const r = row.model.toLowerCase();
                const c = cr.model.toLowerCase();
                return r.includes(c) || c.includes(r);
              };
              const renderRow = (row: Row, i: number, group: "own" | "ref") => {
                const visMag = row.higherIsBetter ? row.value : 1 / row.value;
                const pct = (visMag / maxVisual) * 100;
                const isWinner = group === "own" && i === 0 && ownRows.length > 1;
                const color = row.isReference
                  ? referenceColor
                  : HARNESS_COLOR[row.harness_id] ?? fallbackColor;
                const bg = `linear-gradient(90deg, ${color}, ${color.replace(/0\.\d+\)/, "0.45)")})`;
                const showBar = ownRows.length > 1 || refRows.length > 0;
                const rowTitle = [
                  row.model,
                  row.harness_label,
                  typeof row.size_gb === "number" ? `${row.size_gb} GB` : null,
                  row.runCount ? `${row.runCount} ${row.runCount === 1 ? "run" : "runs"}` : null,
                  row.isReference ? (row.sourceNote ?? "external reference") : null,
                ].filter(Boolean).join(" · ");

                const rowRunning = isRowRunning(row);
                const elapsedS = rowRunning && cr ? Math.max(0, nowTick - cr.started_at) : 0;
                const etaS = rowRunning && medianForSection ? Math.max(0, Math.round(medianForSection - elapsedS)) : 0;
                const fmtSecs = (s: number) => s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
                return (
                  <div key={row.key}>
                    <div className="flex items-baseline justify-between mb-1 gap-3">
                      <div className="min-w-0 flex-1 flex items-baseline gap-2 flex-wrap">
                        {isWinner && <span className="text-emerald-300 shrink-0">★</span>}
                        <span className="text-sm text-white/90 truncate cursor-help" title={rowTitle}>{row.model}</span>
                        <span
                          className="text-[10px] uppercase tracking-wider font-mono text-white/45 shrink-0"
                          title={`harness: ${row.harness_label}`}
                          style={{ color: HARNESS_COLOR[row.harness_id]?.replace(/0\.\d+\)/, "0.85)") }}
                        >
                          · {row.harness_label}
                        </span>
                        {rowRunning && (
                          <span
                            className="inline-flex items-center gap-1 text-[10px] font-mono text-cyan-300/90 bg-cyan-500/[0.08] border border-cyan-400/30 rounded px-1.5 py-0.5 shrink-0"
                            title={cr?.entry_id ? `Running: ${cr.entry_id}` : "Running now"}
                          >
                            <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                            {fmtSecs(elapsedS)}
                            {etaS > 0 && <span className="text-cyan-300/60">· ETA ~{fmtSecs(etaS)}</span>}
                          </span>
                        )}
                        {row.isReference && (
                          <span
                            className="text-[9px] uppercase tracking-wider text-amber-300/70 font-bold shrink-0 cursor-help"
                            title={row.sourceNote ?? "External benchmark reference — not running on Own1; shown for comparison context"}
                          >
                            external benchmark reference
                          </span>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        {row.audioSampleUrl && <VoicePlayButton url={row.audioSampleUrl} />}
                        <div className="text-right">
                          <div className={`text-sm font-mono tabular-nums ${isWinner ? "text-emerald-300" : "text-white/90"}`}>
                            {row.display}
                          </div>
                          {row.sub && <div className="text-[10px] text-white/40 font-mono">{row.sub}</div>}
                        </div>
                      </div>
                    </div>
                    {showBar && (
                      <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: bg }} />
                      </div>
                    )}
                    {row.thumbs && row.thumbs.length > 0 && (
                      <ThumbStrip
                        model={row.model}
                        harness={row.harness_label}
                        isVideo={sec.modality === "video"}
                        thumbs={row.thumbs}
                        onOpen={setModal}
                      />
                    )}
                  </div>
                );
              };

              return (
                <>
                  <div className="space-y-5">
                    {visibleOwn.map((row, i) => renderRow(row, i, "own"))}
                  </div>

                  {hiddenCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(s => ({ ...s, [sec.modality]: true }))}
                      className="mt-3 text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/20 text-white/60 hover:text-white/85 transition-colors"
                    >
                      Show all {ownRows.length} · {hiddenCount} more
                    </button>
                  )}
                  {isExpanded && ownRows.length > TOP_N_DEFAULT && (
                    <button
                      type="button"
                      onClick={() => setExpanded(s => ({ ...s, [sec.modality]: false }))}
                      className="mt-3 text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-md border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-white/60 hover:text-white/85 transition-colors"
                    >
                      Show top {TOP_N_DEFAULT} only
                    </button>
                  )}

                  {refRows.length > 0 && (
                    <div className="mt-5 pt-4 border-t border-white/[0.04] space-y-5">
                      {refRows.map((row, i) => renderRow(row, i, "ref"))}
                    </div>
                  )}
                </>
              );
            })()}

          </section>
        );
      })}
    </div>
  );
}

const ThumbStrip = ({
  model, harness, isVideo, thumbs, onOpen,
}: {
  model: string;
  harness: string;
  isVideo: boolean;
  thumbs: Thumb[];
  onOpen: (m: ModalState) => void;
}) => {
  const badge = modelBadge(model);
  // 2026-06-17: single horizontal row with overflow scroll + right-edge fade,
  // so a row with 14 thumbs doesn't wrap onto two visual lines. Users scroll
  // right to see the rest. Fade hints there's more without screaming about it.
  return (
    <div
      className="mt-2 overflow-x-auto overflow-y-hidden"
      style={{
        scrollbarWidth: "thin",
        maskImage: "linear-gradient(to right, black calc(100% - 40px), transparent 100%)",
        WebkitMaskImage: "linear-gradient(to right, black calc(100% - 40px), transparent 100%)",
      } as React.CSSProperties}
    >
      <div className="flex gap-1" style={{ width: "max-content" }}>
      {thumbs.map((t) => (
        <button
          key={t.run_dir}
          type="button"
          onClick={() => onOpen({ run_dir: t.run_dir, isVideo, imgUrl: t.src, model, harness })}
          title={`${model} · ${harness}\n${t.subtitle} · ${t.ts}\nClick for detail`}
          className="group relative rounded-md overflow-hidden border border-white/[0.06] bg-white/[0.02] hover:border-indigo-400/40 transition-colors block text-left"
          style={{ width: 64, height: 64, contentVisibility: "auto", containIntrinsicSize: "64px 64px" } as React.CSSProperties}
        >
          <img
            src={t.src}
            alt={t.run_dir}
            loading="lazy"
            decoding="async"
            width={64}
            height={64}
            style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
          />
          <div className="absolute bottom-0.5 left-0.5 px-1 rounded bg-indigo-900/70 text-[8px] text-white/90 backdrop-blur-md leading-tight">
            {t.subtitle}
          </div>
          <div className={`absolute bottom-0.5 right-0.5 px-1 rounded text-[8px] font-bold text-white/95 backdrop-blur-md leading-tight ${badge.bg}`}>
            {badge.letter}
          </div>
        </button>
      ))}
      </div>
    </div>
  );
};

// Role grid: one small card per role profile, picked from this modality's
// rows. Empty roles hidden entirely — the taxonomy lives in the section
// tooltip so the main surface stays visual. Only models that actually win a
// category appear as cards.
const RoleGrid = ({ rows, modality }: { rows: Row[]; modality: string }) => {
  const direction = rows.find(r => !r.isReference)?.higherIsBetter ?? true;
  const picksRaw = profilesFor(modality)
    .map((role) => ({ role, pick: role.pickFrom(rows) }))
    .filter((x): x is { role: typeof x.role; pick: NonNullable<typeof x.pick> } => x.pick != null);
  // Collapse roles that resolve to the SAME model+value. With sparse data (e.g.
  // a single proven video combo) every role picks the identical row, so showing
  // "Top Speed" and "Most Efficient" as the same number is noise, not a comparison.
  const seenPick = new Set<string>();
  const picks = picksRaw.filter(({ pick }) => {
    const k = `${pick.model}|${pick.display}`;
    if (seenPick.has(k)) return false;
    seenPick.add(k); return true;
  });
  if (picks.length === 0) return null;
  const colsClass = picks.length >= 4 ? "md:grid-cols-4"
                  : picks.length === 3 ? "md:grid-cols-3"
                  : picks.length === 2 ? "md:grid-cols-2"
                  : "md:grid-cols-1";
  return (
    <div className="mb-5">
      <div
        className="text-[9px] uppercase tracking-[0.2em] text-white/45 font-bold mb-2 cursor-help inline-block"
        title={`Industry-standard role splits — picked from this section's rows. Roles with a size constraint also require ≥${Math.round(QUALITY_FLOOR * 100)}% keyword match where measured. Empty roles are hidden.`}
      >
        Best for ⓘ
      </div>
      <div className={`grid gap-2 grid-cols-2 ${colsClass}`}>
        {picks.map(({ role, pick }) => {
          const dir = pick.higherIsBetter ?? direction;
          return (
            <div
              key={role.id}
              className="rounded-lg border p-3 cursor-help"
              style={{ borderColor: `${role.color}40`, background: `${role.color}0a` }}
              title={role.description}
            >
              <div
                className="text-[9px] uppercase tracking-wider font-bold mb-1.5"
                style={{ color: role.color }}
              >
                {role.label}
              </div>
              <div className="text-[11px] text-white/90 truncate font-medium" title={pick.model}>
                {pick.model}
              </div>
              <div className="flex items-baseline justify-between mt-2 gap-2">
                <span className="text-[11px] font-mono tabular-nums text-white/85">
                  {pick.display}
                </span>
                {typeof pick.size_gb === "number" && (
                  <span className="text-[9px] font-mono text-white/45 shrink-0">
                    {pick.size_gb} GB
                  </span>
                )}
              </div>
              {typeof pick.quality_score === "number" && (
                <div
                  className="text-[8px] font-mono text-white/55 mt-1"
                  title={`Keyword match against canonical reference: ${Math.round(pick.quality_score * 100)}%`}
                  style={role.id === "quality" ? { color: role.color } : undefined}
                >
                  Q {Math.round(pick.quality_score * 100)}%
                </div>
              )}
              {role.id === "efficient" && typeof pick.size_gb === "number" && pick.size_gb > 0 && (
                <div className="text-[8px] font-mono text-white/35 mt-0.5">
                  {(() => { const e = dir ? pick.value / pick.size_gb : 1 / (pick.value * pick.size_gb); return e >= 1 ? e.toFixed(2) : e.toPrecision(2); })()} / GB
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

