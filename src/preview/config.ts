// Preview configuration (v1)
import type { PreviewConfig } from "../types.js";
import { PREVIEW_DEFAULTS, PREVIEW_STORAGE_KEYS } from "./shared/preview-defaults.js";

function clampInt(v: unknown, minV: number, maxV: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}

let _cachedConfig: PreviewConfig | null = null;

function buildPreviewConfig(): PreviewConfig {
  const canvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.canvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    PREVIEW_DEFAULTS.maxCanvasSize,
    PREVIEW_DEFAULTS.canvasSize,
  );
  const playbackCanvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.playbackCanvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    canvasSize,
    Math.min(canvasSize, PREVIEW_DEFAULTS.playbackCanvasSize),
  );
  const interactionCanvasSize = clampInt(
    localStorage.getItem(PREVIEW_STORAGE_KEYS.interactionCanvasSize),
    PREVIEW_DEFAULTS.minCanvasSize,
    playbackCanvasSize,
    Math.min(playbackCanvasSize, PREVIEW_DEFAULTS.interactionCanvasSize),
  );
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: clampInt(localStorage.getItem(PREVIEW_STORAGE_KEYS.debounceMs), 0, 2000, PREVIEW_DEFAULTS.debounceMs),
    maxGraphNodes: clampInt(localStorage.getItem(PREVIEW_STORAGE_KEYS.maxGraphNodes), 1, 10000, PREVIEW_DEFAULTS.maxGraphNodes),
  };
}

export function getPreviewConfig(): PreviewConfig {
  return (_cachedConfig ??= buildPreviewConfig());
}

export function invalidatePreviewConfig(): void {
  _cachedConfig = null;
}
