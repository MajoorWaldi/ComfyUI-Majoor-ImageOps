void import("./preview/host.js").then(({ registerImageOpsLivePreview }) => {
  try {
    registerImageOpsLivePreview();
  } catch (err) {
    console.error("[ImageOps] LivePreview failed to initialize \u2014 feature disabled, ComfyUI continues.", err);
  }
}).catch((err) => {
  console.error("[ImageOps] LivePreview failed to load \u2014 feature disabled, ComfyUI continues.", err);
});
