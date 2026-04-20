function clampInt(v, minV, maxV, fallback) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}
let _cachedConfig = null;
function buildPreviewConfig() {
  const canvasSize = clampInt(localStorage.getItem("imageops.preview.canvasSize"), 128, 2048, 512);
  const playbackCanvasSize = clampInt(localStorage.getItem("imageops.preview.playbackCanvasSize"), 128, canvasSize, Math.min(canvasSize, 384));
  const interactionCanvasSize = clampInt(localStorage.getItem("imageops.preview.interactionCanvasSize"), 128, playbackCanvasSize, Math.min(playbackCanvasSize, 320));
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: 120,
    maxGraphNodes: 140
  };
}
function getPreviewConfig() {
  return _cachedConfig ?? (_cachedConfig = buildPreviewConfig());
}
function invalidatePreviewConfig() {
  _cachedConfig = null;
}
export {
  getPreviewConfig,
  invalidatePreviewConfig
};
