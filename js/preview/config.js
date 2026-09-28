import { PREVIEW_DEFAULTS, PREVIEW_SETTING_IDS, PREVIEW_STORAGE_KEYS } from "./shared/preview-defaults.js";
function clampInt(v, minV, maxV, fallback) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}
let _cachedConfig = null;
let readSetting = () => void 0;
function setPreviewSettingReader(reader) {
  readSetting = reader;
  invalidatePreviewConfig();
}
function configuredValue(key) {
  const fromSetting = readSetting(PREVIEW_SETTING_IDS[key]);
  if (fromSetting === void 0 || fromSetting === PREVIEW_DEFAULTS[key]) {
    return localStorage.getItem(PREVIEW_STORAGE_KEYS[key]) ?? fromSetting;
  }
  return fromSetting;
}
function buildPreviewConfig() {
  const canvasSize = clampInt(
    configuredValue("canvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    PREVIEW_DEFAULTS.maxCanvasSize,
    PREVIEW_DEFAULTS.canvasSize
  );
  const playbackCanvasSize = clampInt(
    configuredValue("playbackCanvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    canvasSize,
    Math.min(canvasSize, PREVIEW_DEFAULTS.playbackCanvasSize)
  );
  const interactionCanvasSize = clampInt(
    configuredValue("interactionCanvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    playbackCanvasSize,
    Math.min(playbackCanvasSize, PREVIEW_DEFAULTS.interactionCanvasSize)
  );
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: clampInt(configuredValue("debounceMs"), 0, 2e3, PREVIEW_DEFAULTS.debounceMs),
    maxGraphNodes: clampInt(configuredValue("maxGraphNodes"), 1, 1e4, PREVIEW_DEFAULTS.maxGraphNodes)
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
  invalidatePreviewConfig,
  setPreviewSettingReader
};
