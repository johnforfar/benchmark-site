import { useEffect, useState } from "react";

// Per-model harness comparison. For each model on the reference machine, plot best observed
// throughput per harness so the operator can answer "which harness is fastest
// for this model on Arc 140T iGPU?". When vLLM-XPU bench-worker lands, it
// auto-populates a 2nd bar per chat model.

interface ChatImageRun {
  model_id: string;
  modality: string;
  harness_id?: string;
  status: string;
  tok_s: number;
  duration_s: number;
  steps: number | null;
  contention_at_start?: number | null;
  seconds_idle_at_start?: number | null;
}

// Contaminated = bench-worker tagged the run with concurrent jobs inflight at
// start. Legacy runs (null) are unknown — keep them.
const isContaminated = (r: { contention_at_start?: number | null }): boolean =>
  typeof r.contention_at_start === "number" && r.contention_at_start > 0;

const HARNESS_LABEL: Record<string, string> = {
  "llama-cpp-vulkan": "llama.cpp Vulkan",
  "vllm-xpu":         "vLLM-XPU",
  "vllm-omni":        "vLLM-omni",
  "sglang-xpu":       "sglang-XPU",
  "llama-cpp-sycl":   "llama.cpp SYCL",
  "openvino":         "OpenVINO",
  "sd-cpp-vulkan":    "sd.cpp Vulkan",
  "comfyui-xpu":      "ComfyUI torch.xpu",
};

const labelFor = (harness_id: string): string =>
  HARNESS_LABEL[harness_id] ?? harness_id;

interface VideoRun {
  run_dir: string;
  variant: string;
  width: number;
  height: number;
  duration_seconds: number;
  wall_seconds: number;
  high_noise_steps: number | null;
  low_noise_steps: number | null;
  lightning_lora: string | null;
}

interface VideoModel {
  model_id: string;
  runs?: VideoRun[];
}

interface HarnessBar {
  harness: string;          // "llama.cpp Vulkan" | "sd.cpp Vulkan" | "sd.cpp + Lightning LoRA" | "vLLM-XPU" | ...
  variant?: string;         // optional sub-descriptor (e.g. "8+8 step", "Q4_K_M")
  value: number;
  unit: "tok/s" | "s/img" | "min/sec";
  higherIsBetter: boolean;
}

interface ModelRow {
  model_id: string;
  modality: "chat" | "image" | "video" | "coding" | "agents" | "voice" | "stt" | "embed" | "other";
  bars: HarnessBar[];
}

// Legacy chat runs lack harness_id — default. Future runs from bench-worker
// with HARNESS_ID=vllm-xpu (etc.) carry the field explicitly.
const harnessForChat = (run: { harness_id?: string }): string =>
  labelFor(run.harness_id ?? "llama-cpp-vulkan");

