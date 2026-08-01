import { useEffect, useState } from "react";

// Shared modal for inspecting a single bench/user run. Used by both the
// BenchLeaderboard thumbnail strips and the OutputEvolution canonical-prompt
// strips. Extracted from BenchLeaderboard.tsx 2026-05-24 so both surfaces
// stay in sync (don't fork — share).

export interface RunModalState {
  run_dir: string;
  isVideo: boolean;
  imgUrl: string;
  model: string;
  harness: string;
}

interface RunDetail {
  prompt?: string;
  entry_label?: string;
  entry_id?: string;
  model?: string;
  width?: number;
  height?: number;
  steps?: number;
  high_noise_steps?: number;
  low_noise_steps?: number;
  duration_seconds?: number;
  wall_seconds?: number;
  result?: {
    duration_s?: number;
    steps?: number;
    output?: string;
    // Reproducibility (an internal contributor 2026-05-24): bench-worker now echoes these into
    // result.json so users can copy + reproduce. null/undefined on legacy runs.
    temperature?: number;
    max_tokens?: number;
    seed?: number | null;
    size?: string;  // image runs: "768x768"
    validation?: { score?: number; found?: string[]; missing?: string[] };
  };
  hardware_state?: { gpu?: { pci_id?: string }; cpu?: { model?: string }; power?: { pl1_w?: number } };
  ts?: string;
}

