// Preview configuration (v1)
// User override: localStorage["imageops.preview.canvasSize"] (integer).

function clampInt(v, minV, maxV, fallback) {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}

export function getPreviewConfig() {
  const canvasSize = clampInt(localStorage.getItem("imageops.preview.canvasSize"), 128, 2048, 512);
  return {
    canvasSize,
    debounceMs: 120,
    maxGraphNodes: 140,
  };
}

