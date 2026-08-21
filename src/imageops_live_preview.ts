import { registerImageOpsLivePreview } from "./preview/host.js";

// Top-level guard: never let an internal error propagate up to ComfyUI's
// extension loader. If anything here throws, the rest of ComfyUI must keep
// working — only the live preview feature degrades.
try {
  registerImageOpsLivePreview();
} catch (err) {
  console.error("[ImageOps] LivePreview failed to initialize — feature disabled, ComfyUI continues.", err);
}
export {};