export function HarnessComparisonGraph() {
  const [chatRuns, setChatRuns] = useState<ChatImageRun[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeContaminated, setIncludeContaminated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, v] = await Promise.all([
          fetch("/api/inference-benchmarks?mode=recent&limit=500", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
          fetch("/api/inference-bench-video", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
        ]);
        if (!cancelled) {
          setChatRuns(c?.runs ?? []);
          setVideoModels(v?.models ?? []);
        }
      } catch {
        if (!cancelled) { setChatRuns([]); setVideoModels([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  }, []);

  if (loading) return null;

  // Pre-filter contaminated runs (default ON). Count drops for UI badge.
  const okChatRuns = chatRuns.filter(r => r.status === "ok");
  const contaminatedCount = okChatRuns.filter(isContaminated).length;
  const usableRuns = includeContaminated ? okChatRuns : okChatRuns.filter(r => !isContaminated(r));

  // Build the model→bars matrix.
  const rows: ModelRow[] = [];

  // Chat / coding / agents — group by (model_id, harness_id), best tok/s
  // per cell. Each model can have multiple bars (one per harness measured).
  const textBy = new Map<string, Map<string, { modality: string; bestTok: number }>>();
  for (const r of usableRuns) {
    if (!["chat", "coding", "agents"].includes(r.modality)) continue;
    if (r.tok_s <= 0) continue;
    const harnessKey = harnessForChat(r);
    if (!textBy.has(r.model_id)) textBy.set(r.model_id, new Map());
    const inner = textBy.get(r.model_id)!;
    const cur = inner.get(harnessKey);
    if (!cur || r.tok_s > cur.bestTok) inner.set(harnessKey, { modality: r.modality, bestTok: r.tok_s });
  }
  const textRows: ModelRow[] = [];
  for (const [model_id, harnessMap] of textBy.entries()) {
    const bars: HarnessBar[] = [...harnessMap.entries()].map(([harness, { bestTok }]) => ({
      harness, value: bestTok, unit: "tok/s" as const, higherIsBetter: true,
    }));
    const modality = harnessMap.values().next().value!.modality;
    textRows.push({ model_id, modality: modality as ModelRow["modality"], bars });
  }
  textRows.sort((a, b) => Math.max(...b.bars.map(x => x.value)) - Math.max(...a.bars.map(x => x.value)));
  rows.push(...textRows);

  // Image — group by (model_id, harness_id) so vllm-omni / sd.cpp / ComfyUI
  // surface as distinct bars. Each cell holds the median duration_s for that
  // (model, harness) pair. Earlier this hardcoded "sd.cpp Vulkan" for every
  // image row, which mislabeled vllm-omni runs of qwen-image-2512-lightning8.
  const imgBy = new Map<string, Map<string, number[]>>();
  for (const r of usableRuns) {
    if (r.modality !== "image" || r.duration_s <= 0) continue;
    const harnessKey = labelFor(r.harness_id ?? "sd-cpp-vulkan");
    if (!imgBy.has(r.model_id)) imgBy.set(r.model_id, new Map());
    const inner = imgBy.get(r.model_id)!;
    if (!inner.has(harnessKey)) inner.set(harnessKey, []);
    inner.get(harnessKey)!.push(r.duration_s);
  }
  const imgRowsTmp: ModelRow[] = [];
  for (const [model_id, harnessMap] of imgBy.entries()) {
    const bars: HarnessBar[] = [...harnessMap.entries()].map(([harness, durs]) => ({
      harness, value: median(durs), unit: "s/img" as const, higherIsBetter: false,
    }));
    imgRowsTmp.push({ model_id, modality: "image", bars });
  }
  imgRowsTmp.sort((a, b) =>
    Math.min(...a.bars.map(x => x.value)) - Math.min(...b.bars.map(x => x.value))
  );
  rows.push(...imgRowsTmp);

  // Video — group by canonical model_id, separate bars for Lightning LoRA vs baseline.
  for (const m of videoModels) {
    const runs = m.runs ?? [];
    if (!runs.length) continue;
    const lightning = runs.filter(r => r.lightning_lora);
    const baseline  = runs.filter(r => !r.lightning_lora);
    const bars: HarnessBar[] = [];

    if (baseline.length) {
      const fastest = baseline.reduce((a, b) => (a.wall_seconds/a.duration_seconds) < (b.wall_seconds/b.duration_seconds) ? a : b);
      const minPerVid = (fastest.wall_seconds / 60) / fastest.duration_seconds;
      bars.push({
        harness: "sd.cpp Vulkan",
        variant: `${fastest.high_noise_steps ?? "?"}+${fastest.low_noise_steps ?? "?"} step · ${fastest.width}×${fastest.height}`,
        value: minPerVid, unit: "min/sec", higherIsBetter: false,
      });
    }
    if (lightning.length) {
      const fastest = lightning.reduce((a, b) => (a.wall_seconds/a.duration_seconds) < (b.wall_seconds/b.duration_seconds) ? a : b);
      const minPerVid = (fastest.wall_seconds / 60) / fastest.duration_seconds;
      bars.push({
        harness: "sd.cpp + Lightning LoRA",
        variant: `${fastest.high_noise_steps ?? "?"}+${fastest.low_noise_steps ?? "?"} step · ${fastest.width}×${fastest.height}`,
        value: minPerVid, unit: "min/sec", higherIsBetter: false,
      });
    }
    if (bars.length) rows.push({ model_id: m.model_id, modality: "video", bars });
  }

  if (!rows.length) return null;

  return (
    <div className="rounded-2xl p-6 border border-white/[0.06]" style={{ background: "rgba(20,20,28,0.55)" }}>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-base font-medium tracking-tight">Harness comparison · per model</h2>
        <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Reference hardware · Arc 140T iGPU</span>
      </div>
      <div className="flex items-baseline justify-between mb-5 flex-wrap gap-2">
        <span className="text-[11px] text-white/40">Best observed throughput per (model, harness). ⭐ marks winner. New harnesses (vLLM-XPU) auto-appear as bench-worker runs them.</span>
        {contaminatedCount > 0 && (
          <label className="flex items-center gap-2 text-[10px] text-white/50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeContaminated}
              onChange={(e) => setIncludeContaminated(e.target.checked)}
              className="accent-amber-400"
            />
            Include contaminated ({contaminatedCount})
            <span className="text-white/30" title="Runs where another bench job was inflight at start — measurement is unreliable.">ⓘ</span>
          </label>
        )}
      </div>

      <div className="space-y-5">
        {rows.map((row) => {
          const winnerIdx = bestBar(row.bars);
          const max = Math.max(...row.bars.map((b) => b.higherIsBetter ? b.value : 1 / b.value));
          return (
            <div key={row.model_id + "-" + row.modality}>
              <div className="flex items-baseline justify-between mb-2 gap-3">
                <span className="text-sm text-white/90 truncate" title={row.model_id}>{row.model_id}</span>
                <span className="text-[10px] uppercase tracking-wider text-white/40 shrink-0">{row.modality}</span>
              </div>
              <div className="space-y-2 pl-2 border-l-2 border-white/[0.04]">
                {row.bars.map((b, i) => {
                  const visMag = b.higherIsBetter ? b.value : 1 / b.value;
                  const pct = (visMag / max) * 100;
                  const isWinner = i === winnerIdx && row.bars.length > 1;
                  const bg = isWinner
                    ? "linear-gradient(90deg, rgba(16,185,129,0.7), rgba(99,102,241,0.7))"
                    : "linear-gradient(90deg, rgba(99,102,241,0.5), rgba(168,85,247,0.5))";
                  return (
                    <div key={b.harness + "-" + (b.variant ?? "")}>
                      <div className="flex items-baseline justify-between mb-1 gap-3">
                        <div className="min-w-0 flex-1">
                          <span className="text-xs text-white/80">{b.harness}</span>
                          {isWinner && <span className="ml-2 text-[9px] uppercase tracking-wider text-emerald-300 font-bold">⭐ best</span>}
                          {b.variant && <div className="text-[10px] text-white/40 truncate">{b.variant}</div>}
                        </div>
                        <span className="shrink-0 text-xs font-mono text-white/90 tabular-nums">
                          {fmtVal(b.value, b.unit)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-white/[0.04] rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bg }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 pt-4 border-t border-white/[0.04] text-[10px] text-white/40 leading-relaxed">
        <span className="text-white/60">How to read:</span> models with only 1 bar mean only one harness on the reference machine supports them today (sd.cpp Vulkan for image/video; llama.cpp Vulkan for chat). When vLLM-XPU bench-worker runs land, every chat model gains a 2nd bar.
      </div>
    </div>
  );
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

const bestBar = (bars: HarnessBar[]): number => {
  let bestIdx = 0;
  let bestScore = bars[0].higherIsBetter ? bars[0].value : 1 / bars[0].value;
  for (let i = 1; i < bars.length; i++) {
    const score = bars[i].higherIsBetter ? bars[i].value : 1 / bars[i].value;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
};

const fmtVal = (v: number, unit: HarnessBar["unit"]): string => {
  if (unit === "tok/s") return `${v.toFixed(1)} tok/s`;
  if (unit === "s/img") return v < 60 ? `${v.toFixed(1)} s` : `${(v / 60).toFixed(1)} min`;
  return v < 1 ? `${(v * 60).toFixed(0)} s/sec` : `${v.toFixed(1)} min/sec`;
};
