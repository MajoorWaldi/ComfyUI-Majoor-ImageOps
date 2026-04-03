// Preview configuration (v1)
// User override: localStorage["imageops.preview.canvasSize"] (integer).
import type { PreviewConfig } from "../types.js";

function clampInt(v: unknown, minV: number, maxV: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}

export function getPreviewConfig(): PreviewConfig {
  const canvasSize = clampInt(localStorage.getItem("imageops.preview.canvasSize"), 128, 2048, 512);
  const playbackCanvasSize = clampInt(localStorage.getItem("imageops.preview.playbackCanvasSize"), 128, canvasSize, Math.min(canvasSize, 384));
  const interactionCanvasSize = clampInt(localStorage.getItem("imageops.preview.interactionCanvasSize"), 128, playbackCanvasSize, Math.min(playbackCanvasSize, 320));
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: 120,
    maxGraphNodes: 140,
  };
}