export const RunDetailModal = ({ state, onClose }: { state: RunModalState; onClose: () => void }) => {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/inference-benchmarks?mode=run&id=${encodeURIComponent(state.run_dir)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`api ${r.status}`);
        const j = await r.json();
        if (!cancelled) setDetail(j?.result ?? null);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? "failed");
      }
    })();
    return () => { cancelled = true; };
  }, [state.run_dir]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const prompt = detail?.prompt ?? null;
  const width  = detail?.width  ?? null;
  const height = detail?.height ?? null;
  const wall   = detail?.wall_seconds ?? detail?.result?.duration_s ?? null;
  const steps  = detail?.steps ?? detail?.result?.steps
    ?? (detail?.high_noise_steps != null && detail?.low_noise_steps != null
        ? detail.high_noise_steps + detail.low_noise_steps : null);
  const vidSec = detail?.duration_seconds ?? null;
  const output = detail?.result?.output ?? null;
  // Reproducibility fields (an internal contributor 2026-05-24 ask). Populated on runs written after
  // the bench-worker reproducibility patch; null on older runs. The "Reproduce"
  // curl block below renders only when at least one is present.
  const temperature = detail?.result?.temperature;
  const max_tokens  = detail?.result?.max_tokens;
  const seed        = detail?.result?.seed;
  const quality     = detail?.result?.validation?.score;
  const sizeStr     = detail?.result?.size
    ?? (width && height ? `${width}x${height}` : null);
  const isText = state.isVideo === false && !sizeStr && !output ? null : null;  // kept for future per-modality flags

  const reproCurlChat = (prompt && (temperature != null || max_tokens != null || seed != null)) ? `curl -sk -H 'content-type: application/json' \\
  -d '${JSON.stringify({
    model: state.model,
    messages: [{ role: "user", content: prompt }],
    ...(typeof max_tokens === "number" ? { max_tokens } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof seed === "number" ? { seed } : {}),
  }).replace(/'/g, "'\\''")}' \\
  http://localhost:4334/api/inference-chat` : null;

  const reproCurlImage = (prompt && sizeStr && state.isVideo === false && !output) ? `curl -sk -H 'content-type: application/json' \\
  -d '${JSON.stringify({
    model: state.model,
    prompt,
    size: sizeStr,
    ...(typeof steps === "number" ? { sample_steps: steps } : {}),
    ...(typeof seed === "number" ? { seed } : {}),
  }).replace(/'/g, "'\\''")}' \\
  http://localhost:4334/api/inference-images` : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        className="relative max-w-3xl w-full max-h-[90vh] rounded-2xl overflow-hidden border border-white/10 bg-[rgba(20,20,28,0.95)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/60 hover:bg-black/80 border border-white/15 text-white/90 flex items-center justify-center"
        >✕</button>

        {state.isVideo ? (
          <div className="block bg-black/60 flex-shrink-0">
            <video
              src={`/api/video-mp4/${encodeURIComponent(state.run_dir)}`}
              poster={state.imgUrl}
              controls
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
              className="block w-full max-h-[55vh] object-contain"
            />
          </div>
        ) : (
          <a
            href={state.imgUrl}
            target="_blank"
            rel="noreferrer"
            className="block bg-black/60 flex-shrink-0"
            title="Open full-size in new tab"
          >
            <img
              src={state.imgUrl}
              alt={state.run_dir}
              className="block w-full max-h-[55vh] object-contain"
            />
          </a>
        )}

        <div className="p-5 overflow-y-auto">
          <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
            <div className="min-w-0">
              <div className="text-sm font-medium text-white/95 truncate">{state.model}</div>
              <div className="text-[11px] text-white/50">{state.harness}{state.isVideo ? " · video" : " · image"}</div>
            </div>
            <a
              href={state.imgUrl}
              download={`${state.run_dir}.png`}
              className="text-[10px] uppercase tracking-wider px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-white/80"
            >⤓ PNG</a>
          </div>

          {err && <div className="text-[11px] text-amber-300/80 mb-2">Detail fetch failed: {err}</div>}

          {prompt && (
            <div className="mb-3">
              <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1">Prompt</div>
              <div className="text-[12px] text-white/85 whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto">{prompt}</div>
            </div>
          )}

          {output && !prompt && (
            <div className="mb-3">
              <div className="text-[9px] uppercase tracking-wider text-white/40 mb-1">Output</div>
              <div className="text-[12px] text-white/85 whitespace-pre-wrap leading-snug max-h-32 overflow-y-auto">{output}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {width && height && <Kv k="Resolution" v={`${width}×${height}`} />}
            {steps != null && <Kv k="Steps" v={`${steps}`} />}
            {vidSec != null && <Kv k="Video length" v={`${vidSec}s`} />}
            {wall != null && <Kv k="Wall time" v={wall < 60 ? `${wall.toFixed(1)}s` : `${(wall/60).toFixed(2)} min`} />}
            {typeof temperature === "number" && <Kv k="Temperature" v={temperature.toFixed(2)} />}
            {typeof max_tokens === "number" && <Kv k="Max tokens" v={`${max_tokens}`} />}
            {typeof seed === "number" && <Kv k="Seed" v={`${seed}`} mono />}
            {typeof quality === "number" && <Kv k="Keyword match" v={`${Math.round(quality * 100)}%`} />}
            {detail?.ts && <Kv k="Timestamp" v={detail.ts} />}
            <Kv k="Run dir" v={state.run_dir} mono />
          </div>

          {(reproCurlChat || reproCurlImage) && (
            <div className="mt-4">
              <div className="text-[9px] uppercase tracking-wider text-emerald-300/70 mb-1.5">
                Reproduce · copy-paste to reproduce this exact run on the reference machine
              </div>
              <pre className="text-[10px] leading-snug font-mono bg-black/40 border border-emerald-400/15 rounded-md p-3 overflow-x-auto text-white/80 whitespace-pre">{reproCurlChat ?? reproCurlImage}</pre>
              <div className="text-[9px] text-white/35 mt-1">
                {typeof seed === "number"
                  ? "Same prompt + temperature + seed → bit-reproducible on identical HW/model/harness."
                  : "Note: this run did not pin a seed — running this curl will give different output each time. Canonical entries pin seed=42."}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Kv = ({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) => (
  <div className="min-w-0">
    <div className="text-[9px] uppercase tracking-wider text-white/35">{k}</div>
    <div className={`text-white/85 ${mono ? "font-mono text-[10px] truncate" : ""}`} title={v}>{v}</div>
  </div>
);
