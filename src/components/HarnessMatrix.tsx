import { useEffect, useState } from "react";
import { KNOWN_BROKEN, findBrokenReason } from "./known-broken-combos";

// HarnessMatrix — full (model × harness) detail leaderboard.
// Each modality section is its own matrix; rows are models, columns are
// candidate harnesses, cells render one of:
//   ✓ green metric  — winner for that row
//   plain metric    — tested but slower
//   ⏳ amber        — plausible, untested (operator should queue a bench)
//   ❌ red          — known broken (tooltip from known-broken-combos.ts)
//   ⚪ gray         — harness doesn't run this modality
// Rows sort by row-winner metric so best (model, harness) combos float to top.
// Mounted at the BOTTOM of the AI page (after thumbs + summary leaderboard).

interface BenchRun {
  model_id: string;
  modality: string;
  harness_id?: string;
  status: string;
  tok_s: number;
  duration_s: number;
  contention_at_start?: number | null;
}
interface VideoRun {
  variant: string;
  width: number;
  height: number;
  duration_seconds: number;
  wall_seconds: number;
  lightning_lora: string | null;
}
interface VideoModel {
  model_id: string;
  runs?: VideoRun[];
}

const HARNESS_LABEL: Record<string, string> = {
  "llama-cpp-vulkan": "llama.cpp Vulkan",
  "vllm-omni":        "vLLM-omni TRITON",
  "vllm-xpu":         "vLLM-XPU TRITON",
  "sglang-xpu":       "sglang-XPU",
  "llama-cpp-sycl":   "llama.cpp SYCL",
  "llama-cpp-openvino": "llama.cpp OpenVINO",
  "sd-cpp-vulkan":    "sd.cpp Vulkan",
  "comfyui-xpu":      "ComfyUI torch.xpu",
  "llm-scaler-omni":  "llm-scaler-omni",
};

const HARNESS_COLOR: Record<string, string> = {
  "llama-cpp-vulkan": "rgba(16,185,129,",
  "vllm-omni":        "rgba(99,102,241,",
  "vllm-xpu":         "rgba(99,102,241,",
  "sglang-xpu":       "rgba(217,70,239,",
  "llama-cpp-sycl":   "rgba(148,163,184,",
  "llama-cpp-openvino": "rgba(148,163,184,",
  "sd-cpp-vulkan":    "rgba(168,85,247,",
  "comfyui-xpu":      "rgba(245,158,11,",
  "llm-scaler-omni":  "rgba(148,163,184,",
};

const MODALITY_HARNESSES: Record<string, string[]> = {
  chat:      ["llama-cpp-vulkan", "vllm-omni", "vllm-xpu", "sglang-xpu", "llama-cpp-sycl", "llama-cpp-openvino"],
  reasoning: ["llama-cpp-vulkan", "vllm-omni", "vllm-xpu", "sglang-xpu"],
  image:     ["sd-cpp-vulkan", "vllm-omni", "comfyui-xpu"],
  video:     ["sd-cpp-vulkan", "vllm-omni", "comfyui-xpu"],
  voice:     ["piper"],
  stt:       ["whisper-cpp"],
};

// Harness IDs whose status block in HarnessSupportMatrix is "active" today.
// Untested cells for these harnesses show ⏳; for non-active harnesses, the cell
// is implicit-broken (still ❌ but with a generic reason).
const ACTIVE_HARNESSES = new Set(["llama-cpp-vulkan", "sd-cpp-vulkan", "vllm-omni", "piper", "whisper-cpp"]);

interface CellState {
  status: "winner" | "tested" | "untested" | "broken" | "na";
  value?: number;        // tok/s for chat (higher better) | s/clip for image/video (lower better)
  unit?: string;         // "tok/s" | "s/clip" | "min/sec"
  brokenReason?: string;
  brokenSource?: string;
  runCount?: number;
}

interface ModelRow {
  model_id: string;
  modality: "chat" | "reasoning" | "image" | "video";
  cells: Record<string, CellState>;   // keyed by harness_id
  bestValue?: number;                 // for sorting (higher-is-better normalised)
  bestHarness?: string;
}

function isContaminated(r: { contention_at_start?: number | null }): boolean {
  return typeof r.contention_at_start === "number" && r.contention_at_start > 0;
}

