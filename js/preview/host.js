import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { buildRenderer } from "./renderer.js";
import { buildAdapterRegistry } from "./registry.js";
import { detectSourceUpstream, getInputLink, getUpstreamNode, isGraphTooLarge, findDependents } from "./graph.js";
import { resolveNodeStreamPreview } from "./nodestream.js";
import { attachProgressBus } from "./progress.js";
import { getPreviewConfig } from "./config.js";
import { initOpsConstants } from "./constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "./crop.js";
import { COMP_BLEND_MODES, clampCompCenter, clampCompScale, getCompSlots, serializeCompLayers, syncCompLayers } from "./comp.js";
import { canvasToOverlayData, clampDrawDimension, clampDrawOpacity, clampDrawSize, normalizeDrawColor, normalizeDrawTool, renderDrawPreview, resolveDrawOverlayCanvas, resizeCanvasPreserve } from "./draw.js";
import { renderCompPreview } from "./ops.js";
console.info("[ImageOps] LivePreview v6 loaded");
const EXT_NAME = "ImageOps.LivePreview.v6";
const IMAGEOPS_CLASSES = /* @__PURE__ */ new Set([
  "ImageOpsColorAjust",
  "ImageOpsBlur",
  "ImageOpsChannel",
  "ImageOpsComp",
  "ImageOpsCrop",
  "ImageOpsDistort",
  "ImageOpsDraw",
  "ImageOpsTransform",
  "ImageOpsInvert",
  "ImageOpsClamp",
  "ImageOpsMerge",
  "ImageOpsNoise",
  "ImageOpsPreview"
]);
function isPreviewNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsPreview";
}
function ensureState(node) {
  node.__imageops_state ?? (node.__imageops_state = {
    hooked: false,
    canvas: null,
    scopes: null,
    abCanvas: null,
    abEnabled: false,
    wipe: 0.5,
    overlay: "none",
    showHistogram: true,
    showWaveform: true,
    waveformMode: "luma",
    showVectorscope: false,
    info: null,
    progressWrap: null,
    progressBar: null,
    mediaWrap: null,
    mediaVideo: null,
    mediaImage: null,
    rafId: null,
    debounceTimer: null,
    lastKey: null,
    lastRenderTick: null,
    renderInFlight: false,
    queuedRenderTick: null,
    renderNonce: 0,
    isPreview: isPreviewNode(node),
    nativeAnimated: false,
    nativeDirty: false,
    cropAspectRatio: null,
    cropGeometry: null,
    cropDrag: null,
    cropResetButton: null,
    cropInteractiveHooked: false,
    drawAspectRatio: null,
    drawGeometry: null,
    drawStroke: null,
    drawCanvas: null,
    drawBaseCanvas: null,
    drawOverlayKey: null,
    drawBrushButton: null,
    drawEraserButton: null,
    drawClearButton: null,
    drawColorInput: null,
    drawOpacityInput: null,
    drawOpacityLabel: null,
    drawSizeInput: null,
    drawSizeLabel: null,
    drawWidthInput: null,
    drawHeightInput: null,
    drawLinkButton: null,
    drawBgColorInput: null,
    drawInteractiveHooked: false,
    compLayers: [],
    compOutputWidth: 1,
    compOutputHeight: 1,
    compSelectedSlot: null,
    compDrag: null,
    compAddButton: null,
    compResetButton: null,
    compModeSelect: null,
    compOpacityInput: null,
    compOpacityLabel: null,
    compLayerLabel: null,
    compInteractiveHooked: false
  });
  return node.__imageops_state;
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
function buildPreviewRenderKey(node, tick, st) {
  const parts = [
    String(node.id),
    String(node.comfyClass ?? ""),
    `tick:${tick}`,
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
function stopRAF(st) {
  if (st?.rafId) {
    cancelAnimationFrame(st.rafId);
    st.rafId = null;
  }
}
function styleSoftButton(button, active = false) {
  button.style.border = "1px solid rgba(255,255,255,0.12)";
  button.style.background = active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)";
  button.style.color = "rgba(255,255,255,0.94)";
  button.style.borderRadius = "6px";
  button.style.padding = "4px 8px";
  button.style.cursor = "pointer";
  button.style.fontSize = "11px";
  button.style.lineHeight = "1.2";
}
function styleSoftField(field) {
  field.style.borderRadius = "6px";
  field.style.border = "1px solid rgba(255,255,255,0.12)";
  field.style.background = "rgba(0,0,0,0.28)";
  field.style.color = "rgba(255,255,255,0.95)";
  field.style.padding = "4px 6px";
  field.style.boxSizing = "border-box";
  field.style.fontSize = "11px";
}
function styleSoftRange(field) {
  field.style.width = "100%";
  field.style.margin = "0";
  field.style.boxSizing = "border-box";
  field.style.cursor = "pointer";
}
function styleInlineAction(button) {
  button.style.border = "none";
  button.style.background = "transparent";
  button.style.color = "rgba(255,255,255,0.85)";
  button.style.fontSize = "11px";
  button.style.cursor = "pointer";
  button.style.padding = "0";
}
function setControlDisabled(control, disabled) {
  if (!control) return;
  control.disabled = disabled;
  control.style.opacity = disabled ? "0.55" : "1";
  if ("style" in control && control instanceof HTMLButtonElement) {
    control.style.cursor = disabled ? "default" : "pointer";
  }
}
function ensurePreviewWidget(node, progress, canvasSize) {
  if (!IMAGEOPS_CLASSES.has(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;
  const cropNode = isCropNode(node);
  const drawNode = isDrawNode(node);
  const compNode = isCompNode(node);
  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.boxSizing = "border-box";
  root.style.padding = "6px";
  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.display = "block";
  canvas.style.borderRadius = "8px";
  canvas.style.background = "rgba(0,0,0,0.35)";
  canvas.style.border = "1px solid rgba(255,255,255,0.08)";
  canvas.style.touchAction = "none";
  const mediaWrap = document.createElement("div");
  mediaWrap.style.width = "100%";
  mediaWrap.style.display = "none";
  mediaWrap.style.borderRadius = "8px";
  mediaWrap.style.overflow = "hidden";
  mediaWrap.style.background = "rgba(0,0,0,0.35)";
  mediaWrap.style.border = "1px solid rgba(255,255,255,0.08)";
  const mediaVideo = document.createElement("video");
  mediaVideo.controls = false;
  mediaVideo.loop = true;
  mediaVideo.muted = true;
  mediaVideo.playsInline = true;
  mediaVideo.autoplay = true;
  mediaVideo.preload = "metadata";
  mediaVideo.style.width = "100%";
  mediaVideo.style.height = "auto";
  mediaVideo.style.display = "block";
  mediaVideo.style.background = "transparent";
  mediaVideo.hidden = true;
  const mediaImage = document.createElement("img");
  mediaImage.style.width = "100%";
  mediaImage.style.height = "auto";
  mediaImage.style.display = "block";
  mediaImage.style.background = "transparent";
  mediaImage.hidden = true;
  mediaWrap.appendChild(mediaVideo);
  mediaWrap.appendChild(mediaImage);
  const metaRow = document.createElement("div");
  metaRow.style.marginTop = "6px";
  metaRow.style.display = "flex";
  metaRow.style.alignItems = "center";
  metaRow.style.justifyContent = "space-between";
  metaRow.style.gap = "8px";
  const info = document.createElement("div");
  info.style.fontSize = "11px";
  info.style.opacity = "0.8";
  info.style.flex = "1 1 auto";
  info.textContent = "Live preview (no queue)";
  let cropResetButton = null;
  if (cropNode) {
    cropResetButton = document.createElement("button");
    cropResetButton.type = "button";
    cropResetButton.textContent = "Reset";
    styleInlineAction(cropResetButton);
    cropResetButton.style.opacity = "0.85";
  }
  let compAddButton = null;
  let compResetButton = null;
  let compModeSelect = null;
  let compOpacityInput = null;
  let compOpacityLabel = null;
  let compLayerLabel = null;
  let compControls = null;
  if (compNode) {
    compControls = document.createElement("div");
    compControls.style.marginTop = "8px";
    compControls.style.display = "grid";
    compControls.style.gridTemplateColumns = "auto auto 1fr";
    compControls.style.gap = "6px";
    compControls.style.alignItems = "center";
    compAddButton = document.createElement("button");
    compAddButton.type = "button";
    compAddButton.textContent = "+ Add layer";
    styleSoftButton(compAddButton, false);
    compResetButton = document.createElement("button");
    compResetButton.type = "button";
    compResetButton.textContent = "Reset layer";
    styleSoftButton(compResetButton, false);
    compLayerLabel = document.createElement("div");
    compLayerLabel.style.fontSize = "11px";
    compLayerLabel.style.opacity = "0.85";
    compLayerLabel.style.justifySelf = "end";
    compLayerLabel.textContent = "Layer";
    const compBottomRow = document.createElement("div");
    compBottomRow.style.gridColumn = "1 / -1";
    compBottomRow.style.display = "grid";
    compBottomRow.style.gridTemplateColumns = "minmax(0,1fr) auto minmax(110px,0.9fr)";
    compBottomRow.style.gap = "6px";
    compBottomRow.style.alignItems = "center";
    compModeSelect = document.createElement("select");
    compModeSelect.style.width = "100%";
    styleSoftField(compModeSelect);
    for (const mode of COMP_BLEND_MODES) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode.replace("_", " ");
      compModeSelect.appendChild(option);
    }
    compOpacityLabel = document.createElement("div");
    compOpacityLabel.textContent = "100%";
    compOpacityLabel.style.fontSize = "11px";
    compOpacityLabel.style.opacity = "0.82";
    compOpacityLabel.style.justifySelf = "end";
    compOpacityInput = document.createElement("input");
    compOpacityInput.type = "range";
    compOpacityInput.min = "0";
    compOpacityInput.max = "100";
    compOpacityInput.step = "1";
    compOpacityInput.value = "100";
    compOpacityInput.title = "Layer opacity";
    styleSoftRange(compOpacityInput);
    compControls.appendChild(compAddButton);
    compControls.appendChild(compResetButton);
    compControls.appendChild(compLayerLabel);
    compBottomRow.appendChild(compModeSelect);
    compBottomRow.appendChild(compOpacityLabel);
    compBottomRow.appendChild(compOpacityInput);
    compControls.appendChild(compBottomRow);
  }
  let drawBrushButton = null;
  let drawEraserButton = null;
  let drawClearButton = null;
  let drawColorInput = null;
  let drawOpacityInput = null;
  let drawOpacityLabel = null;
  let drawSizeInput = null;
  let drawSizeLabel = null;
  let drawWidthInput = null;
  let drawHeightInput = null;
  let drawLinkButton = null;
  let drawBgColorInput = null;
  let drawControls = null;
  if (drawNode) {
    drawControls = document.createElement("div");
    drawControls.style.marginTop = "8px";
    drawControls.style.display = "grid";
    drawControls.style.gap = "8px";
    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.justifyContent = "space-between";
    topRow.style.gap = "8px";
    const toolRow = document.createElement("div");
    toolRow.style.display = "flex";
    toolRow.style.alignItems = "center";
    toolRow.style.gap = "6px";
    drawBrushButton = document.createElement("button");
    drawBrushButton.type = "button";
    drawBrushButton.textContent = "Brush";
    styleSoftButton(drawBrushButton, true);
    drawEraserButton = document.createElement("button");
    drawEraserButton.type = "button";
    drawEraserButton.textContent = "Eraser";
    styleSoftButton(drawEraserButton, false);
    drawClearButton = document.createElement("button");
    drawClearButton.type = "button";
    drawClearButton.textContent = "Clear";
    styleInlineAction(drawClearButton);
    toolRow.appendChild(drawBrushButton);
    toolRow.appendChild(drawEraserButton);
    topRow.appendChild(toolRow);
    topRow.appendChild(drawClearButton);
    const strokeRow = document.createElement("div");
    strokeRow.style.display = "grid";
    strokeRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto minmax(0,1fr)";
    strokeRow.style.alignItems = "center";
    strokeRow.style.gap = "6px";
    const colorLabel = document.createElement("div");
    colorLabel.textContent = "Color";
    colorLabel.style.fontSize = "11px";
    colorLabel.style.opacity = "0.78";
    drawColorInput = document.createElement("input");
    drawColorInput.type = "color";
    drawColorInput.value = "#FFFFFF";
    drawColorInput.style.width = "100%";
    drawColorInput.style.height = "30px";
    drawColorInput.style.padding = "2px";
    styleSoftField(drawColorInput);
    drawOpacityLabel = document.createElement("div");
    drawOpacityLabel.textContent = "100%";
    drawOpacityLabel.style.fontSize = "11px";
    drawOpacityLabel.style.opacity = "0.82";
    drawOpacityLabel.style.justifySelf = "end";
    drawOpacityInput = document.createElement("input");
    drawOpacityInput.type = "range";
    drawOpacityInput.min = "0";
    drawOpacityInput.max = "100";
    drawOpacityInput.step = "1";
    drawOpacityInput.value = "100";
    drawOpacityInput.title = "Brush opacity";
    styleSoftRange(drawOpacityInput);
    strokeRow.appendChild(colorLabel);
    strokeRow.appendChild(drawColorInput);
    strokeRow.appendChild(drawOpacityLabel);
    strokeRow.appendChild(drawOpacityInput);
    const sizeRow = document.createElement("div");
    sizeRow.style.display = "grid";
    sizeRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto auto auto auto auto";
    sizeRow.style.alignItems = "center";
    sizeRow.style.gap = "6px";
    const sizeLabel = document.createElement("div");
    sizeLabel.textContent = "Size";
    sizeLabel.style.fontSize = "11px";
    sizeLabel.style.opacity = "0.78";
    drawSizeInput = document.createElement("input");
    drawSizeInput.type = "range";
    drawSizeInput.min = "1";
    drawSizeInput.max = "256";
    drawSizeInput.step = "1";
    drawSizeInput.value = "10";
    drawSizeInput.title = "Brush size";
    styleSoftRange(drawSizeInput);
    drawSizeLabel = document.createElement("div");
    drawSizeLabel.textContent = "10";
    drawSizeLabel.style.fontSize = "11px";
    drawSizeLabel.style.opacity = "0.82";
    drawSizeLabel.style.justifySelf = "end";
    drawWidthInput = document.createElement("input");
    drawWidthInput.type = "number";
    drawWidthInput.min = "64";
    drawWidthInput.max = "4096";
    drawWidthInput.step = "64";
    drawWidthInput.value = "1024";
    drawWidthInput.placeholder = "W";
    drawWidthInput.title = "Width";
    styleSoftField(drawWidthInput);
    drawHeightInput = document.createElement("input");
    drawHeightInput.type = "number";
    drawHeightInput.min = "64";
    drawHeightInput.max = "4096";
    drawHeightInput.step = "64";
    drawHeightInput.value = "1024";
    drawHeightInput.placeholder = "H";
    drawHeightInput.title = "Height";
    styleSoftField(drawHeightInput);
    drawLinkButton = document.createElement("button");
    drawLinkButton.type = "button";
    drawLinkButton.textContent = "Linked";
    styleSoftButton(drawLinkButton, true);
    drawBgColorInput = document.createElement("input");
    drawBgColorInput.type = "color";
    drawBgColorInput.value = "#000000";
    drawBgColorInput.style.width = "34px";
    drawBgColorInput.style.height = "30px";
    drawBgColorInput.style.padding = "2px";
    drawBgColorInput.title = "Background color";
    styleSoftField(drawBgColorInput);
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(drawSizeInput);
    sizeRow.appendChild(drawSizeLabel);
    sizeRow.appendChild(drawWidthInput);
    sizeRow.appendChild(drawHeightInput);
    sizeRow.appendChild(drawLinkButton);
    sizeRow.appendChild(drawBgColorInput);
    drawControls.appendChild(topRow);
    drawControls.appendChild(strokeRow);
    drawControls.appendChild(sizeRow);
  }
  const progressWrap = document.createElement("div");
  progressWrap.style.marginTop = "6px";
  progressWrap.style.height = "6px";
  progressWrap.style.borderRadius = "999px";
  progressWrap.style.background = "rgba(255,255,255,0.12)";
  progressWrap.style.overflow = "hidden";
  progressWrap.style.display = "none";
  const progressBar = document.createElement("div");
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.borderRadius = "999px";
  progressBar.style.background = "rgba(255,255,255,0.55)";
  progressWrap.appendChild(progressBar);
  root.appendChild(mediaWrap);
  root.appendChild(canvas);
  metaRow.appendChild(info);
  if (cropResetButton) metaRow.appendChild(cropResetButton);
  root.appendChild(metaRow);
  if (drawControls) root.appendChild(drawControls);
  if (compControls) root.appendChild(compControls);
  root.appendChild(progressWrap);
  node.addDOMWidget("preview", "ImageOpsPreview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 280
  });
  try {
    const widgets = node.widgets ?? [];
    const idx = widgets.findIndex((w) => w?.name === "preview");
    if (idx > 0) {
      const [removed] = widgets.splice(idx, 1);
      widgets.unshift(removed);
    }
  } catch {
  }
  st.canvas = canvas;
  st.scopes = null;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.mediaWrap = mediaWrap;
  st.mediaVideo = mediaVideo;
  st.mediaImage = mediaImage;
  st.cropResetButton = cropResetButton;
  st.drawBrushButton = drawBrushButton;
  st.drawEraserButton = drawEraserButton;
  st.drawClearButton = drawClearButton;
  st.drawColorInput = drawColorInput;
  st.drawOpacityInput = drawOpacityInput;
  st.drawOpacityLabel = drawOpacityLabel;
  st.drawSizeInput = drawSizeInput;
  st.drawSizeLabel = drawSizeLabel;
  st.drawWidthInput = drawWidthInput;
  st.drawHeightInput = drawHeightInput;
  st.drawLinkButton = drawLinkButton;
  st.drawBgColorInput = drawBgColorInput;
  st.compAddButton = compAddButton;
  st.compResetButton = compResetButton;
  st.compModeSelect = compModeSelect;
  st.compOpacityInput = compOpacityInput;
  st.compOpacityLabel = compOpacityLabel;
  st.compLayerLabel = compLayerLabel;
  try {
    node.setSize?.([Math.max(node.size?.[0] ?? 360, 360), Math.max(node.size?.[1] ?? 420, 420)]);
    node.resizable = true;
  } catch {
  }
  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }
  return st;
}
function schedule(node, fn, delayMs = 120) {
  const st = ensureState(node);
  if (st.debounceTimer) clearTimeout(st.debounceTimer);
  st.debounceTimer = setTimeout(fn, delayMs);
}
function isCropNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsCrop";
}
function isDrawNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsDraw";
}
function isCompNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsComp";
}
function widgetHasAnimatedValues(value) {
  if (!Array.isArray(value)) return false;
  if (value.length > 1) return true;
  return value.length === 1 ? widgetHasAnimatedValues(value[0]) : false;
}
function widgetAnimatedLength(value) {
  if (!Array.isArray(value)) return 1;
  if (value.length > 1) return value.length;
  return value.length === 1 ? widgetAnimatedLength(value[0]) : 1;
}
function getProceduralFrameCount(node) {
  const cls = String(node?.comfyClass ?? "");
  const animatedLength = Math.max(1, ...(node.widgets ?? []).map((entry) => widgetAnimatedLength(entry?.value)));
  if (cls !== "ImageOpsNoise") {
    return animatedLength > 1 ? animatedLength : null;
  }
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name, fallback = 0) => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const batchSize = Math.max(1, Math.round(numeric("batch_size", 1)));
  const frameLength = Math.max(0, Math.round(numeric("frame_length", 0)));
  const frameCount = frameLength > 0 ? frameLength : batchSize;
  return Math.max(frameCount, animatedLength);
}
function hasProceduralAnimation(node) {
  const cls = String(node?.comfyClass ?? "");
  const animatedWidgets = (node.widgets ?? []).some((entry) => widgetHasAnimatedValues(entry?.value));
  if (cls !== "ImageOpsNoise") return animatedWidgets && (getProceduralFrameCount(node) ?? 1) > 1;
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name, fallback = 0) => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const frameCount = getProceduralFrameCount(node) ?? 1;
  if (frameCount <= 1) return false;
  if (numeric("seed_step", 0) !== 0) return true;
  if (numeric("frame_offset_x", 0) !== 0) return true;
  if (numeric("frame_offset_y", 0) !== 0) return true;
  return animatedWidgets;
}
function getProceduralPlaybackFps(node) {
  const cls = String(node?.comfyClass ?? "");
  if (cls !== "ImageOpsNoise") return null;
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const value = parseFloat(widget("fps")?.value);
  return Number.isFinite(value) ? Math.max(1, value) : 12;
}
function getInputIndexByName(node, name) {
  return (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === name);
}
function getNativePreviewImage(node) {
  const imgs = node.imgs;
  if (!Array.isArray(imgs) || imgs.length === 0) return null;
  const index = typeof node.imageIndex === "number" ? node.imageIndex : imgs.length - 1;
  const candidate = imgs[Math.max(0, Math.min(imgs.length - 1, index))] ?? imgs[imgs.length - 1] ?? null;
  return candidate instanceof HTMLImageElement ? candidate : null;
}
function hideNativeMediaPreview(st) {
  if (st.mediaVideo) {
    st.mediaVideo.pause();
    st.mediaVideo.hidden = true;
    st.mediaVideo.removeAttribute("src");
    st.mediaVideo.load();
  }
  if (st.mediaImage) {
    st.mediaImage.hidden = true;
    st.mediaImage.removeAttribute("src");
  }
  if (st.mediaWrap) st.mediaWrap.style.display = "none";
  if (st.canvas) st.canvas.style.display = "block";
}
function parsePreviewSourceUrl(src) {
  try {
    return new URL(src, window.location.href);
  } catch {
    return null;
  }
}
function nativePreviewFilename(node) {
  const img = getNativePreviewImage(node);
  const parsed = parsePreviewSourceUrl(img?.src ?? "");
  return parsed?.searchParams.get("filename") ?? null;
}
function buildMediaPreviewUrl(node, canvasSize) {
  const img = getNativePreviewImage(node);
  const parsed = parsePreviewSourceUrl(img?.src ?? "");
  if (!parsed) return null;
  const filename = parsed.searchParams.get("filename");
  const type = parsed.searchParams.get("type") ?? "temp";
  const subfolder = parsed.searchParams.get("subfolder") ?? "";
  if (!filename) return null;
  const params = new URLSearchParams({
    filename,
    type,
    subfolder,
    force_size: `${Math.max(128, canvasSize * 2)}x?`,
    deadline: "realtime"
  });
  return api.apiURL(`/imageops/viewmedia?${params.toString()}`);
}
function showNativeMediaPreview(node, st, canvasSize) {
  if (!st.nativeAnimated || !st.mediaWrap) return false;
  const img = getNativePreviewImage(node);
  if (!img) return false;
  const filename = String(nativePreviewFilename(node) ?? "").toLowerCase();
  const isAnimatedImage = filename.endsWith(".webp") || filename.endsWith(".gif");
  if (isAnimatedImage && st.mediaImage) {
    if (st.mediaVideo) {
      st.mediaVideo.pause();
      st.mediaVideo.hidden = true;
      st.mediaVideo.removeAttribute("src");
      st.mediaVideo.load();
    }
    st.mediaWrap.style.display = "block";
    st.mediaImage.hidden = false;
    if (st.mediaImage.src !== img.src) {
      st.mediaImage.src = img.src;
    }
    if (st.canvas) st.canvas.style.display = "none";
    return true;
  }
  if (!st.mediaVideo) return false;
  const mediaUrl = buildMediaPreviewUrl(node, canvasSize);
  if (!mediaUrl) return false;
  if (st.mediaImage) {
    st.mediaImage.hidden = true;
    st.mediaImage.removeAttribute("src");
  }
  st.mediaWrap.style.display = "block";
  st.mediaVideo.hidden = false;
  if (st.mediaVideo.src !== mediaUrl) {
    st.mediaVideo.src = mediaUrl;
  }
  st.mediaVideo.muted = true;
  void st.mediaVideo.play().catch(() => {
  });
  if (st.canvas) st.canvas.style.display = "none";
  return true;
}
function findWidget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) ?? null;
}
function widgetNumber(node, name, fallback = 0) {
  const value = findWidget(node, name)?.value;
  const parsed = parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function widgetString(node, name, fallback = "") {
  const value = findWidget(node, name)?.value;
  return typeof value === "string" ? value : fallback;
}
function widgetBoolean(node, name, fallback = false) {
  const value = findWidget(node, name)?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !!value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}
function resolveCropAspectRatioValue(node, fallbackWidth = 1, fallbackHeight = 1) {
  return resolveCropAspectRatio(
    widgetString(node, "aspect_ratio", "custom"),
    Math.max(1, widgetNumber(node, "width", fallbackWidth)),
    Math.max(1, widgetNumber(node, "height", fallbackHeight))
  );
}
function hideWidgetForGood(node, widget, suffix = "") {
  if (!widget) return;
  widget.origType = widget.type;
  widget.origComputeSize = widget.computeSize;
  widget.computeSize = () => [0, -4];
  widget.type = `converted-widget${suffix}`;
  if (widget.linkedWidgets) {
    for (const linked of widget.linkedWidgets) {
      hideWidgetForGood(node, linked, `:${widget.name}`);
    }
  }
}
function hideCropGeometryWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "crop_center_x"));
  hideWidgetForGood(node, findWidget(node, "crop_center_y"));
  hideWidgetForGood(node, findWidget(node, "crop_scale"));
}
function hideCompWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "layers_json"));
}
function hideDrawWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "width"));
  hideWidgetForGood(node, findWidget(node, "height"));
  hideWidgetForGood(node, findWidget(node, "sync_dimensions"));
  hideWidgetForGood(node, findWidget(node, "bg_color"));
  hideWidgetForGood(node, findWidget(node, "tool"));
  hideWidgetForGood(node, findWidget(node, "brush_color"));
  hideWidgetForGood(node, findWidget(node, "brush_opacity"));
  hideWidgetForGood(node, findWidget(node, "brush_size"));
  hideWidgetForGood(node, findWidget(node, "overlay_data"));
}
function setWidgetValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
function setWidgetStringValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
function setWidgetBooleanValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
function ensureCompInputs(node, minLayers = 1) {
  if (!isCompNode(node) || !node.addInput) return;
  const slots = getCompSlots(node);
  const existingNames = new Set((node.inputs ?? []).map((input) => String(input?.name ?? "")));
  for (const slot of slots) {
    if (!existingNames.has(slot.maskSlot)) {
      node.addInput?.(slot.maskSlot, "MASK");
      existingNames.add(slot.maskSlot);
    }
  }
  const currentMax = slots.reduce((max, slot) => Math.max(max, slot.layerNumber), 0);
  const targetLayers = Math.max(minLayers, currentMax || 0);
  for (let layerNumber = currentMax + 1; layerNumber <= targetLayers; layerNumber++) {
    node.addInput?.(`image_${layerNumber}`, "IMAGE,VIDEO", { shape: 7 });
    node.addInput?.(`mask_${layerNumber}`, "MASK");
  }
}
function readCompLayers(node) {
  return syncCompLayers(findWidget(node, "layers_json")?.value ?? "", getCompSlots(node));
}
function writeCompLayers(node, layers) {
  setWidgetStringValue(findWidget(node, "layers_json"), serializeCompLayers(layers));
}
function ensureCompState(node) {
  ensureCompInputs(node, 1);
  const layers = readCompLayers(node);
  writeCompLayers(node, layers);
  const st = ensureState(node);
  if (!st.compSelectedSlot || !layers.some((layer) => layer.slot === st.compSelectedSlot)) {
    st.compSelectedSlot = layers[layers.length - 1]?.slot ?? null;
  }
  return layers;
}
function getCropControlState(node, fallbackWidth = 1, fallbackHeight = 1) {
  return {
    aspectRatio: resolveCropAspectRatioValue(node, fallbackWidth, fallbackHeight),
    centerX: clampCropCenter(widgetNumber(node, "crop_center_x", 0.5)),
    centerY: clampCropCenter(widgetNumber(node, "crop_center_y", 0.5)),
    scale: clampCropScale(widgetNumber(node, "crop_scale", 1))
  };
}
function setCropControlState(node, centerX, centerY, scale) {
  setWidgetValue(findWidget(node, "crop_center_x"), clampCropCenter(centerX));
  setWidgetValue(findWidget(node, "crop_center_y"), clampCropCenter(centerY));
  setWidgetValue(findWidget(node, "crop_scale"), clampCropScale(scale));
}
function resetCropControlState(node) {
  setCropControlState(node, 0.5, 0.5, 1);
}
function updateDrawToolButtons(node) {
  const st = ensureState(node);
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  if (st.drawBrushButton) styleSoftButton(st.drawBrushButton, tool === "brush");
  if (st.drawEraserButton) styleSoftButton(st.drawEraserButton, tool === "eraser");
}
function syncDrawWidgets(node, changedName) {
  if (!isDrawNode(node)) return;
  const st = ensureState(node);
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  const linkWidget = findWidget(node, "sync_dimensions");
  const bgWidget = findWidget(node, "bg_color");
  const colorWidget = findWidget(node, "brush_color");
  const opacityWidget = findWidget(node, "brush_opacity");
  const sizeWidget = findWidget(node, "brush_size");
  if (!widthWidget || !heightWidget) return;
  let width = clampDrawDimension(widgetNumber(node, "width", 1024));
  let height = clampDrawDimension(widgetNumber(node, "height", 1024));
  const linked = widgetBoolean(node, "sync_dimensions", true);
  if (!linked || st.drawAspectRatio == null || changedName === "sync_dimensions") {
    st.drawAspectRatio = Math.max(1, width) / Math.max(1, height);
  }
  if (linked && st.drawAspectRatio) {
    if (changedName === "height") {
      width = clampDrawDimension(Math.round(height * st.drawAspectRatio), width);
    } else if (changedName === "width") {
      height = clampDrawDimension(Math.round(width / st.drawAspectRatio), height);
    }
  }
  widthWidget.value = width;
  heightWidget.value = height;
  const inputConnected = (node.inputs?.[0]?.link ?? null) != null;
  if (st.drawWidthInput) {
    st.drawWidthInput.value = String(width);
    st.drawWidthInput.disabled = inputConnected;
  }
  if (st.drawHeightInput) {
    st.drawHeightInput.value = String(height);
    st.drawHeightInput.disabled = inputConnected;
  }
  if (st.drawLinkButton) {
    st.drawLinkButton.textContent = linked ? "Linked" : "Free";
    styleSoftButton(st.drawLinkButton, linked);
    st.drawLinkButton.disabled = inputConnected;
    st.drawLinkButton.style.opacity = inputConnected ? "0.55" : "1";
  }
  if (st.drawBgColorInput) {
    st.drawBgColorInput.value = normalizeDrawColor(widgetString(node, "bg_color", "#000000"), "#000000");
    st.drawBgColorInput.disabled = inputConnected;
    st.drawBgColorInput.style.opacity = inputConnected ? "0.55" : "1";
  }
  if (st.drawColorInput) {
    st.drawColorInput.value = normalizeDrawColor(widgetString(node, "brush_color", "#FFFFFF"), "#FFFFFF");
  }
  if (st.drawOpacityInput) {
    const opacity = Math.round(clampDrawOpacity(widgetNumber(node, "brush_opacity", 1), 1) * 100);
    st.drawOpacityInput.value = String(opacity);
    st.drawOpacityInput.title = `Brush opacity ${opacity}%`;
    if (st.drawOpacityLabel) st.drawOpacityLabel.textContent = `${opacity}%`;
  }
  if (st.drawSizeInput) {
    const size = clampDrawSize(widgetNumber(node, "brush_size", 10), 10);
    st.drawSizeInput.value = String(size);
    st.drawSizeInput.title = `Brush size ${size}`;
    if (st.drawSizeLabel) st.drawSizeLabel.textContent = String(size);
  }
  if (linkWidget) linkWidget.value = linked;
  if (bgWidget && st.drawBgColorInput && !inputConnected) bgWidget.value = st.drawBgColorInput.value;
  if (colorWidget && st.drawColorInput) colorWidget.value = st.drawColorInput.value;
  if (opacityWidget && st.drawOpacityInput) opacityWidget.value = Number(st.drawOpacityInput.value) / 100;
  if (sizeWidget && st.drawSizeInput) sizeWidget.value = Number(st.drawSizeInput.value);
  updateDrawToolButtons(node);
}
function updateDrawOverlayWidget(node) {
  const st = ensureState(node);
  const value = canvasToOverlayData(st.drawCanvas);
  st.drawOverlayKey = value;
  setWidgetStringValue(findWidget(node, "overlay_data"), value);
}
let _dirtyRaf = null;
function markCanvasDirty() {
  if (_dirtyRaf != null) return;
  _dirtyRaf = requestAnimationFrame(() => {
    _dirtyRaf = null;
    app?.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
  });
}
function syncCropWidgets(node, changedName) {
  if (!isCropNode(node)) return;
  const st = ensureState(node);
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  if (!widthWidget || !heightWidget) return;
  let width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  let height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const preset = widgetString(node, "aspect_ratio", "custom");
  const sync = widgetBoolean(node, "sync_dimensions", true);
  if (preset === "custom") {
    if (!sync || st.cropAspectRatio == null || changedName === "aspect_ratio" || changedName === "sync_dimensions") {
      st.cropAspectRatio = Math.max(1, width) / Math.max(1, height);
    }
    if (sync && st.cropAspectRatio) {
      if (changedName === "height") {
        width = Math.max(1, Math.round(height * st.cropAspectRatio));
      } else if (changedName === "width") {
        height = Math.max(1, Math.round(width / st.cropAspectRatio));
      }
    }
  } else {
    st.cropAspectRatio = resolveCropAspectRatioValue(node, width, height);
    if (sync || changedName === "aspect_ratio" || changedName === "sync_dimensions") {
      if (changedName === "height" && sync) {
        width = Math.max(1, Math.round(height * st.cropAspectRatio));
      } else {
        height = Math.max(1, Math.round(width / st.cropAspectRatio));
      }
    }
  }
  widthWidget.value = width;
  heightWidget.value = height;
  markCanvasDirty();
}
function getFitPlacement(width, height, sourceWidth, sourceHeight) {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(width / safeWidth, height / safeHeight);
  const drawWidth = Math.max(1, Math.floor(safeWidth * scale));
  const drawHeight = Math.max(1, Math.floor(safeHeight * scale));
  const dx = Math.floor((width - drawWidth) / 2);
  const dy = Math.floor((height - drawHeight) / 2);
  return { dx, dy, drawWidth, drawHeight };
}
function drawFitSource(ctx, width, height, source, sourceWidth, sourceHeight) {
  const { dx, dy, drawWidth, drawHeight } = getFitPlacement(width, height, sourceWidth, sourceHeight);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
}
function drawTransformBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (String(node?.comfyClass ?? "") !== "ImageOpsTransform") return;
  const tx = widgetNumber(node, "translate_x", 0);
  const ty = widgetNumber(node, "translate_y", 0);
  const rotDeg = widgetNumber(node, "rotate_deg", 0);
  const scale = Math.max(0.01, widgetNumber(node, "scale", 1));
  const rad = rotDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = sourceWidth / 2;
  const cy = sourceHeight / 2;
  const corners = [
    { x: 0, y: 0 },
    { x: sourceWidth, y: 0 },
    { x: sourceWidth, y: sourceHeight },
    { x: 0, y: sourceHeight }
  ].map((point) => {
    const localX = (point.x - cx) * scale;
    const localY = (point.y - cy) * scale;
    return {
      x: localX * cos - localY * sin + cx + tx,
      y: localX * sin + localY * cos + cy + ty
    };
  });
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  const mapped = corners.map((point) => ({
    x: fit.dx + point.x * scaleX,
    y: fit.dy + point.y * scaleY
  }));
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(fit.dx + 0.5, fit.dy + 0.5, fit.drawWidth, fit.drawHeight);
  ctx.strokeStyle = "rgba(80, 180, 255, 0.95)";
  ctx.fillStyle = "rgba(80, 180, 255, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(mapped[0].x, mapped[0].y);
  for (let i = 1; i < mapped.length; i++) {
    ctx.lineTo(mapped[i].x, mapped[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  for (const point of mapped) {
    ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
  }
  ctx.restore();
}
function drawCropBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (!isCropNode(node)) return null;
  const state = getCropControlState(node, sourceWidth, sourceHeight);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    state.aspectRatio,
    state.centerX,
    state.centerY,
    state.scale
  );
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  const left = fit.dx + crop.x * scaleX;
  const top = fit.dy + crop.y * scaleY;
  const cropWidth = crop.cropWidth * scaleX;
  const cropHeight = crop.cropHeight * scaleY;
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(left, top, cropWidth, cropHeight);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(235, 239, 140, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(left + 0.5, top + 0.5, cropWidth, cropHeight);
  ctx.strokeStyle = "rgba(235, 239, 140, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  const thirdX = cropWidth / 3;
  const thirdY = cropHeight / 3;
  for (let i = 1; i < 3; i++) {
    const x = left + thirdX * i;
    const y = top + thirdY * i;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + cropHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + cropWidth, y);
    ctx.stroke();
  }
  const handleLength = Math.max(10, Math.min(16, Math.floor(Math.min(cropWidth, cropHeight) * 0.12)));
  const drawCorner = (x, y, sx, sy) => {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * handleLength);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * handleLength, y);
    ctx.stroke();
  };
  ctx.strokeStyle = "rgba(235, 239, 140, 1)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  drawCorner(left, top, 1, 1);
  drawCorner(left + cropWidth, top, -1, 1);
  drawCorner(left, top + cropHeight, 1, -1);
  drawCorner(left + cropWidth, top + cropHeight, -1, -1);
  ctx.restore();
  return {
    sourceWidth,
    sourceHeight,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight,
    cropX: crop.x,
    cropY: crop.y,
    cropWidth: crop.cropWidth,
    cropHeight: crop.cropHeight
  };
}
function drawCompBounds(node, ctx, width, height, sourceWidth, sourceHeight, layers) {
  if (!isCompNode(node) || layers.length === 0) return;
  const st = ensureState(node);
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  ctx.save();
  for (const layer of layers) {
    const selected = layer.slot === st.compSelectedSlot;
    const left = fit.dx + layer.left * scaleX;
    const top = fit.dy + layer.top * scaleY;
    const drawWidth = layer.width * scaleX;
    const drawHeight = layer.height * scaleY;
    ctx.strokeStyle = selected ? "rgba(235, 239, 140, 0.98)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = selected ? 1.6 : 1;
    ctx.setLineDash(selected ? [] : [4, 4]);
    ctx.strokeRect(left + 0.5, top + 0.5, drawWidth, drawHeight);
    if (!selected) continue;
    ctx.fillStyle = "rgba(235, 239, 140, 0.95)";
    for (const point of [
      { x: left, y: top },
      { x: left + drawWidth, y: top },
      { x: left, y: top + drawHeight },
      { x: left + drawWidth, y: top + drawHeight }
    ]) {
      ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
    }
  }
  ctx.restore();
}
function tryRenderNativePreview(node, st, canvasSize) {
  if (isCropNode(node) || isCompNode(node) || isDrawNode(node)) return false;
  if (st.nativeDirty) return false;
  if (showNativeMediaPreview(node, st, canvasSize)) {
    st.info.textContent = "Node preview (media)";
    return true;
  }
  const img = getNativePreviewImage(node);
  if (!img) return false;
  if (!img.complete) {
    img.decode?.().catch(() => {
    });
    return false;
  }
  const sourceWidth = img.naturalWidth || img.width || 1;
  const sourceHeight = img.naturalHeight || img.height || 1;
  blit(node, st, img, canvasSize, sourceWidth, sourceHeight);
  st.info.textContent = st.nativeAnimated ? "Node preview (animated)" : "Node preview";
  return true;
}
function blit(node, st, source, canvasSize, sourceWidth, sourceHeight) {
  if (!st.canvas) return;
  hideNativeMediaPreview(st);
  const ctx = st.canvas.getContext("2d");
  if (!ctx) return;
  if (st.canvas.width !== canvasSize) st.canvas.width = canvasSize;
  if (st.canvas.height !== canvasSize) st.canvas.height = canvasSize;
  const resolvedWidth = Math.max(
    1,
    Math.round(
      sourceWidth ?? source.naturalWidth ?? source.videoWidth ?? source.width ?? 1
    )
  );
  const resolvedHeight = Math.max(
    1,
    Math.round(
      sourceHeight ?? source.naturalHeight ?? source.videoHeight ?? source.height ?? 1
    )
  );
  drawFitSource(ctx, canvasSize, canvasSize, source, resolvedWidth, resolvedHeight);
  if (isDrawNode(node)) {
    const fit = getFitPlacement(canvasSize, canvasSize, resolvedWidth, resolvedHeight);
    st.drawGeometry = {
      sourceWidth: resolvedWidth,
      sourceHeight: resolvedHeight,
      fitDx: fit.dx,
      fitDy: fit.dy,
      fitDrawWidth: fit.drawWidth,
      fitDrawHeight: fit.drawHeight
    };
  } else {
    st.drawGeometry = null;
  }
  st.cropGeometry = drawCropBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  drawTransformBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  drawCompBounds(node, ctx, canvasSize, canvasSize, st.compOutputWidth || resolvedWidth, st.compOutputHeight || resolvedHeight, st.compLayers);
}
function getCropInfoText(node) {
  const preset = widgetString(node, "aspect_ratio", "custom");
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const ratioLabel = preset === "custom" ? `${width}:${height}` : preset;
  return `Crop preview (${ratioLabel} -> ${width}x${height})`;
}
function getCompInfoText(node, connectedLayers, totalLayers, width, height) {
  return `Comp preview (${connectedLayers}/${totalLayers} layers, ${width}x${height})`;
}
function getDrawInfoText(node, width, height) {
  const inputConnected = (node.inputs?.[0]?.link ?? null) != null;
  return inputConnected ? `Draw preview (paint over input, ${width}x${height})` : `Draw preview (${width}x${height})`;
}
function getCanvasPointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}
function getCropInteractionMode(geometry, x, y) {
  if (!geometry) return null;
  const left = geometry.fitDx + geometry.cropX * (geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth));
  const top = geometry.fitDy + geometry.cropY * (geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight));
  const width = geometry.cropWidth * (geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth));
  const height = geometry.cropHeight * (geometry.fitDrawHeight / Math.max(1, geometry.sourceHeight));
  const right = left + width;
  const bottom = top + height;
  const threshold = Math.max(10, Math.min(18, Math.floor(Math.min(width, height) * 0.16)));
  const near = (px, py) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
  if (near(left, top)) return "nw";
  if (near(right, top)) return "ne";
  if (near(left, bottom)) return "sw";
  if (near(right, bottom)) return "se";
  if (x >= left && x <= right && y >= top && y <= bottom) return "move";
  return null;
}
function getCropCursor(mode) {
  switch (mode) {
    case "move":
      return "move";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "default";
  }
}
function canvasToSourcePoint(geometry, x, y) {
  const localX = (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth);
  const localY = (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight);
  return {
    x: Math.max(0, Math.min(geometry.sourceWidth, localX * geometry.sourceWidth)),
    y: Math.max(0, Math.min(geometry.sourceHeight, localY * geometry.sourceHeight))
  };
}
function canvasToDrawSourcePoint(geometry, x, y) {
  if (!geometry) return { x: 0, y: 0, inside: false };
  const localX = (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth);
  const localY = (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight);
  const inside = localX >= 0 && localX <= 1 && localY >= 0 && localY <= 1;
  return {
    x: Math.max(0, Math.min(geometry.sourceWidth, localX * geometry.sourceWidth)),
    y: Math.max(0, Math.min(geometry.sourceHeight, localY * geometry.sourceHeight)),
    inside
  };
}
function updateCompControls(node) {
  const st = ensureState(node);
  const layers = ensureCompState(node);
  const selected = layers.find((layer) => layer.slot === st.compSelectedSlot) ?? layers[layers.length - 1] ?? null;
  if (!selected) {
    if (st.compLayerLabel) st.compLayerLabel.textContent = "No layer";
    setControlDisabled(st.compResetButton, true);
    setControlDisabled(st.compModeSelect, true);
    setControlDisabled(st.compOpacityInput, true);
    if (st.compOpacityLabel) st.compOpacityLabel.textContent = "0%";
    return;
  }
  st.compSelectedSlot = selected.slot;
  setControlDisabled(st.compResetButton, false);
  if (st.compLayerLabel) {
    const match = /_(\d+)$/.exec(selected.slot);
    st.compLayerLabel.textContent = `Layer ${match?.[1] ?? "?"}`;
  }
  if (st.compModeSelect) {
    setControlDisabled(st.compModeSelect, false);
    st.compModeSelect.value = selected.mode;
  }
  if (st.compOpacityInput) {
    const opacity = Math.round(selected.opacity * 100);
    setControlDisabled(st.compOpacityInput, false);
    st.compOpacityInput.value = String(opacity);
    st.compOpacityInput.title = `Layer opacity ${opacity}%`;
    if (st.compOpacityLabel) st.compOpacityLabel.textContent = `${opacity}%`;
  }
}
function updateSelectedCompLayer(node, updater) {
  const st = ensureState(node);
  const layers = ensureCompState(node);
  const index = layers.findIndex((layer) => layer.slot === st.compSelectedSlot);
  if (index < 0) return;
  updater(layers[index]);
  writeCompLayers(node, layers);
  updateCompControls(node);
}
function compCanvasToOutputPoint(node, canvasWidth, canvasHeight, x, y) {
  const st = ensureState(node);
  const fit = getFitPlacement(canvasWidth, canvasHeight, st.compOutputWidth || 1, st.compOutputHeight || 1);
  return {
    x: (x - fit.dx) * (st.compOutputWidth || 1) / Math.max(1, fit.drawWidth),
    y: (y - fit.dy) * (st.compOutputHeight || 1) / Math.max(1, fit.drawHeight)
  };
}
function getCompHit(node, canvasWidth, canvasHeight, x, y) {
  const st = ensureState(node);
  const fit = getFitPlacement(canvasWidth, canvasHeight, st.compOutputWidth || 1, st.compOutputHeight || 1);
  const threshold = 10;
  const ordered = [...st.compLayers].reverse();
  for (const layer of ordered) {
    const left = fit.dx + layer.left * fit.drawWidth / Math.max(1, st.compOutputWidth || 1);
    const top = fit.dy + layer.top * fit.drawHeight / Math.max(1, st.compOutputHeight || 1);
    const width = layer.width * fit.drawWidth / Math.max(1, st.compOutputWidth || 1);
    const height = layer.height * fit.drawHeight / Math.max(1, st.compOutputHeight || 1);
    const right = left + width;
    const bottom = top + height;
    const near = (px, py) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
    if (near(left, top)) return { layer, mode: "nw" };
    if (near(right, top)) return { layer, mode: "ne" };
    if (near(left, bottom)) return { layer, mode: "sw" };
    if (near(right, bottom)) return { layer, mode: "se" };
    if (x >= left && x <= right && y >= top && y <= bottom) return { layer, mode: "move" };
  }
  return null;
}
function getCompCursor(mode) {
  switch (mode) {
    case "move":
      return "move";
    case "nw":
    case "se":
      return "nwse-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    default:
      return "default";
  }
}
function registerImageOpsLivePreview() {
  initOpsConstants();
  const cfg = getPreviewConfig();
  const canvasSize = cfg.canvasSize;
  const registry = buildAdapterRegistry();
  const renderer = buildRenderer({ api, registry, canvasSize });
  const progress = attachProgressBus(api);
  function refreshDrawInteraction(node) {
    const st = ensureState(node);
    st.nativeDirty = true;
    markCanvasDirty();
    schedule(node, () => {
      startLoopIfVideo(node);
      refreshDependents(node);
    }, 0);
  }
  function ensureDrawCanvasSize(node, width, height, persist = false) {
    const st = ensureState(node);
    st.drawCanvas = resizeCanvasPreserve(st.drawCanvas, width, height);
    if (persist) {
      updateDrawOverlayWidget(node);
    }
  }
  function setDrawTool(node, tool) {
    setWidgetStringValue(findWidget(node, "tool"), tool);
    updateDrawToolButtons(node);
  }
  function strokeStyle(color, opacity) {
    const normalized = normalizeDrawColor(color, "#FFFFFF");
    const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampDrawOpacity(opacity)})`;
  }
  function paintDrawSegment(node, fromX, fromY, toX, toY) {
    const st = ensureState(node);
    const canvas = st.drawCanvas;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = clampDrawSize(widgetNumber(node, "brush_size", 10));
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = strokeStyle(
        widgetString(node, "brush_color", "#FFFFFF"),
        widgetNumber(node, "brush_opacity", 1)
      );
    }
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
    ctx.restore();
  }
  async function renderDrawNode(node, tick) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const upstream = getUpstreamNode(node, 0);
    let baseCanvas = null;
    if (upstream) {
      const rendered = await renderer.render(upstream, tick);
      baseCanvas = rendered.canvas;
    }
    const previewCanvas = await renderDrawPreview(node, baseCanvas);
    st.drawBaseCanvas = baseCanvas;
    blit(node, st, previewCanvas, canvasSize);
    syncDrawWidgets(node);
    st.info.textContent = getDrawInfoText(node, previewCanvas.width || 1, previewCanvas.height || 1);
  }
  function deriveMaskCanvasFromCanvas(source) {
    const output = document.createElement("canvas");
    output.width = Math.max(1, source.width || 1);
    output.height = Math.max(1, source.height || 1);
    const octx = output.getContext("2d");
    octx.clearRect(0, 0, output.width, output.height);
    octx.drawImage(source, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3] / 255;
      const luma = Math.max(0, Math.min(1, 0.2126 * (data[index] / 255) + 0.7152 * (data[index + 1] / 255) + 0.0722 * (data[index + 2] / 255)));
      const matte = Math.round(Math.max(0, Math.min(1, luma * alpha)) * 255);
      data[index] = matte;
      data[index + 1] = matte;
      data[index + 2] = matte;
      data[index + 3] = 255;
    }
    octx.putImageData(image, 0, 0);
    return output;
  }
  async function renderDrawMaskCanvas(node, tick) {
    const upstream = getUpstreamNode(node, 0);
    let width = clampDrawDimension(widgetNumber(node, "width", 1024));
    let height = clampDrawDimension(widgetNumber(node, "height", 1024));
    if (upstream) {
      const rendered = await renderer.render(upstream, tick);
      if (rendered.canvas) {
        width = Math.max(1, rendered.canvas.width || width);
        height = Math.max(1, rendered.canvas.height || height);
      }
    }
    const overlay = await resolveDrawOverlayCanvas(node, width, height);
    const output = document.createElement("canvas");
    output.width = overlay.width || 1;
    output.height = overlay.height || 1;
    const octx = output.getContext("2d");
    const overlayCtx = overlay.getContext("2d");
    if (!overlayCtx) return output;
    const image = overlayCtx.getImageData(0, 0, overlay.width || 1, overlay.height || 1);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const matte = data[index + 3];
      data[index] = matte;
      data[index + 1] = matte;
      data[index + 2] = matte;
      data[index + 3] = 255;
    }
    octx.putImageData(image, 0, 0);
    return output;
  }
  async function renderMaskCanvasFromNode(upstream, tick, outputSlot = 1) {
    if (isDrawNode(upstream) && outputSlot === 1) {
      return await renderDrawMaskCanvas(upstream, tick);
    }
    const rendered = await renderer.render(upstream, tick, outputSlot);
    if (rendered.canvas) {
      return rendered.canvas;
    }
    const nodeStream = await resolveNodeStreamPreview(upstream, canvasSize);
    if (!nodeStream?.canvas) return null;
    return deriveMaskCanvasFromCanvas(nodeStream.canvas);
  }
  async function renderMaskInputForComp(node, inputIndex, tick) {
    const upstream = getUpstreamNode(node, inputIndex);
    if (!upstream) return null;
    const link = getInputLink(node, inputIndex);
    const outputSlot = link?.origin_slot ?? link?.originSlot ?? 1;
    return await renderMaskCanvasFromNode(upstream, tick, outputSlot);
  }
  async function renderPreviewBridgeNode(node, tick) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const imageIndex = getInputIndexByName(node, "image");
    const maskIndex = getInputIndexByName(node, "mask");
    const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();
    let imageCanvas = null;
    let maskCanvas = null;
    let imageFromNodeStream = false;
    let maskFromNodeStream = false;
    if (imageIndex >= 0) {
      const imageUpstream = getUpstreamNode(node, imageIndex);
      if (imageUpstream) {
        const rendered = await renderer.render(imageUpstream, tick);
        imageCanvas = rendered.canvas;
        if (!imageCanvas) {
          const nodeStream = await resolveNodeStreamPreview(imageUpstream, canvasSize);
          imageCanvas = nodeStream?.canvas ?? null;
          imageFromNodeStream = !!imageCanvas;
        }
      }
    }
    if (maskIndex >= 0) {
      const maskUpstream = getUpstreamNode(node, maskIndex);
      if (maskUpstream) {
        const maskLink = getInputLink(node, maskIndex);
        const maskOutputSlot = maskLink?.origin_slot ?? maskLink?.originSlot ?? 1;
        const directMask = await renderMaskCanvasFromNode(maskUpstream, tick, maskOutputSlot);
        maskCanvas = directMask;
        if (!maskCanvas) {
          const nodeStream = await resolveNodeStreamPreview(maskUpstream, canvasSize);
          if (nodeStream?.canvas) {
            maskCanvas = deriveMaskCanvasFromCanvas(nodeStream.canvas);
            maskFromNodeStream = true;
          }
        }
      }
    }
    const chosen = previewTarget === "mask" ? maskCanvas ?? imageCanvas : previewTarget === "image" ? imageCanvas ?? maskCanvas : imageCanvas ?? maskCanvas;
    if (!chosen) {
      st.info.textContent = "Preview bridge: connect image or mask";
      return;
    }
    blit(node, st, chosen, canvasSize);
    if (previewTarget === "mask" || !imageCanvas && maskCanvas) {
      st.info.textContent = maskFromNodeStream ? "Preview bridge (mask, nodestream)" : "Preview bridge (mask)";
    } else if (imageCanvas) {
      st.info.textContent = imageFromNodeStream ? "Preview bridge (image, nodestream)" : "Preview bridge (image)";
    } else {
      st.info.textContent = "Preview bridge";
    }
  }
  function refreshCropInteraction(node) {
    const st = ensureState(node);
    st.nativeDirty = true;
    markCanvasDirty();
    schedule(node, () => {
      startLoopIfVideo(node);
      refreshDependents(node);
    }, 0);
  }
  function attachDrawInteractions(node) {
    if (!isDrawNode(node)) return;
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st?.canvas || st.drawInteractiveHooked) return;
    st.drawInteractiveHooked = true;
    const canvas = st.canvas;
    st.drawBrushButton?.addEventListener("click", (event) => {
      event.preventDefault();
      setDrawTool(node, "brush");
    });
    st.drawEraserButton?.addEventListener("click", (event) => {
      event.preventDefault();
      setDrawTool(node, "eraser");
    });
    st.drawClearButton?.addEventListener("click", (event) => {
      event.preventDefault();
      ensureDrawCanvasSize(node, st.drawCanvas?.width ?? widgetNumber(node, "width", 1024), st.drawCanvas?.height ?? widgetNumber(node, "height", 1024), false);
      const ctx = st.drawCanvas?.getContext("2d");
      ctx?.clearRect(0, 0, st.drawCanvas?.width ?? 0, st.drawCanvas?.height ?? 0);
      updateDrawOverlayWidget(node);
      refreshDrawInteraction(node);
    });
    st.drawColorInput?.addEventListener("input", () => {
      const color = normalizeDrawColor(st.drawColorInput?.value ?? "#FFFFFF", "#FFFFFF");
      setWidgetStringValue(findWidget(node, "brush_color"), color);
      if (st.drawColorInput) st.drawColorInput.value = color;
    });
    st.drawOpacityInput?.addEventListener("input", () => {
      const opacity = clampDrawOpacity(Number(st.drawOpacityInput?.value ?? 100) / 100, 1);
      setWidgetValue(findWidget(node, "brush_opacity"), opacity);
      if (st.drawOpacityLabel) st.drawOpacityLabel.textContent = `${Math.round(opacity * 100)}%`;
    });
    st.drawSizeInput?.addEventListener("input", () => {
      const size = clampDrawSize(Number(st.drawSizeInput?.value ?? 10), 10);
      setWidgetValue(findWidget(node, "brush_size"), size);
      if (st.drawSizeLabel) st.drawSizeLabel.textContent = String(size);
    });
    st.drawWidthInput?.addEventListener("change", () => {
      if ((node.inputs?.[0]?.link ?? null) != null) return;
      const width = clampDrawDimension(Number(st.drawWidthInput?.value ?? widgetNumber(node, "width", 1024)), widgetNumber(node, "width", 1024));
      setWidgetValue(findWidget(node, "width"), width);
      syncDrawWidgets(node, "width");
      ensureDrawCanvasSize(node, widgetNumber(node, "width", width), widgetNumber(node, "height", 1024), true);
      refreshDrawInteraction(node);
    });
    st.drawHeightInput?.addEventListener("change", () => {
      if ((node.inputs?.[0]?.link ?? null) != null) return;
      const height = clampDrawDimension(Number(st.drawHeightInput?.value ?? widgetNumber(node, "height", 1024)), widgetNumber(node, "height", 1024));
      setWidgetValue(findWidget(node, "height"), height);
      syncDrawWidgets(node, "height");
      ensureDrawCanvasSize(node, widgetNumber(node, "width", 1024), widgetNumber(node, "height", height), true);
      refreshDrawInteraction(node);
    });
    st.drawLinkButton?.addEventListener("click", (event) => {
      event.preventDefault();
      if ((node.inputs?.[0]?.link ?? null) != null) return;
      const linked = !widgetBoolean(node, "sync_dimensions", true);
      setWidgetBooleanValue(findWidget(node, "sync_dimensions"), linked);
      syncDrawWidgets(node, "sync_dimensions");
      refreshDrawInteraction(node);
    });
    st.drawBgColorInput?.addEventListener("input", () => {
      if ((node.inputs?.[0]?.link ?? null) != null) return;
      const color = normalizeDrawColor(st.drawBgColorInput?.value ?? "#000000", "#000000");
      setWidgetStringValue(findWidget(node, "bg_color"), color);
      if (st.drawBgColorInput) st.drawBgColorInput.value = color;
      refreshDrawInteraction(node);
    });
    canvas.addEventListener("pointerdown", async (event) => {
      if (!st.drawGeometry) return;
      const point = getCanvasPointer(canvas, event);
      const mapped = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
      if (!mapped.inside) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      if (!st.drawCanvas) {
        await renderDrawNode(node, 0);
      }
      st.drawStroke = {
        pointerId: event.pointerId,
        lastX: mapped.x,
        lastY: mapped.y
      };
      paintDrawSegment(node, mapped.x, mapped.y, mapped.x, mapped.y);
      markCanvasDirty();
      void renderDrawNode(node, 0);
    });
    canvas.addEventListener("pointermove", (event) => {
      const drag = st.drawStroke;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!st.drawGeometry) return;
      const point = getCanvasPointer(canvas, event);
      const mapped = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
      if (!mapped.inside) return;
      event.preventDefault();
      paintDrawSegment(node, drag.lastX, drag.lastY, mapped.x, mapped.y);
      drag.lastX = mapped.x;
      drag.lastY = mapped.y;
      markCanvasDirty();
      void renderDrawNode(node, 0);
    });
    const releaseStroke = (event) => {
      if (!st.drawStroke || st.drawStroke.pointerId !== event.pointerId) return;
      st.drawStroke = null;
      canvas.releasePointerCapture?.(event.pointerId);
      updateDrawOverlayWidget(node);
      refreshDrawInteraction(node);
    };
    canvas.addEventListener("pointerup", releaseStroke);
    canvas.addEventListener("pointercancel", releaseStroke);
  }
  function attachCropInteractions(node) {
    if (!isCropNode(node)) return;
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st?.canvas || st.cropInteractiveHooked) return;
    st.cropInteractiveHooked = true;
    const canvas = st.canvas;
    st.cropResetButton?.addEventListener("click", (event) => {
      event.preventDefault();
      resetCropControlState(node);
      st.cropDrag = null;
      canvas.style.cursor = "default";
      refreshCropInteraction(node);
    });
    canvas.addEventListener("pointerdown", (event) => {
      const geometry = st.cropGeometry;
      if (!geometry) return;
      const point = getCanvasPointer(canvas, event);
      const mode = getCropInteractionMode(geometry, point.x, point.y);
      if (!mode) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      const controls = getCropControlState(node, geometry.sourceWidth, geometry.sourceHeight);
      st.cropDrag = {
        pointerId: event.pointerId,
        mode,
        startCanvasX: point.x,
        startCanvasY: point.y,
        startCenterX: controls.centerX,
        startCenterY: controls.centerY,
        startScale: controls.scale,
        startCropX: geometry.cropX,
        startCropY: geometry.cropY,
        startCropWidth: geometry.cropWidth,
        startCropHeight: geometry.cropHeight
      };
      canvas.style.cursor = getCropCursor(mode);
    });
    canvas.addEventListener("pointermove", (event) => {
      const point = getCanvasPointer(canvas, event);
      const drag = st.cropDrag;
      const geometry = st.cropGeometry;
      if (!drag || drag.pointerId !== event.pointerId || !geometry) {
        canvas.style.cursor = getCropCursor(getCropInteractionMode(geometry, point.x, point.y));
        return;
      }
      event.preventDefault();
      const targetRatio = resolveCropAspectRatioValue(node, geometry.sourceWidth, geometry.sourceHeight);
      const maxRect = computeCropRect(geometry.sourceWidth, geometry.sourceHeight, targetRatio, 0.5, 0.5, 1);
      let nextCenterX = drag.startCenterX;
      let nextCenterY = drag.startCenterY;
      let nextScale = drag.startScale;
      if (drag.mode === "move") {
        const deltaX = (point.x - drag.startCanvasX) * geometry.sourceWidth / Math.max(1, geometry.fitDrawWidth);
        const deltaY = (point.y - drag.startCanvasY) * geometry.sourceHeight / Math.max(1, geometry.fitDrawHeight);
        let centerPx = drag.startCenterX * geometry.sourceWidth + deltaX;
        let centerPy = drag.startCenterY * geometry.sourceHeight + deltaY;
        centerPx = Math.max(drag.startCropWidth / 2, Math.min(geometry.sourceWidth - drag.startCropWidth / 2, centerPx));
        centerPy = Math.max(drag.startCropHeight / 2, Math.min(geometry.sourceHeight - drag.startCropHeight / 2, centerPy));
        nextCenterX = clampCropCenter(centerPx / Math.max(1, geometry.sourceWidth));
        nextCenterY = clampCropCenter(centerPy / Math.max(1, geometry.sourceHeight));
      } else {
        const pointerSource = canvasToSourcePoint(geometry, point.x, point.y);
        const anchor = (() => {
          if (drag.mode === "nw") return { x: drag.startCropX + drag.startCropWidth, y: drag.startCropY + drag.startCropHeight };
          if (drag.mode === "ne") return { x: drag.startCropX, y: drag.startCropY + drag.startCropHeight };
          if (drag.mode === "sw") return { x: drag.startCropX + drag.startCropWidth, y: drag.startCropY };
          return { x: drag.startCropX, y: drag.startCropY };
        })();
        const deltaX = Math.abs(anchor.x - pointerSource.x);
        const deltaY = Math.abs(anchor.y - pointerSource.y);
        const fittedWidth = Math.min(deltaX, deltaY * targetRatio);
        const minWidth = Math.max(1, maxRect.cropWidth * 0.05);
        let cropWidth = Math.max(minWidth, Math.min(maxRect.cropWidth, fittedWidth));
        let cropHeight = cropWidth / Math.max(1e-4, targetRatio);
        if (cropHeight > maxRect.cropHeight) {
          cropHeight = maxRect.cropHeight;
          cropWidth = cropHeight * targetRatio;
        }
        const rect = (() => {
          if (drag.mode === "nw") return { x: anchor.x - cropWidth, y: anchor.y - cropHeight };
          if (drag.mode === "ne") return { x: anchor.x, y: anchor.y - cropHeight };
          if (drag.mode === "sw") return { x: anchor.x - cropWidth, y: anchor.y };
          return { x: anchor.x, y: anchor.y };
        })();
        const centerPx = rect.x + cropWidth / 2;
        const centerPy = rect.y + cropHeight / 2;
        nextCenterX = clampCropCenter(centerPx / Math.max(1, geometry.sourceWidth));
        nextCenterY = clampCropCenter(centerPy / Math.max(1, geometry.sourceHeight));
        nextScale = clampCropScale(cropWidth / Math.max(1, maxRect.cropWidth));
      }
      setCropControlState(node, nextCenterX, nextCenterY, nextScale);
      refreshCropInteraction(node);
    });
    const releaseDrag = (event) => {
      if (!st.cropDrag || st.cropDrag.pointerId !== event.pointerId) return;
      st.cropDrag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      const point = getCanvasPointer(canvas, event);
      canvas.style.cursor = getCropCursor(getCropInteractionMode(st.cropGeometry, point.x, point.y));
      refreshCropInteraction(node);
    };
    canvas.addEventListener("pointerup", releaseDrag);
    canvas.addEventListener("pointercancel", releaseDrag);
    canvas.addEventListener("pointerleave", () => {
      if (!st.cropDrag) {
        canvas.style.cursor = "default";
      }
    });
  }
  function attachCompInteractions(node) {
    if (!isCompNode(node)) return;
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st?.canvas || st.compInteractiveHooked) return;
    st.compInteractiveHooked = true;
    const canvas = st.canvas;
    st.compAddButton?.addEventListener("click", (event) => {
      event.preventDefault();
      ensureCompInputs(node, Math.max(1, getCompSlots(node).length + 1));
      const layers = ensureCompState(node);
      st.compSelectedSlot = layers[layers.length - 1]?.slot ?? st.compSelectedSlot;
      updateCompControls(node);
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    });
    st.compResetButton?.addEventListener("click", (event) => {
      event.preventDefault();
      updateSelectedCompLayer(node, (layer) => {
        layer.centerX = 0.5;
        layer.centerY = 0.5;
        layer.scale = 1;
        layer.opacity = 1;
        layer.mode = "over";
      });
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    });
    st.compModeSelect?.addEventListener("change", () => {
      updateSelectedCompLayer(node, (layer) => {
        layer.mode = st.compModeSelect?.value ?? "over";
      });
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    });
    st.compOpacityInput?.addEventListener("input", () => {
      updateSelectedCompLayer(node, (layer) => {
        layer.opacity = Math.max(0, Math.min(1, Number(st.compOpacityInput?.value ?? 100) / 100));
      });
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    });
    canvas.addEventListener("pointerdown", (event) => {
      const point = getCanvasPointer(canvas, event);
      const hit = getCompHit(node, canvas.width, canvas.height, point.x, point.y);
      if (!hit) return;
      event.preventDefault();
      canvas.setPointerCapture?.(event.pointerId);
      st.compSelectedSlot = hit.layer.slot;
      updateCompControls(node);
      const layers = ensureCompState(node);
      const layer = layers.find((entry) => entry.slot === hit.layer.slot);
      if (!layer) return;
      st.compDrag = {
        pointerId: event.pointerId,
        slot: hit.layer.slot,
        mode: hit.mode,
        startCanvasX: point.x,
        startCanvasY: point.y,
        startCenterX: layer.centerX,
        startCenterY: layer.centerY,
        startScale: layer.scale,
        startLeft: hit.layer.left,
        startTop: hit.layer.top,
        startWidth: hit.layer.width,
        startHeight: hit.layer.height,
        sourceWidth: hit.layer.sourceWidth,
        sourceHeight: hit.layer.sourceHeight
      };
      canvas.style.cursor = getCompCursor(hit.mode);
      markCanvasDirty();
    });
    canvas.addEventListener("pointermove", (event) => {
      const point = getCanvasPointer(canvas, event);
      const drag = st.compDrag;
      if (!drag || drag.pointerId !== event.pointerId) {
        canvas.style.cursor = getCompCursor(getCompHit(node, canvas.width, canvas.height, point.x, point.y)?.mode ?? null);
        return;
      }
      event.preventDefault();
      const outputPoint = compCanvasToOutputPoint(node, canvas.width, canvas.height, point.x, point.y);
      const startOutputPoint = compCanvasToOutputPoint(node, canvas.width, canvas.height, drag.startCanvasX, drag.startCanvasY);
      updateSelectedCompLayer(node, (layer) => {
        if (drag.mode === "move") {
          const deltaX2 = outputPoint.x - startOutputPoint.x;
          const deltaY2 = outputPoint.y - startOutputPoint.y;
          layer.centerX = clampCompCenter(drag.startCenterX + deltaX2 / Math.max(1, st.compOutputWidth));
          layer.centerY = clampCompCenter(drag.startCenterY + deltaY2 / Math.max(1, st.compOutputHeight));
          return;
        }
        const startRight = drag.startLeft + drag.startWidth;
        const startBottom = drag.startTop + drag.startHeight;
        const anchor = drag.mode === "nw" ? { x: startRight, y: startBottom } : drag.mode === "ne" ? { x: drag.startLeft, y: startBottom } : drag.mode === "sw" ? { x: startRight, y: drag.startTop } : { x: drag.startLeft, y: drag.startTop };
        const deltaX = Math.abs(anchor.x - outputPoint.x);
        const deltaY = Math.abs(anchor.y - outputPoint.y);
        const aspect = Math.max(1e-4, drag.sourceWidth / Math.max(1, drag.sourceHeight));
        let width = Math.max(1, Math.min(deltaX, deltaY * aspect));
        let height = width / aspect;
        if (height < 1) {
          height = 1;
          width = aspect;
        }
        const rect = drag.mode === "nw" ? { left: anchor.x - width, top: anchor.y - height } : drag.mode === "ne" ? { left: anchor.x, top: anchor.y - height } : drag.mode === "sw" ? { left: anchor.x - width, top: anchor.y } : { left: anchor.x, top: anchor.y };
        layer.scale = clampCompScale(width / Math.max(1, drag.sourceWidth));
        layer.centerX = clampCompCenter((rect.left + width / 2) / Math.max(1, st.compOutputWidth));
        layer.centerY = clampCompCenter((rect.top + height / 2) / Math.max(1, st.compOutputHeight));
      });
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    });
    const releaseDrag = (event) => {
      if (!st.compDrag || st.compDrag.pointerId !== event.pointerId) return;
      st.compDrag = null;
      canvas.releasePointerCapture?.(event.pointerId);
      const point = getCanvasPointer(canvas, event);
      canvas.style.cursor = getCompCursor(getCompHit(node, canvas.width, canvas.height, point.x, point.y)?.mode ?? null);
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    };
    canvas.addEventListener("pointerup", releaseDrag);
    canvas.addEventListener("pointercancel", releaseDrag);
    canvas.addEventListener("pointerleave", () => {
      if (!st.compDrag) {
        canvas.style.cursor = "default";
      }
    });
  }
  function renderNode(node, tick = 0) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const renderKey = buildPreviewRenderKey(node, tick, st);
    if (!st.nativeDirty && st.lastKey === renderKey && st.lastRenderTick === tick) {
      return;
    }
    if (st.renderInFlight) {
      st.queuedRenderTick = tick;
      return;
    }
    const finishRender = () => {
      st.renderInFlight = false;
      const queuedTick = st.queuedRenderTick;
      st.queuedRenderTick = null;
      if (queuedTick != null) {
        renderNode(node, queuedTick);
      }
    };
    const commitRender = () => {
      st.lastKey = renderKey;
      st.lastRenderTick = tick;
      st.nativeDirty = false;
    };
    const failRender = (message, error) => {
      st.info.textContent = message;
      console.warn("[ImageOps] render error", error);
      finishRender();
    };
    st.renderInFlight = true;
    st.renderNonce += 1;
    if (isPreviewNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        st.info.textContent = "Live preview disabled: graph too large";
        stopRAF(st);
        finishRender();
        return;
      }
      renderPreviewBridgeNode(node, tick).then(() => {
        commitRender();
        finishRender();
      }).catch((err) => {
        failRender("Preview bridge error (check console)", err);
      });
      return;
    }
    if (isDrawNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        st.info.textContent = "Live preview disabled: graph too large";
        stopRAF(st);
        finishRender();
        return;
      }
      renderDrawNode(node, tick).then(() => {
        commitRender();
        finishRender();
      }).catch((err) => {
        failRender("Draw preview error (check console)", err);
      });
      return;
    }
    if (isCropNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        st.info.textContent = "Live preview disabled: graph too large";
        st.cropGeometry = null;
        stopRAF(st);
        finishRender();
        return;
      }
      const upstream = getUpstreamNode(node, 0);
      if (!upstream) {
        st.info.textContent = "Live preview: connect a supported loader/chain";
        st.cropGeometry = null;
        finishRender();
        return;
      }
      renderer.render(upstream, tick).then((result) => {
        if (!result?.canvas) {
          st.info.textContent = "Live preview: connect a supported loader/chain";
          st.cropGeometry = null;
          finishRender();
          return;
        }
        blit(node, st, result.canvas, canvasSize);
        st.info.textContent = getCropInfoText(node);
        commitRender();
        finishRender();
      }).catch((err) => {
        st.cropGeometry = null;
        failRender("Live preview error (check console)", err);
      });
      return;
    }
    if (isCompNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        st.info.textContent = "Live preview disabled: graph too large";
        st.compLayers = [];
        stopRAF(st);
        finishRender();
        return;
      }
      const slots = getCompSlots(node);
      const connected = [];
      Promise.all(slots.map(async (slot) => {
        const upstream = getUpstreamNode(node, slot.inputIndex);
        if (!upstream) return null;
        const result = await renderer.render(upstream, tick);
        if (!result?.canvas) return null;
        let mask = null;
        if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
          mask = await renderMaskInputForComp(node, slot.maskInputIndex, tick);
        }
        return { slot: slot.slot, layerNumber: slot.layerNumber, inputIndex: slot.inputIndex, image: result.canvas, mask };
      })).then((resolved) => {
        const ordered = resolved.filter((entry) => !!entry);
        if (ordered.length === 0) {
          st.info.textContent = "Comp preview: connect at least one layer";
          st.compLayers = [];
          st.compOutputWidth = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
          st.compOutputHeight = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
          updateCompControls(node);
          finishRender();
          return;
        }
        const rendered = renderCompPreview(node, ordered);
        st.compLayers = rendered.layers;
        st.compOutputWidth = rendered.canvas.width || 1;
        st.compOutputHeight = rendered.canvas.height || 1;
        blit(node, st, rendered.canvas, canvasSize);
        st.info.textContent = getCompInfoText(node, ordered.length, slots.length, st.compOutputWidth, st.compOutputHeight);
        updateCompControls(node);
        commitRender();
        finishRender();
      }).catch((err) => {
        st.info.textContent = "Comp preview error (check console)";
        st.compLayers = [];
        console.warn("[ImageOps] comp render error", err);
        finishRender();
      });
      return;
    }
    if (tryRenderNativePreview(node, st, canvasSize)) {
      commitRender();
      finishRender();
      return;
    }
    if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
      st.info.textContent = "Live preview disabled: graph too large";
      stopRAF(st);
      finishRender();
      return;
    }
    renderer.render(node, tick).then((result) => {
      if (!result?.canvas) {
        st.info.textContent = "Live preview: connect a supported loader/chain";
        finishRender();
        return;
      }
      blit(node, st, result.canvas, canvasSize);
      const src = detectSourceUpstream(node);
      if (src?.kind === "video") {
        st.info.textContent = "Live preview (video)";
      } else if (src?.animated) {
        st.info.textContent = "Live preview (animated image)";
      } else if (src?.kind) {
        st.info.textContent = `Live preview (${src.kind})`;
      } else {
        st.info.textContent = "Live preview (no queue)";
      }
      commitRender();
      finishRender();
    }).catch((err) => {
      failRender("Live preview error (check console)", err);
    });
  }
  function startLoopIfVideo(node) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const nativeImg = getNativePreviewImage(node);
    if (nativeImg && !st.nativeAnimated && !isCropNode(node)) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }
    const src = detectSourceUpstream(node);
    if ((!src || src.kind !== "video" && !src.animated) && !st.nativeAnimated && !hasProceduralAnimation(node)) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }
    let tick = 0;
    let lastLoopTick = null;
    const proceduralFrameCount = getProceduralFrameCount(node);
    const proceduralFps = proceduralFrameCount != null ? getProceduralPlaybackFps(node) ?? 12 : null;
    const startedAt = performance.now();
    const loop = () => {
      if (proceduralFps != null) {
        const rawTick = Math.floor((performance.now() - startedAt) * proceduralFps / 1e3);
        tick = proceduralFrameCount != null && proceduralFrameCount > 0 ? rawTick % proceduralFrameCount : rawTick;
      } else {
        tick++;
      }
      if (tick !== lastLoopTick) {
        lastLoopTick = tick;
        renderNode(node, tick);
      }
      st.rafId = requestAnimationFrame(loop);
    };
    stopRAF(st);
    st.rafId = requestAnimationFrame(loop);
  }
  function refreshDependents(changedNode) {
    const deps = findDependents(changedNode, (n) => IMAGEOPS_CLASSES.has(n.comfyClass));
    for (const n of deps) {
      ensureState(n).nativeDirty = true;
      startLoopIfVideo(n);
    }
  }
  function hookNode(node) {
    const st = ensureState(node);
    if (st.hooked) return;
    st.hooked = true;
    if (isCropNode(node)) {
      hideCropGeometryWidgets(node);
      syncCropWidgets(node);
    }
    if (isDrawNode(node)) {
      hideDrawWidgets(node);
      syncDrawWidgets(node);
    }
    if (isCompNode(node)) {
      hideCompWidgets(node);
      ensureCompState(node);
      updateCompControls(node);
    }
    if (IMAGEOPS_CLASSES.has(node.comfyClass)) {
      node.previewMediaType = "image";
      ensurePreviewWidget(node, progress, canvasSize);
      if (isDrawNode(node)) {
        attachDrawInteractions(node);
      }
      if (isCropNode(node)) {
        attachCropInteractions(node);
      }
      if (isCompNode(node)) {
        attachCompInteractions(node);
      }
      startLoopIfVideo(node);
    }
    for (const w of node.widgets ?? []) {
      const orig = w.callback;
      w.callback = function() {
        const r = orig?.apply(this, arguments);
        if (isCropNode(node)) {
          syncCropWidgets(node, w.name);
        }
        if (isDrawNode(node)) {
          syncDrawWidgets(node, w.name);
        }
        if (isCompNode(node)) {
          ensureCompState(node);
          updateCompControls(node);
        }
        st.nativeDirty = true;
        schedule(node, () => {
          if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
          refreshDependents(node);
        }, cfg.debounceMs);
        return r;
      };
    }
    const chainCb = (prop) => {
      const orig = node[prop];
      node[prop] = function() {
        const r = orig?.apply(this, arguments);
        if (isCropNode(node) && prop === "onConfigure") {
          hideCropGeometryWidgets(node);
          syncCropWidgets(node);
          attachCropInteractions(node);
        }
        if (isDrawNode(node) && prop === "onConfigure") {
          hideDrawWidgets(node);
          attachDrawInteractions(node);
        }
        if (isDrawNode(node)) {
          syncDrawWidgets(node);
        }
        if (isCompNode(node) && prop === "onConfigure") {
          hideCompWidgets(node);
          ensureCompState(node);
          attachCompInteractions(node);
          updateCompControls(node);
        }
        st.nativeDirty = true;
        if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
        return r;
      };
    };
    chainCb("onConnectionsChange");
    chainCb("onConfigure");
    const origExecuted = node.onExecuted;
    node.onExecuted = function(message) {
      const r = origExecuted?.apply(this, arguments);
      st.nativeAnimated = !!message?.animated?.[0];
      st.nativeDirty = false;
      st.lastKey = null;
      st.lastRenderTick = null;
      schedule(node, () => {
        if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
      return r;
    };
  }
  app.registerExtension({
    name: EXT_NAME,
    async beforeRegisterNodeDef(nodeType, _nodeData) {
      nodeType.prototype.onNodeCreated = /* @__PURE__ */ (function(orig) {
        return function() {
          orig?.apply(this, arguments);
          hookNode(this);
        };
      })(nodeType.prototype.onNodeCreated);
    }
  });
}
export {
  registerImageOpsLivePreview
};
