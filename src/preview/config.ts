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
  return {
    canvasSize,
    debounceMs: 120,
    maxGraphNodes: 140,
  };
}