export function HarnessMatrix() {
  const [chatRuns, setChatRuns] = useState<BenchRun[]>([]);
  const [videoModels, setVideoModels] = useState<VideoModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [c, v] = await Promise.all([
          fetch("/api/inference-benchmarks?mode=recent&limit=1000", { cache: "no-store" }).then(r => r.ok ? r.json() : null),
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

  const okRuns = chatRuns.filter(r => r.status === "ok" && !isContaminated(r));

  // Build per-model best-metric-per-(harness) map for chat-family + reasoning + image.
  // Chat-family + reasoning: best = max tok/s. Image: best = min duration_s.
  const textBy      = new Map<string, Map<string, { best: number; modality: string; count: number }>>();
  const reasoningBy = new Map<string, Map<string, { best: number; modality: string; count: number }>>();
  const imgBy       = new Map<string, Map<string, { best: number; count: number }>>();

  for (const r of okRuns) {
    const harness = r.harness_id ?? "llama-cpp-vulkan";
    if (r.modality === "reasoning" && r.tok_s > 0) {
      if (!reasoningBy.has(r.model_id)) reasoningBy.set(r.model_id, new Map());
      const inner = reasoningBy.get(r.model_id)!;
      const cur = inner.get(harness);
      if (!cur || r.tok_s > cur.best) {
        inner.set(harness, { best: r.tok_s, modality: r.modality, count: (cur?.count ?? 0) + 1 });
      } else {
        cur.count++;
      }
    } else if (["chat", "coding", "agents"].includes(r.modality) && r.tok_s > 0) {
      if (!textBy.has(r.model_id)) textBy.set(r.model_id, new Map());
      const inner = textBy.get(r.model_id)!;
      const cur = inner.get(harness);
      if (!cur || r.tok_s > cur.best) {
        inner.set(harness, { best: r.tok_s, modality: r.modality, count: (cur?.count ?? 0) + 1 });
      } else {
        cur.count++;
      }
    } else if (r.modality === "image" && r.duration_s > 0) {
      if (!imgBy.has(r.model_id)) imgBy.set(r.model_id, new Map());
      const inner = imgBy.get(r.model_id)!;
      const cur = inner.get(harness);
      if (!cur || r.duration_s < cur.best) {
        inner.set(harness, { best: r.duration_s, count: (cur?.count ?? 0) + 1 });
      } else {
        cur.count++;
      }
    }
  }

  function buildRow(model_id: string, modality: "chat" | "reasoning" | "image" | "video",
                    tested: Map<string, { best: number; count: number }>): ModelRow {
    const cells: Record<string, CellState> = {};
    const harnessesForModality = MODALITY_HARNESSES[modality] ?? [];

    // Pass 1: tested cells
    for (const [h, { best, count }] of tested.entries()) {
      const unit = (modality === "chat" || modality === "reasoning") ? "tok/s"
                 : modality === "image" ? "s/img"
                 : "min/sec";
      cells[h] = { status: "tested", value: best, unit, runCount: count };
    }
    // Pass 2: known-broken
    for (const h of harnessesForModality) {
      if (cells[h]) continue;
      const broken = findBrokenReason(model_id, h);
      if (broken) {
        cells[h] = { status: "broken", brokenReason: broken.reason, brokenSource: broken.source };
      } else if (ACTIVE_HARNESSES.has(h)) {
        cells[h] = { status: "untested" };
      } else {
        cells[h] = { status: "broken",
                     brokenReason: `${HARNESS_LABEL[h] ?? h} not yet stood up on Arc 140T`,
                     brokenSource: "harness not active" };
      }
    }

    // Determine row winner among tested cells. Higher-is-better for tok/s
    // (chat + reasoning); lower-is-better for time-per-output (image, video).
    const higherIsBetter = modality === "chat" || modality === "reasoning";
    const testedEntries = [...Object.entries(cells)].filter(([, c]) => c.status === "tested");
    if (testedEntries.length) {
      const cmp = higherIsBetter
        ? (a: [string, CellState], b: [string, CellState]) => (b[1].value ?? 0) - (a[1].value ?? 0)
        : (a: [string, CellState], b: [string, CellState]) => (a[1].value ?? Infinity) - (b[1].value ?? Infinity);
      testedEntries.sort(cmp);
      const winner = testedEntries[0][0];
      cells[winner] = { ...cells[winner], status: "winner" };
    }

    const bestValue = (() => {
      const winner = Object.values(cells).find(c => c.status === "winner");
      if (!winner?.value) return 0;
      return higherIsBetter ? winner.value : 1 / winner.value;
    })();
    const bestHarness = Object.entries(cells).find(([, c]) => c.status === "winner")?.[0];
    return { model_id, modality, cells, bestValue, bestHarness };
  }

  const chatRows: ModelRow[] = [...textBy.entries()]
    .map(([m, inner]) => buildRow(m, "chat", inner))
    .sort((a, b) => (b.bestValue ?? 0) - (a.bestValue ?? 0));
  const reasoningRows: ModelRow[] = [...reasoningBy.entries()]
    .map(([m, inner]) => buildRow(m, "reasoning", inner))
    .sort((a, b) => (b.bestValue ?? 0) - (a.bestValue ?? 0));
  const imgRows: ModelRow[] = [...imgBy.entries()]
    .map(([m, inner]) => buildRow(m, "image", inner))
    .sort((a, b) => (b.bestValue ?? 0) - (a.bestValue ?? 0));

  // Video — group by canonical model_id; min/sec metric.
  const vidRows: ModelRow[] = videoModels
    .filter(m => (m.runs?.length ?? 0) > 0)
    .map(m => {
      const tested = new Map<string, { best: number; count: number }>();
      for (const r of m.runs ?? []) {
        // bench-worker still mis-tags video as llama-cpp-vulkan; treat any
        // wan/ltx run as sd-cpp-vulkan for matrix purposes until tag fix lands.
        const harness = "sd-cpp-vulkan";
        const minPerVid = (r.wall_seconds / 60) / r.duration_seconds;
        const cur = tested.get(harness);
        if (!cur || minPerVid < cur.best) tested.set(harness, { best: minPerVid, count: (cur?.count ?? 0) + 1 });
      }
      return buildRow(m.model_id, "video", tested);
    })
    .sort((a, b) => (b.bestValue ?? 0) - (a.bestValue ?? 0));

  const allRows = [...chatRows, ...reasoningRows, ...imgRows, ...vidRows];
  const visibleRows = showAll ? allRows : allRows.slice(0, 30);

  if (!allRows.length) return null;

  const allHarnesses = Array.from(new Set([
    ...MODALITY_HARNESSES.chat,
    ...MODALITY_HARNESSES.reasoning,
    ...MODALITY_HARNESSES.image,
    ...MODALITY_HARNESSES.video,
  ]));

  return (
    <div className="rounded-2xl p-6 border border-white/[0.06]" style={{ background: "rgba(20,20,28,0.55)" }}>
      <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-medium tracking-tight">Full harness × model matrix</h2>
          <p className="text-xs text-white/45 mt-1">
            Every (model, harness) combo measured on Arc 140T. ⭐ = row winner. ⏳ = plausible but untested (we should bench it). ❌ = known broken (hover for reason). ⚪ = harness doesn't run this modality.
          </p>
        </div>
        <button
          onClick={() => setShowAll(s => !s)}
          className="text-xs px-3 py-1.5 rounded-md border border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.04]"
        >
          {showAll ? "show top 30" : `show all ${allRows.length}`}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-left text-white/45 border-b border-white/[0.06]">
              <th className="py-2 pr-3 font-normal sticky left-0 bg-[rgba(20,20,28,0.95)] z-10 min-w-[180px]">model</th>
              <th className="py-2 pr-3 font-normal">modality</th>
              {allHarnesses.map(h => (
                <th key={h} className="py-2 px-2 font-normal whitespace-nowrap" title={HARNESS_LABEL[h] ?? h}>
                  <span style={{ color: (HARNESS_COLOR[h] ?? "rgba(148,163,184,") + "0.85)" }}>{HARNESS_LABEL[h] ?? h}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(row => (
              <tr key={`${row.modality}::${row.model_id}`} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                <td className="py-2 pr-3 font-mono text-[11px] text-white/85 truncate max-w-[260px] sticky left-0 bg-[rgba(20,20,28,0.95)] z-10"
                    title={row.model_id}>
                  {row.model_id}
                </td>
                <td className="py-2 pr-3 text-white/45 uppercase tracking-wider text-[9px]">{row.modality}</td>
                {allHarnesses.map(h => {
                  const cell = row.cells[h];
                  if (!cell || cell.status === "na") {
                    return <td key={h} className="py-2 px-2 text-white/15 text-center">·</td>;
                  }
                  if (cell.status === "broken") {
                    return (
                      <td key={h} className="py-2 px-2 text-center cursor-help"
                          title={`❌ ${cell.brokenReason}\n\nsource: ${cell.brokenSource}`}>
                        <span className="text-red-400/70">✕</span>
                      </td>
                    );
                  }
                  if (cell.status === "untested") {
                    return (
                      <td key={h} className="py-2 px-2 text-center text-amber-400/60 cursor-help"
                          title={`plausible (model + harness) combo — never benched. Queue a bench to fill this cell.`}>
                        ⏳
                      </td>
                    );
                  }
                  const isWinner = cell.status === "winner";
                  const fmt = (v: number, u: string) => {
                    if (u === "tok/s") return `${v.toFixed(1)}`;
                    if (u === "s/img") return v < 60 ? `${v.toFixed(0)}s` : `${(v/60).toFixed(1)}m`;
                    if (u === "min/sec") return `${v.toFixed(1)}m/s`;
                    return v.toFixed(1);
                  };
                  const bg = isWinner
                    ? (HARNESS_COLOR[h] ?? "rgba(16,185,129,") + "0.18)"
                    : "transparent";
                  const color = isWinner
                    ? (HARNESS_COLOR[h] ?? "rgba(16,185,129,") + "0.95)"
                    : "rgba(255,255,255,0.7)";
                  return (
                    <td key={h} className="py-2 px-2 text-center font-mono whitespace-nowrap"
                        style={{ background: bg, color }}
                        title={`${cell.value?.toFixed(2)} ${cell.unit} (best of ${cell.runCount ?? 1} run${cell.runCount === 1 ? "" : "s"})${isWinner ? " — ⭐ row winner" : ""}`}>
                      {isWinner && <span className="mr-1">⭐</span>}
                      {fmt(cell.value!, cell.unit!)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-white/35 mt-3 leading-relaxed">
        Sorted by row-winner metric (best combos float to top). Known-broken combos mined from <code>known-broken-combos.ts</code> ({KNOWN_BROKEN.length} entries). Hover any ❌ for the recorded failure mode + source. Untested ⏳ cells are candidate benches the auto-runner should target next.
      </p>
    </div>
  );
}
