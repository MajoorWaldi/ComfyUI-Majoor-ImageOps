export const PREVIEW_STORAGE_KEYS = {
  canvasSize: "imageops.preview.canvasSize",
  playbackCanvasSize: "imageops.preview.playbackCanvasSize",
  interactionCanvasSize: "imageops.preview.interactionCanvasSize",
  debounceMs: "imageops.preview.debounceMs",
  maxGraphNodes: "imageops.preview.maxGraphNodes",
} as const;

export const PREVIEW_DEFAULTS = {
  minCanvasSize: 128,
  maxCanvasSize: 2048,
  canvasSize: 1024,
  playbackCanvasSize: 640,
  interactionCanvasSize: 448,
  debounceMs: 120,
  maxGraphNodes: 140,
} as const;
