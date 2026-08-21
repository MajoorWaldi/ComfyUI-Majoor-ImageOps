// Top-level guard: use a dynamic import so failures while evaluating the
// preview module are also absorbed instead of breaking ComfyUI's frontend.
void import("./preview/host.js")
  .then(({ registerImageOpsLivePreview }) => {
    try {
      registerImageOpsLivePreview();
    } catch (err) {
      console.error("[ImageOps] LivePreview failed to initialize — feature disabled, ComfyUI continues.", err);
    }
  })
  .catch((err) => {
    console.error("[ImageOps] LivePreview failed to load — feature disabled, ComfyUI continues.", err);
  });
export {};
