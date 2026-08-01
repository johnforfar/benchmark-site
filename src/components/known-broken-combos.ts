// Known-broken (model, harness) cell registry for the HarnessMatrix UI.
// Each entry surfaces as a red ❌ cell with the `reason` tooltip.
//
// `model` matches Row.model substring; `harness` matches a harness_id from
// HARNESS_LABEL. Use `model: "*"` to mark a whole-harness fail (e.g. "*
// chat models broken on llama.cpp OpenVINO"). The matcher is case-insensitive
// substring on model, exact-string on harness.
//
// Provenance line (source) is shown in the tooltip so operators can trace the
// claim back to a session note / memory file / upstream issue.
//
// Mined 2026-06-20 from ENGINEERING/*.md + memory/feedback_*.md + bench-worker
// EXPENSIVE_BASE_MODELS / catalog-exhaustion gates.

export interface BrokenCombo {
  model: string;          // substring or "*"
  harness: string;        // exact harness_id, or "*"
  modality?: "chat" | "image" | "video" | "voice" | "stt" | "*";
  reason: string;
  source: string;
}

export const KNOWN_BROKEN: BrokenCombo[] = [
  // ─── Chat / LLM ───
  { model: "bitnet", harness: "llama-cpp-vulkan", modality: "chat",
    reason: "No ternary kernel in Vulkan; CPU-only bitnet.cpp fork required",
    source: "ENGINEERING/2026-05-10_BENCH-WEEKLY-PROCESS.md" },
  { model: "*", harness: "llama-cpp-openvino", modality: "chat",
    reason: "50% request failure rate (an internal contributor bench 2026-04-06); not production-ready on any HW",
    source: "memory/feedback_arc140t_runtime_theory.md" },
  { model: "*", harness: "llama-cpp-sycl", modality: "chat",
    reason: "5× slower than Vulkan on Arc 140T iGPU (10.78 vs 52 tok/s); SYCL untuned for Xe-LPG+",
    source: "memory/feedback_arc140t_runtime_theory.md" },
  { model: "*", harness: "vllm-xpu-no-triton",
    reason: "Without --attention-backend TRITON_ATTN, crashes with 'Only XE2/XE3 cutlass kernel'. Arc 140T is Xe-LPG+/Alchemist+, not Xe2/Battlemage.",
    source: "memory/feedback_vllm_xpu_arc140t_unsupported.md" },
  { model: "*", harness: "llm-scaler-omni",
    reason: "Arc Pro B60/B70 (Battlemage) only. Marketing + firmware (bmg_guc/bmg_huc) explicitly exclude Xe-LPG+. Intel issue #402 confirms even newer Panther Lake B390 iGPU is broken.",
    source: "research 2026-06-20" },

  // ─── Image ───
  { model: "qwen-image-2512", harness: "sd-cpp-vulkan-4step",
    reason: "Non-distilled 20B DiT trained for 30-50 steps; 4-step output is half-denoised mush regardless of cfg/sampler/quant",
    source: "ENGINEERING/2026-05-13_IMAGE-GEN-LOCKED-Z-IMAGE-TURBO.md" },
  { model: "flux", harness: "sd-cpp-vulkan", modality: "image",
    reason: "Broken Vulkan path on Intel Arc (sd.cpp #1215/#1216/#1220); 5× slower vs ComfyUI + silent grey VAE OOM",
    source: "ENGINEERING/2026-05-13_IMAGE-GEN-LOCKED-Z-IMAGE-TURBO.md" },
  { model: "sd3.5", harness: "sd-cpp-vulkan", modality: "image",
    reason: "Vulkan black-image + T5 regression (sd.cpp #560, #1114); CPU-T5 workaround kills throughput",
    source: "ENGINEERING/2026-05-13_IMAGE-GEN-LOCKED-Z-IMAGE-TURBO.md" },
  { model: "qwen-image-2512-lightning8", harness: "vllm-omni-default-mem",
    reason: "GPU OOM after 3 consecutive gens at default --gpu-memory-utilization 0.9; needs 0.20 + --vae-use-slicing",
    source: "memory/feedback_vllm_xpu_arc140t_unsupported.md" },
  { model: "pixart|hunyuandit|auraflow|stable-cascade", harness: "sd-cpp-vulkan", modality: "image",
    reason: "Not in sd.cpp upstream; requires Diffusers/ComfyUI harness",
    source: "ENGINEERING/2026-05-13_IMAGE-GEN-LOCKED-Z-IMAGE-TURBO.md" },

  // ─── Video ───
  { model: "wan2.2-ti2v-5b", harness: "sd-cpp-vulkan", modality: "video",
    reason: "TI2V architecture requires init image; sd-cli T2V mode produces psychedelic noise with status=ok (silent). 477 historical runs archived 2026-06-20.",
    source: "memory/feedback_ti2v_t2v_silent_jibberish.md" },
  { model: "ltxv-2b-0.9.6", harness: "sd-cpp-vulkan", modality: "video",
    reason: "sd-cli current build expects LTX-2.x tensor architecture (video_to_audio_attn). 0.9.6 GGUF fails model_metadata validation at load.",
    source: "internal engineering log" },
  { model: "ltx-2.3", harness: "sd-cpp-vulkan-gemma3-4b",
    reason: "LTX-2.3 conditioner baked for Gemma-3 12B shapes (4096 hidden, 2048 head). Gemma-3 4B / Gemma-4 / non-Gemma fail with 'wrong shape in model metadata'.",
    source: "memory/feedback_ltx2_requires_gemma3_12b.md" },
  { model: "wan-image-2.0|qwen-image-2.0", harness: "sd-cpp-vulkan", modality: "image",
    reason: "No GGUF available; no sd.cpp support",
    source: "internal engineering notes" },
  { model: "hunyuanvideo-1.5", harness: "sd-cpp-vulkan", modality: "video",
    reason: "Not in sd.cpp upstream as of 2026-06; needs ComfyUI-GGUF + native torch.xpu harness",
    source: "research 2026-06-20" },

  // ─── Resource / config ceilings (manifest as cells when surfaced) ───
  { model: "qwen-image-2512-1024", harness: "sd-cpp-vulkan",
    reason: "OOMs at 50+ steps and 1024² on Arc 140T; iGPU ceiling is ~512² @ 30 steps (~40 min)",
    source: "ENGINEERING/2026-05-13_IMAGE-GEN-LOCKED-Z-IMAGE-TURBO.md" },
  { model: "*", harness: "llama-cpp-vulkan-q8",
    reason: "Q8_0 weight quant on Arc 140T loses 23% (47→36 tok/s); Xe-LPG+ dequant overhead exceeds bandwidth savings. Stick to BF16/Q4_K_M.",
    source: "internal engineering notes" },
  { model: "*", harness: "llama-cpp-vulkan-fa-q8kv",
    reason: "--flash-attn + --cache-type q8_0 combo causes 50→13 tok/s (4× regression) on Mesa ANV / Arc 140T",
    source: "internal engineering notes" },
];

// Quick lookup helper for the matrix UI.
export function findBrokenReason(model_id: string, harness_id: string): BrokenCombo | null {
  const m = model_id.toLowerCase();
  for (const entry of KNOWN_BROKEN) {
    const modelMatch = entry.model === "*"
      ? true
      : entry.model.split("|").some(p => m.includes(p.toLowerCase()));
    const harnessMatch = entry.harness === "*" || entry.harness === harness_id;
    if (modelMatch && harnessMatch) return entry;
  }
  return null;
}
