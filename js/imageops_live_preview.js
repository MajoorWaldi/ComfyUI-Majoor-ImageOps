import { registerImageOpsLivePreview } from "./preview/host.js";
try {
  registerImageOpsLivePreview();
} catch (err) {
  console.error("[ImageOps] LivePreview failed to initialize \u2014 feature disabled, ComfyUI continues.", err);
}
