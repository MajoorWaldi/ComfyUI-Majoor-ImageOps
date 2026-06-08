import { PREVIEW_DEFAULTS, PREVIEW_STORAGE_KEYS } from "./shared/preview-defaults.js";
function clampInt(v, minV, maxV, fallback) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}
let _cachedConfig = null;
function buildPreviewConfig() {
  const canvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.canvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    PREVIEW_DEFAULTS.maxCanvasSize,
    PREVIEW_DEFAULTS.canvasSize
  );
  const playbackCanvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.playbackCanvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    canvasSize,
    Math.min(canvasSize, PREVIEW_DEFAULTS.playbackCanvasSize)
  );
  const interactionCanvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.interactionCanvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    playbackCanvasSize,
    Math.min(playbackCanvasSize, PREVIEW_DEFAULTS.interactionCanvasSize)
  );
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: clampInt(localStorage.getItem(PREVIEW_STORAGE_KEYS.debounceMs), 0, 2e3, PREVIEW_DEFAULTS.debounceMs),
    maxGraphNodes: clampInt(localStorage.getItem(PREVIEW_STORAGE_KEYS.maxGraphNodes), 1, 1e4, PREVIEW_DEFAULTS.maxGraphNodes)
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
