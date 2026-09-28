import { PREVIEW_DEFAULTS, PREVIEW_SETTING_IDS } from "./shared/preview-defaults.js";

export function buildPreviewSettings(onChange: () => void) {
  const slider = (
    key: keyof typeof PREVIEW_SETTING_IDS,
    name: string,
    tooltip: string,
    min: number,
    max: number,
    step: number,
  ) => ({
    id: PREVIEW_SETTING_IDS[key],
    name,
    type: "slider",
    defaultValue: PREVIEW_DEFAULTS[key],
    attrs: { min, max, step },
    tooltip,
    onChange,
  });

  return [
    slider("canvasSize", "ImageOps live preview size (px)", "Longest side of the live preview when idle.", PREVIEW_DEFAULTS.minCanvasSize, PREVIEW_DEFAULTS.maxCanvasSize, 64),
    slider("playbackCanvasSize", "ImageOps preview size during playback (px)", "Longest side while a video preview plays. Capped by the idle size.", PREVIEW_DEFAULTS.minCanvasSize, PREVIEW_DEFAULTS.maxCanvasSize, 64),
    slider("interactionCanvasSize", "ImageOps preview size while editing (px)", "Longest side while dragging handles or sliders. Capped by the playback size.", PREVIEW_DEFAULTS.minCanvasSize, PREVIEW_DEFAULTS.maxCanvasSize, 64),
    slider("debounceMs", "ImageOps preview refresh delay (ms)", "Wait after the last change before the preview re-renders.", 0, 2000, 10),
    slider("maxGraphNodes", "ImageOps preview max graph nodes", "Above this many nodes the live preview turns itself off.", 1, 10000, 10),
  ];
}
