import type { ComfyNode, ComfyWidget, NodeState, ProgressBus } from "../../types.js";
import { ensureState } from "./state.js";
import { isImageOpsClass, isImageOpsNativeUiClass } from "./classes.js";
import { createPreviewControlsUi, isNode as isPreviewNode } from "../nodes/preview.js";
import { createConstantControlsUi, isNode as isConstantNode } from "../nodes/constant.js";
import { createGrainControlsUi, isNode as isGrainNode } from "../nodes/grain.js";
import { createRampControlsUi, isNode as isRampNode } from "../nodes/ramp.js";
import { createTextControlsUi, isNode as isTextNode } from "../nodes/text.js";
import { createColorCorrectControlsUi, isNode as isColorCorrectNode } from "../nodes/color-correct.js";
import { createCropResetButton, isNode as isCropNode } from "../nodes/crop.js";
import { createDrawControlsUi, isNode as isDrawNode } from "../nodes/draw.js";
import { createCompControlsUi, isNode as isCompNode } from "../nodes/comp.js";
import { createJoinControlsUi, isNode as isAppendNode } from "../nodes/append.js";
import { createFrameSelectorControlsUi, isNode as isFrameRangeNode } from "../nodes/frame-range.js";
import { createKeyerControlsUi, isNode as isKeyerNode } from "../nodes/keyer.js";
import { createPadOutControlsUi, isNode as isPadOutNode } from "../nodes/pad-out.js";
import { styleSoftButton, styleSoftField, styleSoftRange, styleInlineAction, createColorSwatch, createContextMenuSelect, syncDarkColorInputUI } from "./dom-styles.js";
import { getWidgetInputSpec, listCompactUiWidgets, setWidgetMixedValue } from "./widgets.js";
import { bindCollapsibleToUiState } from "./ui-persist.js";
import { attachDblClickReset } from "./dbl-click-reset.js";
import {
  IMAGEOPS_DEFAULT_PREVIEW_MIN_HEIGHT,
  IMAGEOPS_NODE_METADATA,
} from "./imageops-metadata.js";

type CompactWidgetBinding = {
  widget: ComfyWidget;
  kind: "boolean" | "select" | "number" | "text" | "color";
  control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
  integer: boolean;
};

export function getNodePreviewMinHeight(node: ComfyNode): number {
  const className = String(node?.comfyClass ?? "");
  return IMAGEOPS_NODE_METADATA.find((entry) => entry.className === className)?.minPreviewHeight
    ?? IMAGEOPS_DEFAULT_PREVIEW_MIN_HEIGHT;
}

function getMeasuredBlockHeight(element: HTMLElement | null | undefined, extra: number = 0): number {
  if (!element || element.style.display === "none") return 0;
  return Math.max(element.offsetHeight ?? 0, element.scrollHeight ?? 0) + extra;
}

function getCanvasDisplayHeight(canvas: HTMLCanvasElement | null | undefined, container: HTMLElement | null): number {
  if (!canvas) return 0;
  const offsetHeight = canvas.offsetHeight ?? 0;
  if (offsetHeight > 0) return offsetHeight;

  const aspectWidth = Math.max(1, Math.round(canvas.width || 1));
  const aspectHeight = Math.max(1, Math.round(canvas.height || 1));
  const innerWidth = Math.max(0, Math.round((container?.clientWidth ?? container?.offsetWidth ?? 0) - 12));
  if (innerWidth <= 0) return 0;
  return Math.round((innerWidth * aspectHeight) / aspectWidth);
}

function getNodePreviewContentHeight(node: ComfyNode, root: HTMLElement | null): number {
  const st = ensureState(node) as any;
  const minHeight = getNodePreviewMinHeight(node);
  const previewRoot = root ?? st.previewRoot;
  const mediaH = getMeasuredBlockHeight(st.mediaWrap, 0);
  const imageH = Math.max(getCanvasDisplayHeight(st.canvas, previewRoot), mediaH);
  const metaH = getMeasuredBlockHeight(st.previewMetaRow, 6);
  const controlsH = getMeasuredBlockHeight(st.previewControls, 8);
  const progressH = getMeasuredBlockHeight(st.progressWrap, 0);
  const compactPanelH = getMeasuredBlockHeight(st.compactNativePanel, 0);
  const chromeH = metaH + controlsH + progressH + compactPanelH + 12;
  return Math.max(minHeight, imageH + chromeH, chromeH);
}

function prettifyWidgetLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getCompactWidgetValue(widget: ComfyWidget, fallback: unknown): string {
  const raw = widget.value ?? fallback ?? "";
  return String(raw ?? "");
}

function buildCompactNativeWidgetControls(node: ComfyNode, onWidgetChange?: () => void): HTMLElement | null {
  return null; // Disabled in favor of native ComfyUI widgets to prevent masking input connection slots (INT/FLOAT)
}

export function syncCompactNativeWidgetControls(node: ComfyNode): void {
  // No-op: Disabled in favor of native ComfyUI widgets to prevent masking input connection slots (INT/FLOAT)
}

export function ensurePreviewWidget(node: ComfyNode, progress: ProgressBus, canvasSize: number, onNativeWidgetChange?: () => void): NodeState | null {
  if (!isImageOpsClass(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;
  const previewNode = isPreviewNode(node);
  const constantNode = isConstantNode(node);
  const grainNode = isGrainNode(node);
  const rampNode = isRampNode(node);
  const textNode = isTextNode(node);
  const colorCorrectNode = isColorCorrectNode(node);
  const cropNode = isCropNode(node);
  const drawNode = isDrawNode(node);
  const compNode = isCompNode(node);
  const joinNode = isAppendNode(node);
  const frameSelectorNode = isFrameRangeNode(node);
  const keyerNode = isKeyerNode(node);
  const padOutNode = isPadOutNode(node);

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
  canvas.tabIndex = 0;

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

  const info = document.createElement("div") as HTMLDivElement;
  info.style.fontSize = "11px";
  info.style.opacity = "0.8";
  info.style.flex = "1 1 auto";
  info.textContent = "Live preview (no queue)";

  let nodeResetButton: HTMLButtonElement | null = null;
  if (!cropNode && !colorCorrectNode && !compNode) {
    nodeResetButton = document.createElement("button");
    nodeResetButton.type = "button";
    nodeResetButton.textContent = "Reset";
    styleInlineAction(nodeResetButton);
    nodeResetButton.style.opacity = "0.85";
  }

  let cropResetButton: HTMLButtonElement | null = null;
  if (cropNode) {
    cropResetButton = createCropResetButton();
  }

  let previewControls: HTMLDivElement | null = null;
  if (previewNode) {
    previewControls = createPreviewControlsUi().controls;
  } else if (constantNode) {
    previewControls = createConstantControlsUi().controls;

  } else if (grainNode) {
    previewControls = createGrainControlsUi(node).controls;
  } else if (textNode) {
    previewControls = createTextControlsUi().controls;
  } else if (rampNode) {
    previewControls = createRampControlsUi().controls;
  } else if (padOutNode) {
    previewControls = createPadOutControlsUi().controls;
  }

  let colorWheelCanvas: HTMLCanvasElement | null = null;
  let colorHueLabel: HTMLDivElement | null = null;
  let colorSatLabel: HTMLDivElement | null = null;
  let colorSwatch: HTMLDivElement | null = null;
  let colorResetButton: HTMLButtonElement | null = null;
  let colorTemperatureInput: HTMLInputElement | null = null;
  let colorTemperatureLabel: HTMLDivElement | null = null;
  let colorTintInput: HTMLInputElement | null = null;
  let colorTintLabel: HTMLDivElement | null = null;
  let colorContrastInput: HTMLInputElement | null = null;
  let colorContrastLabel: HTMLDivElement | null = null;
  let colorSaturationInput: HTMLInputElement | null = null;
  let colorSaturationValueLabel: HTMLDivElement | null = null;
  let colorVibranceInput: HTMLInputElement | null = null;
  let colorVibranceLabel: HTMLDivElement | null = null;
  let colorGammaInput: HTMLInputElement | null = null;
  let colorGammaLabel: HTMLDivElement | null = null;
  let colorShadowWheelCanvas: HTMLCanvasElement | null = null;
  let colorShadowLabel: HTMLDivElement | null = null;
  let colorMidtoneWheelCanvas: HTMLCanvasElement | null = null;
  let colorMidtoneLabel: HTMLDivElement | null = null;
  let colorHighlightWheelCanvas: HTMLCanvasElement | null = null;
  let colorHighlightLabel: HTMLDivElement | null = null;
  let colorBrightnessInput: HTMLInputElement | null = null;
  let colorBrightnessLabel: HTMLDivElement | null = null;
  // Zone tabs let one slider set drive global, shadows, midtones or highlights
  // sliders depending on the active tab. The DOM stays compact (one set of
  // sliders) but bound widget names switch dynamically — the active zone is
  // exposed on the node state so the interaction layer can route writes.
  let colorZoneTabsRow: HTMLDivElement | null = null;
  let colorZoneTabGlobal: HTMLButtonElement | null = null;
  let colorZoneTabShadows: HTMLButtonElement | null = null;
  let colorZoneTabMidtones: HTMLButtonElement | null = null;
  let colorZoneTabHighlights: HTMLButtonElement | null = null;
  let colorControls: HTMLDivElement | null = null;
  if (colorCorrectNode) {
    const colorUi = createColorCorrectControlsUi();
    colorControls = colorUi.controls;
    colorWheelCanvas = colorUi.wheelCanvas;
    colorHueLabel = colorUi.hueLabel;
    colorSatLabel = colorUi.satLabel;
    colorSwatch = colorUi.swatch;
    colorResetButton = colorUi.resetButton;
    colorTemperatureInput = colorUi.temperatureInput;
    colorTemperatureLabel = colorUi.temperatureLabel;
    colorTintInput = colorUi.tintInput;
    colorTintLabel = colorUi.tintLabel;
    colorContrastInput = colorUi.contrastInput;
    colorContrastLabel = colorUi.contrastLabel;
    colorSaturationInput = colorUi.saturationInput;
    colorSaturationValueLabel = colorUi.saturationValueLabel;
    colorVibranceInput = colorUi.vibranceInput;
    colorVibranceLabel = colorUi.vibranceLabel;
    colorGammaInput = colorUi.gammaInput;
    colorGammaLabel = colorUi.gammaLabel;
    colorShadowWheelCanvas = colorUi.shadowWheelCanvas;
    colorShadowLabel = colorUi.shadowLabel;
    colorMidtoneWheelCanvas = colorUi.midtoneWheelCanvas;
    colorMidtoneLabel = colorUi.midtoneLabel;
    colorHighlightWheelCanvas = colorUi.highlightWheelCanvas;
    colorHighlightLabel = colorUi.highlightLabel;
    colorBrightnessInput = colorUi.brightnessInput;
    colorBrightnessLabel = colorUi.brightnessLabel;
    colorZoneTabsRow = colorUi.zoneTabsRow;
    colorZoneTabGlobal = colorUi.zoneTabGlobal;
    colorZoneTabShadows = colorUi.zoneTabShadows;
    colorZoneTabMidtones = colorUi.zoneTabMidtones;
    colorZoneTabHighlights = colorUi.zoneTabHighlights;
  }

  let compAddButton: HTMLButtonElement | null = null;
  let compRemoveButton: HTMLButtonElement | null = null;
  let compResetButton: HTMLButtonElement | null = null;
  let compResizeButton: HTMLButtonElement | null = null;
  let compCornerPinButton: HTMLButtonElement | null = null;
  let compAspectRatioSelect: HTMLSelectElement | null = null;
  let compModeSelect: HTMLSelectElement | null = null;
  let compOpacityInput: HTMLInputElement | null = null;
  let compOpacityLabel: HTMLDivElement | null = null;
  let compLayerLabel: HTMLDivElement | null = null;
  let compControls: HTMLDivElement | null = null;
  if (compNode) {
    const compUi = createCompControlsUi();
    compControls = compUi.controls;
    compAddButton = compUi.addButton;
    compRemoveButton = compUi.removeButton;
    compResetButton = compUi.resetButton;
    compResizeButton = compUi.resizeButton;
    compCornerPinButton = compUi.cornerPinButton;
    compAspectRatioSelect = compUi.aspectRatioSelect;
    compModeSelect = compUi.modeSelect;
    compOpacityInput = compUi.opacityInput;
    compOpacityLabel = compUi.opacityLabel;
    compLayerLabel = compUi.layerLabel;
  }

  let frameSelectorControls: HTMLDivElement | null = null;
  let frameSelectorLabel: HTMLDivElement | null = null;
  let frameSelectorTrimStart: HTMLInputElement | null = null;
  let frameSelectorTrimEnd: HTMLInputElement | null = null;
  let frameSelectorHoldFrame: HTMLInputElement | null = null;
  let frameSelectorRuler: HTMLDivElement | null = null;
  let frameSelectorSliderBox: HTMLDivElement | null = null;
  let frameSelectorFill: HTMLDivElement | null = null;
  let frameSelectorFillLabel: HTMLDivElement | null = null;
  let frameSelectorStartHandle: HTMLDivElement | null = null;
  let frameSelectorEndHandle: HTMLDivElement | null = null;
  let frameSelectorPlayhead: HTMLDivElement | null = null;
  let frameSelectorHoldToggle: HTMLButtonElement | null = null;
  let frameSelectorHoldRow: HTMLDivElement | null = null;
  let frameSelectorRepeatRow: HTMLDivElement | null = null;
  let frameSelectorRepeatToggle: HTMLButtonElement | null = null;
  let frameSelectorRepeatModeSelect: HTMLSelectElement | null = null;
  let frameSelectorRepeatCountInput: HTMLInputElement | null = null;
  if (frameSelectorNode) {
    const frameSelectorUi = createFrameSelectorControlsUi();
    frameSelectorControls = frameSelectorUi.controls;
    frameSelectorLabel = frameSelectorUi.label;
    frameSelectorTrimStart = frameSelectorUi.trimStart;
    frameSelectorTrimEnd = frameSelectorUi.trimEnd;
    frameSelectorHoldFrame = frameSelectorUi.holdFrame;
    frameSelectorRuler = frameSelectorUi.ruler;
    frameSelectorSliderBox = frameSelectorUi.sliderBox;
    frameSelectorFill = frameSelectorUi.fill;
    frameSelectorFillLabel = frameSelectorUi.fillLabel;
    frameSelectorStartHandle = frameSelectorUi.startHandle;
    frameSelectorEndHandle = frameSelectorUi.endHandle;
    frameSelectorPlayhead = frameSelectorUi.playhead;
    frameSelectorHoldToggle = frameSelectorUi.holdToggle;
    frameSelectorHoldRow = frameSelectorUi.holdRow;
    frameSelectorRepeatRow = frameSelectorUi.repeatRow;
    frameSelectorRepeatToggle = frameSelectorUi.repeatToggle;
    frameSelectorRepeatModeSelect = frameSelectorUi.repeatModeSelect;
    frameSelectorRepeatCountInput = frameSelectorUi.repeatCountInput;
  }

  let joinControls: HTMLDivElement | null = null;
  let joinAddButton: HTMLButtonElement | null = null;
  let joinTrimList: HTMLDivElement | null = null;
  if (joinNode) {
    const joinUi = createJoinControlsUi();
    joinControls = joinUi.controls;
    joinAddButton = joinUi.addButton;
    joinTrimList = joinUi.trimList;
  }

  let keyerControls: HTMLDivElement | null = null;
  let keyerModeButtons: HTMLButtonElement[] = [];
  let keyerInvertButton: HTMLButtonElement | null = null;
  let keyerInvertMaskButton: HTMLButtonElement | null = null;
  let keyerBypassButton: HTMLButtonElement | null = null;
  let keyerPickButton: HTMLButtonElement | null = null;
  let keyerColorInput: HTMLInputElement | null = null;
  let keyerToleranceInput: HTMLInputElement | null = null;
  let keyerSoftnessInput: HTMLInputElement | null = null;
  let keyerGainInput: HTMLInputElement | null = null;
  let keyerBlurInput: HTMLInputElement | null = null;
  if (keyerNode) {
    const keyerUi = createKeyerControlsUi();
    keyerControls = keyerUi.controls;
    keyerModeButtons = keyerUi.modeButtons;
    keyerInvertButton = keyerUi.invertButton;
    keyerInvertMaskButton = keyerUi.invertMaskButton;
    keyerBypassButton = keyerUi.bypassButton;
    keyerPickButton = keyerUi.pickButton;
    keyerColorInput = keyerUi.colorInput;
    keyerToleranceInput = keyerUi.toleranceInput;
    keyerSoftnessInput = keyerUi.softnessInput;
    keyerGainInput = keyerUi.gainInput;
    keyerBlurInput = keyerUi.blurInput;
  }

  let drawBrushButton: HTMLButtonElement | null = null;
  let drawEraserButton: HTMLButtonElement | null = null;
  let drawClearButton: HTMLButtonElement | null = null;
  let drawColorInput: HTMLInputElement | null = null;
  let drawEdgeSelect: HTMLSelectElement | null = null;
  let drawSoftnessInput: HTMLInputElement | null = null;
  let drawSoftnessLabel: HTMLDivElement | null = null;
  let drawOpacityInput: HTMLInputElement | null = null;
  let drawOpacityLabel: HTMLDivElement | null = null;
  let drawSizeInput: HTMLInputElement | null = null;
  let drawSizeLabel: HTMLDivElement | null = null;
  let drawWidthInput: HTMLInputElement | null = null;
  let drawHeightInput: HTMLInputElement | null = null;
  let drawLinkButton: HTMLButtonElement | null = null;
  let drawBgColorInput: HTMLInputElement | null = null;
  let drawOverlayFormatSelect: HTMLSelectElement | null = null;
  let drawPressureSizeInput: HTMLInputElement | null = null;
  let drawPressureOpacityInput: HTMLInputElement | null = null;
  let drawTiltSizeInput: HTMLInputElement | null = null;
  let drawControls: HTMLDivElement | null = null;
  if (drawNode) {
    const drawUi = createDrawControlsUi();
    drawControls = drawUi.controls;
    drawBrushButton = drawUi.brushButton;
    drawEraserButton = drawUi.eraserButton;
    drawClearButton = drawUi.clearButton;
    drawColorInput = drawUi.colorInput;
    drawEdgeSelect = drawUi.edgeSelect;
    drawSoftnessInput = drawUi.softnessInput;
    drawSoftnessLabel = drawUi.softnessLabel;
    drawOpacityInput = drawUi.opacityInput;
    drawOpacityLabel = drawUi.opacityLabel;
    drawSizeInput = drawUi.sizeInput;
    drawSizeLabel = drawUi.sizeLabel;
    drawWidthInput = drawUi.widthInput;
    drawHeightInput = drawUi.heightInput;
    drawLinkButton = drawUi.linkButton;
    drawBgColorInput = drawUi.bgColorInput;
    drawOverlayFormatSelect = drawUi.overlayFormatSelect;
    drawPressureSizeInput = drawUi.pressureSizeInput;
    drawPressureOpacityInput = drawUi.pressureOpacityInput;
    drawTiltSizeInput = drawUi.tiltSizeInput;
  }

  const compactNativeControls = buildCompactNativeWidgetControls(node, onNativeWidgetChange);

  const progressWrap = document.createElement("div") as HTMLDivElement;
  progressWrap.style.marginTop = "6px";
  progressWrap.style.height = "6px";
  progressWrap.style.borderRadius = "999px";
  progressWrap.style.background = "rgba(255,255,255,0.12)";
  progressWrap.style.overflow = "hidden";
  progressWrap.style.display = "none";

  const progressBar = document.createElement("div") as HTMLDivElement;
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.borderRadius = "999px";
  progressBar.style.background = "rgba(255,255,255,0.55)";
  progressWrap.appendChild(progressBar);

  root.appendChild(mediaWrap);
  root.appendChild(canvas);
  metaRow.appendChild(info);
  if (nodeResetButton) metaRow.appendChild(nodeResetButton);
  if (cropResetButton) metaRow.appendChild(cropResetButton);
  root.appendChild(metaRow);
  if (previewControls) root.appendChild(previewControls);
  if (colorControls) root.appendChild(colorControls);
  if (drawControls) root.appendChild(drawControls);
  if (compControls) root.appendChild(compControls);
  if (joinControls) root.appendChild(joinControls);
  if (frameSelectorControls) root.appendChild(frameSelectorControls);
  if (keyerControls) root.appendChild(keyerControls);
  if (compactNativeControls) {
    root.appendChild(compactNativeControls);
    (ensureState(node) as any).compactNativePanel = compactNativeControls;
  }
  root.appendChild(progressWrap);

  const activeControls = previewControls ?? colorControls ?? drawControls ?? compControls ?? joinControls ?? frameSelectorControls ?? keyerControls ?? compactNativeControls;

  // Ensure pointer events reach our canvas even if Node 2.0 applies pointer-events:none on parent containers.
  root.style.pointerEvents = "auto";

  if (typeof node.addDOMWidget === "function") {
    node.addDOMWidget("preview", "ImageOpsPreview", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => {
        return getNodePreviewContentHeight(node, root);
      },
    });
    const domWidget = (node.widgets ?? []).find((widget) => widget?.name === "preview") as any;
    // ComfyUI (Vue) hides the DOM widget wrapper by default via widget.hidden.
    // Force it visible so the controls appear without needing a preview image first.
    if (domWidget?.hidden !== false) {
      domWidget.hidden = false;
    }
    if (drawNode && drawClearButton) {
      const clearWrap = document.createElement("div");
      clearWrap.style.display = "flex";
      clearWrap.style.justifyContent = "center";
      clearWrap.style.marginTop = "8px";
      clearWrap.style.marginBottom = "8px";
      clearWrap.style.width = "100%";
      clearWrap.appendChild(drawClearButton);

      node.addDOMWidget("clear_action", "ImageOpsClear", clearWrap, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 32,
      });

      const clearWidget = (node.widgets ?? []).find((widget) => widget?.name === "clear_action") as any;
      if (clearWidget?.hidden !== false) {
        clearWidget.hidden = false;
      }
    }
  } else {
    // Node 2.0 fallback: inject the root element directly into the node's DOM container.
    const domEl = (node as any).domElement ?? (node as any).element;
    if (domEl instanceof HTMLElement) {
      domEl.appendChild(root);
      if (drawNode && drawClearButton) {
        const clearWrap = document.createElement("div");
        clearWrap.style.display = "flex";
        clearWrap.style.justifyContent = "center";
        clearWrap.style.marginTop = "8px";
        clearWrap.style.marginBottom = "8px";
        clearWrap.style.width = "100%";
        clearWrap.appendChild(drawClearButton);
        domEl.appendChild(clearWrap);
      }
    } else {
      console.warn("[ImageOps] addDOMWidget unavailable and no DOM container found on node", node.id);
    }
  }

  // Force the preview widget to the top (before sliders), like KayTool.
  try {
    const widgets = node.widgets ?? [];
    const idx = widgets.findIndex(w => w?.name === "preview");
    if (idx > 0) {
      const [removed] = widgets.splice(idx, 1);
      widgets.unshift(removed);
    }
  } catch {}

  st.canvas = canvas;
  st.previewRoot = root;
  st.previewMetaRow = metaRow;
  st.previewControls = activeControls;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.mediaWrap = mediaWrap;
  st.mediaVideo = mediaVideo;
  st.mediaImage = mediaImage;
  (st as any).nodeResetButton = nodeResetButton;
  st.cropResetButton = cropResetButton;
  st.drawBrushButton = drawBrushButton;
  st.drawEraserButton = drawEraserButton;
  st.drawClearButton = drawClearButton;
  st.drawColorInput = drawColorInput;
  st.drawEdgeSelect = drawEdgeSelect;
  st.drawSoftnessInput = drawSoftnessInput;
  st.drawSoftnessLabel = drawSoftnessLabel;
  st.drawOpacityInput = drawOpacityInput;
  st.drawOpacityLabel = drawOpacityLabel;
  st.drawSizeInput = drawSizeInput;
  st.drawSizeLabel = drawSizeLabel;
  st.drawWidthInput = drawWidthInput;
  st.drawHeightInput = drawHeightInput;
  st.drawLinkButton = drawLinkButton;
  st.drawBgColorInput = drawBgColorInput;
  st.drawOverlayFormatSelect = drawOverlayFormatSelect;
  st.drawPressureSizeInput = drawPressureSizeInput;
  st.drawPressureOpacityInput = drawPressureOpacityInput;
  st.drawTiltSizeInput = drawTiltSizeInput;
  st.colorWheelCanvas = colorWheelCanvas;
  st.colorHueLabel = colorHueLabel;
  st.colorSatLabel = colorSatLabel;
  st.colorSwatch = colorSwatch;
  st.colorResetButton = colorResetButton;
  st.colorTemperatureInput = colorTemperatureInput;
  st.colorTemperatureLabel = colorTemperatureLabel;
  st.colorTintInput = colorTintInput;
  st.colorTintLabel = colorTintLabel;
  st.colorContrastInput = colorContrastInput;
  st.colorContrastLabel = colorContrastLabel;
  st.colorSaturationInput = colorSaturationInput;
  st.colorSaturationValueLabel = colorSaturationValueLabel;
  st.colorVibranceInput = colorVibranceInput;
  st.colorVibranceLabel = colorVibranceLabel;
  st.colorGammaInput = colorGammaInput;
  st.colorGammaLabel = colorGammaLabel;
  st.colorShadowWheelCanvas = colorShadowWheelCanvas;
  st.colorShadowLabel = colorShadowLabel;
  st.colorMidtoneWheelCanvas = colorMidtoneWheelCanvas;
  st.colorMidtoneLabel = colorMidtoneLabel;
  st.colorHighlightWheelCanvas = colorHighlightWheelCanvas;
  st.colorHighlightLabel = colorHighlightLabel;
  st.colorBrightnessInput = colorBrightnessInput;
  st.colorBrightnessLabel = colorBrightnessLabel;
  st.colorZoneTabsRow = colorZoneTabsRow;
  st.colorZoneTabGlobal = colorZoneTabGlobal;
  st.colorZoneTabShadows = colorZoneTabShadows;
  st.colorZoneTabMidtones = colorZoneTabMidtones;
  st.colorZoneTabHighlights = colorZoneTabHighlights;
  st.compAddButton = compAddButton;
  st.compRemoveButton = compRemoveButton;
  st.compResetButton = compResetButton;
  st.compResizeButton = compResizeButton;
  st.compCornerPinButton = compCornerPinButton;
  st.compAspectRatioSelect = compAspectRatioSelect;
  st.compModeSelect = compModeSelect;
  st.compOpacityInput = compOpacityInput;
  st.compOpacityLabel = compOpacityLabel;
  st.compLayerLabel = compLayerLabel;
  (st as any).joinAddButton = joinAddButton;
  (st as any).joinTrimList = joinTrimList;
  (st as any).joinControls = joinControls;
  st.frameSelectorControls = frameSelectorControls;
  st.frameSelectorLabel = frameSelectorLabel;
  st.frameSelectorTrimStart = frameSelectorTrimStart;
  st.frameSelectorTrimEnd = frameSelectorTrimEnd;
  st.frameSelectorHoldFrame = frameSelectorHoldFrame;
  st.frameSelectorRuler = frameSelectorRuler;
  st.frameSelectorSliderBox = frameSelectorSliderBox;
  st.frameSelectorFill = frameSelectorFill;
  (st as any).frameSelectorFillLabel = frameSelectorFillLabel;
  st.frameSelectorStartHandle = frameSelectorStartHandle;
  st.frameSelectorEndHandle = frameSelectorEndHandle;
  st.frameSelectorPlayhead = frameSelectorPlayhead;
  st.frameSelectorHoldToggle = frameSelectorHoldToggle;
  (st as any).frameSelectorHoldRow = frameSelectorHoldRow;
  (st as any).frameSelectorRepeatRow = frameSelectorRepeatRow;
  (st as any).frameSelectorRepeatToggle = frameSelectorRepeatToggle;
  (st as any).frameSelectorRepeatModeSelect = frameSelectorRepeatModeSelect;
  (st as any).frameSelectorRepeatCountInput = frameSelectorRepeatCountInput;
  (st as any).keyerControls = keyerControls;
  (st as any).keyerModeButtons = keyerModeButtons;
  (st as any).keyerInvertButton = keyerInvertButton;
  (st as any).keyerInvertMaskButton = keyerInvertMaskButton;
  (st as any).keyerBypassButton = keyerBypassButton;
  (st as any).keyerPickButton = keyerPickButton;
  (st as any).keyerColorInput = keyerColorInput;
  (st as any).keyerToleranceInput = keyerToleranceInput;
  (st as any).keyerSoftnessInput = keyerSoftnessInput;
  (st as any).keyerGainInput = keyerGainInput;
  (st as any).keyerBlurInput = keyerBlurInput;

  try {
    node.resizable = true;
  } catch {}

  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }

  return st;
}

