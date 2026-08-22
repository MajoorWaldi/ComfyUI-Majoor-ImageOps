import { isNode as isPreviewNode } from "../nodes/preview.js";
import { getPreviewConfig } from "../config.js";
import { isStressed } from "./fps-monitor.js";
function createInitialState(node) {
  return {
    hooked: false,
    _ownerNode: node,
    _ownerNodeId: node.id,
    _abortController: null,
    previewRoot: null,
    previewMetaRow: null,
    previewControls: null,
    canvas: null,
    info: null,
    progressWrap: null,
    progressBar: null,
    mediaWrap: null,
    mediaVideo: null,
    mediaImage: null,
    interactionUntil: 0,
    rafId: null,
    debounceTimer: null,
    lastKey: null,
    lastRenderTick: null,
    renderInFlight: false,
    queuedRenderTick: null,
    isPreview: isPreviewNode(node),
    nativeAnimated: false,
    nativeDirty: false,
    previewZoom: 1,
    previewPanX: 0,
    previewPanY: 0,
    previewPanDrag: null,
    previewNavigationHooked: false,
    previewLastSource: null,
    previewSourceWidth: 0,
    previewSourceHeight: 0,
    previewFrameIndex: null,
    cropAspectRatio: null,
    cropGeometry: null,
    cropDrag: null,
    cropResetButton: null,
    cropInteractiveHooked: false,
    rampGeometry: null,
    rampDrag: null,
    rampInteractiveHooked: false,
    drawAspectRatio: null,
    drawGeometry: null,
    drawHover: null,
    drawSizeHintUntil: 0,
    drawStroke: null,
    drawCanvas: null,
    drawBaseCanvas: null,
    drawUndoStack: [],
    drawOverlayKey: null,
    drawBrushButton: null,
    drawEraserButton: null,
    drawClearButton: null,
    drawColorInput: null,
    drawEdgeSelect: null,
    drawSoftnessInput: null,
    drawSoftnessLabel: null,
    drawOpacityInput: null,
    drawOpacityLabel: null,
    drawSizeInput: null,
    drawSizeLabel: null,
    drawWidthInput: null,
    drawHeightInput: null,
    drawLinkButton: null,
    drawBgColorInput: null,
    drawOverlayFormatSelect: null,
    drawPressureSizeInput: null,
    drawPressureOpacityInput: null,
    drawTiltSizeInput: null,
    drawInteractiveHooked: false,
    colorWheelCanvas: null,
    colorHueLabel: null,
    colorSatLabel: null,
    colorSwatch: null,
    colorResetButton: null,
    colorTemperatureInput: null,
    colorTemperatureLabel: null,
    colorTintInput: null,
    colorTintLabel: null,
    colorContrastInput: null,
    colorContrastLabel: null,
    colorSaturationInput: null,
    colorSaturationValueLabel: null,
    colorVibranceInput: null,
    colorVibranceLabel: null,
    colorGammaInput: null,
    colorGammaLabel: null,
    colorShadowWheelCanvas: null,
    colorShadowLabel: null,
    colorMidtoneWheelCanvas: null,
    colorMidtoneLabel: null,
    colorHighlightWheelCanvas: null,
    colorHighlightLabel: null,
    colorBrightnessInput: null,
    colorBrightnessLabel: null,
    colorZoneTabsRow: null,
    colorZoneTabGlobal: null,
    colorZoneTabShadows: null,
    colorZoneTabMidtones: null,
    colorZoneTabHighlights: null,
    colorActiveZone: "global",
    colorInteractiveHooked: false,
    compLayers: [],
    compOutputWidth: 1,
    compOutputHeight: 1,
    compSelectedSlot: null,
    compDrag: null,
    compAddButton: null,
    compRemoveButton: null,
    compResetButton: null,
    compResizeButton: null,
    compCornerPinButton: null,
    compAspectRatioSelect: null,
    compModeSelect: null,
    compOpacityInput: null,
    compOpacityLabel: null,
    compLayerLabel: null,
    compEditMode: "resize",
    compInteractiveHooked: false,
    cornerPinGeometry: null,
    cornerPinDrag: null,
    cornerPinInteractiveHooked: false,
    padOutGeometry: null,
    padOutDrag: null,
    padOutInteractiveHooked: false,
    padOutSourceWidth: 0,
    padOutSourceHeight: 0,
    padOutSourceCanvas: null,
    padOutBackendSourceW: 0,
    padOutBackendSourceH: 0,
    padOutBackendPadL: 0,
    padOutBackendPadT: 0,
    frameSelectorControls: null,
    frameSelectorLabel: null,
    frameSelectorTrimStart: null,
    frameSelectorTrimEnd: null,
    frameSelectorHoldFrame: null,
    frameSelectorRuler: null,
    frameSelectorSliderBox: null,
    frameSelectorFill: null,
    frameSelectorStartHandle: null,
    frameSelectorEndHandle: null,
    frameSelectorPlayhead: null,
    frameSelectorHoldToggle: null,
    frameSelectorRepeatToggle: null,
    frameSelectorRepeatModeSelect: null,
    frameSelectorRepeatCountInput: null,
    frameSelectorSourceCount: 0,
    frameSelectorHooked: false,
    keyerControls: null,
    keyerModeButtons: [],
    keyerInvertButton: null,
    keyerInvertMaskButton: null,
    keyerBypassButton: null,
    keyerPickButton: null,
    keyerColorInput: null,
    keyerToleranceInput: null,
    keyerSoftnessInput: null,
    keyerGainInput: null,
    keyerBlurInput: null,
    keyerPicking: false,
    keyerHooked: false
  };
}
function ensureState(node) {
  const existing = node.__imageops_state;
  if (!existing) {
    node.__imageops_state = createInitialState(node);
  } else if (existing._ownerNode && existing._ownerNode !== node) {
    node.__imageops_state = createInitialState(node);
  } else {
    existing._ownerNode = node;
    existing._ownerNodeId = node.id;
  }
  return node.__imageops_state;
}
function setInfo(st, text) {
  if (!st.info) return;
  const width = Math.max(0, Math.round(Number(st.previewSourceWidth) || 0));
  const height = Math.max(0, Math.round(Number(st.previewSourceHeight) || 0));
  const hasSize = /\b\d+\s*x\s*\d+\b/i.test(text) || /\b\d+\s*×\s*\d+\b/i.test(text);
  st.info.textContent = !hasSize && width > 0 && height > 0 ? `${text} (${width}x${height})` : text;
}
function markPreviewInteraction(node, holdMs = 350) {
  const st = ensureState(node);
  st.interactionUntil = Math.max(st.interactionUntil ?? 0, performance.now() + holdMs);
}
function getRenderCanvasSize(st) {
  const cfg = getPreviewConfig();
  const now = performance.now();
  const stressed = isStressed();
  if ((st.interactionUntil ?? 0) > now) {
    return stressed ? Math.max(1, Math.round(cfg.interactionCanvasSize * 0.75)) : cfg.interactionCanvasSize;
  }
  if (st.rafId != null) {
    return stressed ? Math.max(1, Math.round(cfg.playbackCanvasSize * 0.75)) : cfg.playbackCanvasSize;
  }
  return stressed ? Math.max(1, Math.round(cfg.canvasSize * 0.85)) : cfg.canvasSize;
}
function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}
function serializePreviewValue(value) {
  if (value == null) return "null";
  if (typeof value === "string") {
    return value.length > 120 ? `str:${value.length}:${hashText(value)}` : `str:${value}`;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return `arr:${value.length}:${value.map((entry) => serializePreviewValue(entry)).join(",")}`;
  }
  try {
    const json = JSON.stringify(value);
    if (!json) return String(value);
    return json.length > 120 ? `json:${json.length}:${hashText(json)}` : `json:${json}`;
  } catch {
    return String(value);
  }
}
function buildPreviewRenderKey(node, tick, st, renderCanvasSize) {
  const parts = [
    String(node.id),
    String(node.comfyClass ?? ""),
    `tick:${tick}`,
    `canvas:${renderCanvasSize}`,
    `dirty:${st.nativeDirty ? 1 : 0}`,
    `anim:${st.nativeAnimated ? 1 : 0}`,
    `imageIndex:${typeof node.imageIndex === "number" ? node.imageIndex : -1}`,
    `imgs:${Array.isArray(node.imgs) ? node.imgs.length : 0}`
  ];
  for (const widget of node.widgets ?? []) {
    parts.push(`${widget?.name ?? "widget"}=${serializePreviewValue(widget?.value)}`);
  }
  for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const input = node.inputs?.[index];
    parts.push(`in${index}:${input?.name ?? ""}:${input?.link ?? "null"}`);
  }
  return parts.join("|");
}
export {
  buildPreviewRenderKey,
  ensureState,
  getRenderCanvasSize,
  hashText,
  markPreviewInteraction,
  serializePreviewValue,
  setInfo
};
