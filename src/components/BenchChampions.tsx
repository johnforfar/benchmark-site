import { useEffect, useState } from "react";

// Executive-summary card at top of the Benchmark tab. Picks the single
// fastest (harness, model) tuple per modality and shows it as a big-number
// stat. Designed for "what's the answer in 3 seconds" — Ashton's keynote.

interface Run {
  model_id: string;
  modality: string;
  harness_id?: string;
  status: string;
  tok_s: number;
  duration_s: number;
}

interface VideoRun {
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

interface Champion {
  modality: "Text" | "Image" | "Video";
  value: string;
  detail: string;
}

const HARNESS_LABEL: Record<string, string> = {
  "llama-cpp-vulkan": "llama.cpp Vulkan",
  "vllm-xpu":         "vLLM-XPU",
  "sd-cpp-vulkan":    "sd.cpp Vulkan",
};

const labelHarness = (h?: string): string => HARNESS_LABEL[h ?? ""] ?? "llama.cpp Vulkan";

export function BenchChampions() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [r, v] = await Promise.all([
          fetch("/api/inference-benchmarks?mode=recent&limit=500", { cache: "no-store" }).then(x => x.ok ? x.json() : null),
          fetch("/api/inference-bench-video", { cache: "no-store" }).then(x => x.ok ? x.json() : null),
        ]);
        if (!cancelled) { setRuns(r?.runs ?? []); setVideoModels(v?.models ?? []); }
      } catch {
        if (!cancelled) { setRuns([]); setVideoModels([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-pulse">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-xl p-4 border border-white/[0.06]" style={{ background: "rgba(20,20,28,0.55)" }}>
            <div className="h-2 w-16 rounded bg-white/10 mb-3" />
            <div className="h-5 w-24 rounded bg-white/10 mb-2" />
            <div className="h-3 w-32 rounded bg-white/10" />
          </div>
        ))}
      </div>
    );
  }

  const okRuns = runs.filter(r => r.status === "ok");

  // Text champion
  const textRuns = okRuns.filter(r => ["chat", "coding", "agents"].includes(r.modality) && r.tok_s > 0);
  const textBest = textRuns.length
    ? textRuns.reduce((a, b) => a.tok_s > b.tok_s ? a : b)
    : null;

  // Image champion (lowest median duration_s per model wins)
  const imgByModel = new Map<string, number[]>();
  for (const r of okRuns) {
    if (r.modality !== "image" || r.duration_s <= 0) continue;
    if (!imgByModel.has(r.model_id)) imgByModel.set(r.model_id, []);
    imgByModel.get(r.model_id)!.push(r.duration_s);
  }
  let imgBest: { model_id: string; median: number } | null = null;
  for (const [model_id, durs] of imgByModel.entries()) {
    const sorted = [...durs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (!imgBest || median < imgBest.median) imgBest = { model_id, median };
  }

  // Video champion (lowest min-per-vid-sec)
  let videoBest: { model_id: string; minPerVid: number; lightning: boolean } | null = null;
  for (const m of videoModels) {
    for (const v of m.runs ?? []) {
      const minPerVid = (v.wall_seconds / 60) / v.duration_seconds;
      if (!videoBest || minPerVid < videoBest.minPerVid) {
        videoBest = { model_id: m.model_id, minPerVid, lightning: !!v.lightning_lora };
      }
    }
  }

  const champions: Champion[] = [];
  if (textBest) champions.push({
    modality: "Text",
    value: `${textBest.tok_s.toFixed(1)} tok/s`,
    detail: `${textBest.model_id} · ${labelHarness(textBest.harness_id)}`,
  });
  if (imgBest) champions.push({
    modality: "Image",
    value: imgBest.median < 60 ? `${imgBest.median.toFixed(0)} s` : `${(imgBest.median / 60).toFixed(1)} min`,
    detail: `${imgBest.model_id} · sd.cpp Vulkan`,
  });
  if (videoBest) champions.push({
    modality: "Video",
    value: `${videoBest.minPerVid.toFixed(1)} min/sec`,
    detail: `${videoBest.model_id}${videoBest.lightning ? " · Lightning LoRA" : ""} · sd.cpp Vulkan`,
  });

  if (!champions.length) return null;

  return (
    <div className="rounded-2xl p-6 border border-white/[0.06]" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(99,102,241,0.04))" }}>
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-base font-medium tracking-tight">Best on this Own1</h2>
        <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">fastest (harness, model) per modality</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {champions.map((c) => (
          <div key={c.modality}>
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-1.5">{c.modality}</div>
            <div className="text-2xl font-semibold text-white tabular-nums">{c.value}</div>
            <div className="text-[11px] text-white/50 mt-1 truncate" title={c.detail}>{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
