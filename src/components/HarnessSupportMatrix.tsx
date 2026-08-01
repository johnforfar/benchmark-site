// Static-data matrix of every harness the reference machine might use, and what works
// on this hardware. The "what doesn't run" surface is as important as
// "what runs" — saves us re-testing every cycle.
// Sources: ENGINEERING/2026-05-23_VLLM-XPU-ON-ARC-140T-UNSUPPORTED.md
//          feedback_vllm_xpu_arc140t_unsupported memory

type Status = "active" | "supported" | "unsupported" | "broken" | "untested";

interface HarnessRow {
  id: string;
  label: string;
  category: "LLM" | "Image" | "Video" | "Voice" | "STT";
  status: Status;
  detail: string;
  issue?: { label: string; url: string };
}

const ROWS: HarnessRow[] = [
  // LLM
  { id: "llama-cpp-vulkan", label: "llama.cpp Vulkan", category: "LLM",
    status: "active",
    detail: "The only working LLM harness on Arc 140T iGPU. ~52 tok/s on Qwen3-0.6B-BF16." },
  { id: "vllm-xpu", label: "vLLM-XPU (vllm-omni)", category: "LLM",
    status: "active",
    detail: "Works with the TRITON-backend workaround (--attention-backend TRITON_ATTN + VLLM_MM_ENCODER_ATTN_BACKEND=TRITON env). Measured ~38 tok/s steady-state on Qwen3-0.6B-BF16 (vs llama.cpp Vulkan's ~52). Without TRITON flags: crashes on first inference with 'Only XE2/XE3 cutlass kernel' (Arc 140T is Xe-LPG+/Alchemist+).",
    issue: { label: "vllm#37828", url: "https://github.com/vllm-project/vllm/issues/37828" } },
  { id: "sglang-xpu", label: "sglang-XPU", category: "LLM",
    status: "untested",
    detail: "Requested internally for evaluation. Same Intel SYCL stack as vLLM-XPU — likely needs similar TRITON-backend workaround. No upstream flake yet (needs our own derivation).",
    issue: { label: "vllm#37828", url: "https://github.com/vllm-project/vllm/issues/37828" } },
  { id: "llama-cpp-sycl", label: "llama.cpp SYCL", category: "LLM",
    status: "broken",
    detail: "5× slower than Vulkan on Arc; OpenVINO backend half-fails. Not worth pursuing unless Intel SYCL on iGPU matures." },
  { id: "llama-cpp-openvino", label: "llama.cpp OpenVINO", category: "LLM",
    status: "broken",
    detail: "50% request failure rate measured 2026-04-06 (an internal bench). Not production-ready on any HW." },
  { id: "ollama", label: "Ollama (llama.cpp wrapper)", category: "LLM",
    status: "supported",
    detail: "Wrapper overhead reduces tok/s vs direct llama-server. Skip unless API compatibility forces it." },

  // Image
  { id: "sd-cpp-vulkan", label: "sd.cpp Vulkan", category: "Image",
    status: "active",
    detail: "Qwen-Image + Z-Image-Turbo. Z-Image @ 256² ~37 s; Qwen-Image @ 256² ~330 s." },

  // Video
  { id: "sd-cpp-vulkan-wan22", label: "sd.cpp Vulkan + Wan 2.2", category: "Video",
    status: "active",
    detail: "Wan 2.2 T2V-A14B at 320×192 with Lightning LoRA: 1.3 min/sec. Higher resolutions tested up to 608×336." },

  // Voice
  { id: "piper", label: "piper (TTS)", category: "Voice",
    status: "active",
    detail: "en_US-amy-medium voice. Real-time-factor < 1 on CPU." },
  { id: "whisper-cpp", label: "whisper.cpp (STT)", category: "STT",
    status: "active",
    detail: "ggml-base.en + ggml-small.en + ggml-distil-small.en. Vulkan acceleration available." },
];

const STATUS_STYLE: Record<Status, { dot: string; label: string; text: string }> = {
  active:      { dot: "bg-emerald-400",        label: "ACTIVE",       text: "text-emerald-300" },
  supported:   { dot: "bg-emerald-400/40",     label: "SUPPORTED",    text: "text-emerald-300/70" },
  unsupported: { dot: "bg-red-500",            label: "UNSUPPORTED",  text: "text-red-300" },
  broken:      { dot: "bg-amber-400",          label: "BROKEN",       text: "text-amber-300" },
  untested:    { dot: "bg-white/30",           label: "UNTESTED",     text: "text-white/40" },
};

export function HarnessSupportMatrix() {
  const grouped = new Map<string, HarnessRow[]>();
  for (const r of ROWS) {
    if (!grouped.has(r.category)) grouped.set(r.category, []);
    grouped.get(r.category)!.push(r);
  }

  return (
    <div className="rounded-2xl p-6 border border-white/[0.06]" style={{ background: "rgba(20,20,28,0.55)" }}>
      <div className="flex items-baseline justify-between mb-1">
        <h2 className="text-base font-medium tracking-tight">Inference harnesses · what runs on this hardware</h2>
        <span className="text-[10px] text-white/30 font-mono uppercase tracking-wider">Arc 140T · Xe-LPG+ / Alchemist+</span>
      </div>
      <div className="text-[11px] text-white/40 mb-5">Negative findings are as important as positive ones. ⛔ marks confirmed-broken on this iGPU; ⏳ untested.</div>

      <div className="space-y-5">
        {[...grouped.entries()].map(([cat, rows]) => (
          <div key={cat}>
            <div className="text-[10px] uppercase tracking-wider text-white/40 font-bold mb-2">{cat}</div>
            <div className="space-y-2">
              {rows.map((r) => {
                const s = STATUS_STYLE[r.status];
                return (
                  <div key={r.id} className="flex items-start gap-3 py-1.5">
                    <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span className="text-sm text-white/90">{r.label}</span>
                        <span className={`text-[9px] uppercase tracking-wider font-bold ${s.text}`}>{s.label}</span>
                      </div>
                      <div className="text-[11px] text-white/55 mt-0.5 leading-relaxed">
                        {r.detail}
                        {r.issue && (
                          <>
                            {" "}
                            <a href={r.issue.url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:text-indigo-200 underline">
                              {r.issue.label}
                            </a>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-white/[0.04] text-[10px] text-white/40 leading-relaxed">
        <span className="text-white/60">Source:</span> live measurements + upstream issue trackers, last verified 2026-05-23. To revisit when: Intel ships iGPU-supporting <code className="text-white/60">vllm-xpu-kernels</code> · llama.cpp lands Xe-LPG+ coopmat detection · the reference machine gains a Battlemage discrete card.
      </div>
    </div>
  );
}
