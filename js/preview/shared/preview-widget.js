import { ensureState } from "./state.js";
import { isImageOpsClass } from "./classes.js";
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
import { styleInlineAction } from "./dom-styles.js";
function getNodePreviewMinHeight(node) {
  if (isDrawNode(node)) return 220;
  if (isConstantNode(node)) return 390;
  if (isGrainNode(node)) return 390;
  if (isTextNode(node)) return 470;
  if (isRampNode(node)) return 430;
  if (isColorCorrectNode(node)) return 490;
  if (isCompNode(node)) return 400;
  if (isAppendNode(node)) return 430;
  if (isPreviewNode(node)) return 360;
  if (isFrameRangeNode(node)) return 390;
  if (isKeyerNode(node)) return 420;
  if (isPadOutNode(node)) return 430;
  return 320;
}
function getMeasuredBlockHeight(element, extra = 0) {
  if (!element || element.style.display === "none") return 0;
  return Math.max(element.offsetHeight ?? 0, element.scrollHeight ?? 0) + extra;
}
function getCanvasDisplayHeight(canvas, container) {
  if (!canvas) return 0;
  const offsetHeight = canvas.offsetHeight ?? 0;
  if (offsetHeight > 0) return offsetHeight;
  const aspectWidth = Math.max(1, Math.round(canvas.width || 1));
  const aspectHeight = Math.max(1, Math.round(canvas.height || 1));
  const innerWidth = Math.max(0, Math.round((container?.clientWidth ?? container?.offsetWidth ?? 0) - 12));
  if (innerWidth <= 0) return 0;
  return Math.round(innerWidth * aspectHeight / aspectWidth);
}
function getNodeSizeSnapshot(node, fallbackHeight) {
  const rawSize = node.size;
  const width = Number(rawSize?.[0]);
  const height = Number(rawSize?.[1]);
  return [
    Number.isFinite(width) && width > 0 ? width : 360,
    Number.isFinite(height) && height > 0 ? height : Math.max(320, Math.round(fallbackHeight ?? getNodePreviewMinHeight(node)))
  ];
}
function getNodePreviewContentHeight(node, root) {
  const st = ensureState(node);
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
function prettifyWidgetLabel(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}
function getCompactWidgetValue(widget, fallback) {
  const raw = widget.value ?? fallback ?? "";
  return String(raw ?? "");
}
function buildCompactNativeWidgetControls(node, onWidgetChange) {
  return null;
}
function syncCompactNativeWidgetControls(node) {
}
function getNodePreviewTargetSize(node, root, fallbackWidth = 360) {
  const minWidth = 360;
  const width = Math.max(minWidth, Math.round(fallbackWidth));
  const contentHeight = getNodePreviewContentHeight(node, root);
  try {
    const computed = node.computeSize?.([width, contentHeight]);
    if (Array.isArray(computed)) {
      const computedWidth = Number(computed[0]);
      const computedHeight = Number(computed[1]);
      return [
        Number.isFinite(computedWidth) ? Math.max(width, Math.round(computedWidth)) : width,
        Number.isFinite(computedHeight) ? Math.max(contentHeight, Math.round(computedHeight)) : contentHeight
      ];
    }
  } catch {
  }
  return [width, contentHeight];
}
function attachPreviewLayoutObserver(node, root) {
  const st = ensureState(node);
  if (st._layoutObserverCleanup) return;
  let rafId = null;
  const syncSize = () => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      try {
        const currentSize = getNodeSizeSnapshot(node);
        const target = getNodePreviewTargetSize(node, root, Math.max(360, Math.round(currentSize?.[0] ?? 360)));
        const widthChanged = Math.abs(Math.round(currentSize?.[0] ?? 0) - target[0]) > 1;
        const heightChanged = Math.abs(Math.round(currentSize?.[1] ?? 0) - target[1]) > 1;
        if (widthChanged || heightChanged) {
          node.setSize?.(target);
          node.graph?.setDirtyCanvas?.(true, true);
        }
      } catch {
      }
    });
  };
  if (typeof ResizeObserver !== "function") {
    st._layoutObserverCleanup = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    syncSize();
    return;
  }
  const observer = new ResizeObserver(() => syncSize());
  for (const element of [
    root,
    st.canvas,
    st.mediaWrap,
    st.previewMetaRow,
    st.previewControls,
    st.progressWrap
  ]) {
    if (element instanceof HTMLElement) observer.observe(element);
  }
  st._layoutObserverCleanup = () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    observer.disconnect();
  };
  syncSize();
}
function ensurePreviewWidget(node, progress, canvasSize, onNativeWidgetChange) {
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
  const info = document.createElement("div");
  info.style.fontSize = "11px";
  info.style.opacity = "0.8";
  info.style.flex = "1 1 auto";
  info.textContent = "Live preview (no queue)";
  let nodeResetButton = null;
  if (!cropNode && !colorCorrectNode && !compNode) {
    nodeResetButton = document.createElement("button");
    nodeResetButton.type = "button";
    nodeResetButton.textContent = "Reset";
    styleInlineAction(nodeResetButton);
    nodeResetButton.style.opacity = "0.85";
  }
  let cropResetButton = null;
  if (cropNode) {
    cropResetButton = createCropResetButton();
  }
  let previewControls = null;
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
  let colorWheelCanvas = null;
  let colorHueLabel = null;
  let colorSatLabel = null;
  let colorSwatch = null;
  let colorResetButton = null;
  let colorTemperatureInput = null;
  let colorTemperatureLabel = null;
  let colorTintInput = null;
  let colorTintLabel = null;
  let colorContrastInput = null;
  let colorContrastLabel = null;
  let colorSaturationInput = null;
  let colorSaturationValueLabel = null;
  let colorVibranceInput = null;
  let colorVibranceLabel = null;
  let colorGammaInput = null;
  let colorGammaLabel = null;
  let colorShadowWheelCanvas = null;
  let colorShadowLabel = null;
  let colorMidtoneWheelCanvas = null;
  let colorMidtoneLabel = null;
  let colorHighlightWheelCanvas = null;
  let colorHighlightLabel = null;
  let colorBrightnessInput = null;
  let colorBrightnessLabel = null;
  let colorZoneTabsRow = null;
  let colorZoneTabGlobal = null;
  let colorZoneTabShadows = null;
  let colorZoneTabMidtones = null;
  let colorZoneTabHighlights = null;
  let colorControls = null;
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
  let compAddButton = null;
  let compRemoveButton = null;
  let compResetButton = null;
  let compResizeButton = null;
  let compCornerPinButton = null;
  let compAspectRatioSelect = null;
  let compModeSelect = null;
  let compOpacityInput = null;
  let compOpacityLabel = null;
  let compLayerLabel = null;
  let compControls = null;
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
  let frameSelectorControls = null;
  let frameSelectorLabel = null;
  let frameSelectorTrimStart = null;
  let frameSelectorTrimEnd = null;
  let frameSelectorHoldFrame = null;
  let frameSelectorRuler = null;
  let frameSelectorSliderBox = null;
  let frameSelectorFill = null;
  let frameSelectorFillLabel = null;
  let frameSelectorStartHandle = null;
  let frameSelectorEndHandle = null;
  let frameSelectorPlayhead = null;
  let frameSelectorHoldToggle = null;
  let frameSelectorHoldRow = null;
  let frameSelectorRepeatRow = null;
  let frameSelectorRepeatToggle = null;
  let frameSelectorRepeatModeSelect = null;
  let frameSelectorRepeatCountInput = null;
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
  let joinControls = null;
  let joinAddButton = null;
  let joinTrimList = null;
  if (joinNode) {
    const joinUi = createJoinControlsUi();
    joinControls = joinUi.controls;
    joinAddButton = joinUi.addButton;
    joinTrimList = joinUi.trimList;
  }
  let keyerControls = null;
  let keyerModeButtons = [];
  let keyerInvertButton = null;
  let keyerInvertMaskButton = null;
  let keyerBypassButton = null;
  let keyerPickButton = null;
  let keyerColorInput = null;
  let keyerToleranceInput = null;
  let keyerSoftnessInput = null;
  let keyerGainInput = null;
  let keyerBlurInput = null;
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
  let drawBrushButton = null;
  let drawEraserButton = null;
  let drawClearButton = null;
  let drawColorInput = null;
  let drawEdgeSelect = null;
  let drawSoftnessInput = null;
  let drawSoftnessLabel = null;
  let drawOpacityInput = null;
  let drawOpacityLabel = null;
  let drawSizeInput = null;
  let drawSizeLabel = null;
  let drawWidthInput = null;
  let drawHeightInput = null;
  let drawLinkButton = null;
  let drawBgColorInput = null;
  let drawOverlayFormatSelect = null;
  let drawPressureSizeInput = null;
  let drawPressureOpacityInput = null;
  let drawTiltSizeInput = null;
  let drawControls = null;
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
    ensureState(node).compactNativePanel = compactNativeControls;
  }
  root.appendChild(progressWrap);
  const activeControls = previewControls ?? colorControls ?? drawControls ?? compControls ?? joinControls ?? frameSelectorControls ?? keyerControls ?? compactNativeControls;
  root.style.pointerEvents = "auto";
  const domMinHeight = getNodePreviewMinHeight(node);
  if (typeof node.addDOMWidget === "function") {
    node.addDOMWidget("preview", "ImageOpsPreview", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => {
        return getNodePreviewContentHeight(node, root);
      }
    });
    const domWidget = (node.widgets ?? []).find((widget) => widget?.name === "preview");
    if (domWidget?.hidden !== false) {
      domWidget.hidden = false;
    }
    requestAnimationFrame(() => {
      const state = ensureState(node);
      if (state._displayObserverCleanup) return;
      if (root.style.display === "none") root.style.display = "";
      const obs = new MutationObserver(() => {
        if (root.style.display === "none") root.style.display = "";
      });
      obs.observe(root, { attributes: true, attributeFilter: ["style"] });
      state._displayObserverCleanup = () => obs.disconnect();
    });
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
        getMinHeight: () => 32
      });
      const clearWidget = (node.widgets ?? []).find((widget) => widget?.name === "clear_action");
      if (clearWidget?.hidden !== false) {
        clearWidget.hidden = false;
      }
    }
  } else {
    const domEl = node.domElement ?? node.element;
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
  st.previewRoot = root;
  st.previewMetaRow = metaRow;
  st.previewControls = activeControls;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.mediaWrap = mediaWrap;
  st.mediaVideo = mediaVideo;
  st.mediaImage = mediaImage;
  st.nodeResetButton = nodeResetButton;
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
  st.joinAddButton = joinAddButton;
  st.joinTrimList = joinTrimList;
  st.joinControls = joinControls;
  st.frameSelectorControls = frameSelectorControls;
  st.frameSelectorLabel = frameSelectorLabel;
  st.frameSelectorTrimStart = frameSelectorTrimStart;
  st.frameSelectorTrimEnd = frameSelectorTrimEnd;
  st.frameSelectorHoldFrame = frameSelectorHoldFrame;
  st.frameSelectorRuler = frameSelectorRuler;
  st.frameSelectorSliderBox = frameSelectorSliderBox;
  st.frameSelectorFill = frameSelectorFill;
  st.frameSelectorFillLabel = frameSelectorFillLabel;
  st.frameSelectorStartHandle = frameSelectorStartHandle;
  st.frameSelectorEndHandle = frameSelectorEndHandle;
  st.frameSelectorPlayhead = frameSelectorPlayhead;
  st.frameSelectorHoldToggle = frameSelectorHoldToggle;
  st.frameSelectorHoldRow = frameSelectorHoldRow;
  st.frameSelectorRepeatRow = frameSelectorRepeatRow;
  st.frameSelectorRepeatToggle = frameSelectorRepeatToggle;
  st.frameSelectorRepeatModeSelect = frameSelectorRepeatModeSelect;
  st.frameSelectorRepeatCountInput = frameSelectorRepeatCountInput;
  st.keyerControls = keyerControls;
  st.keyerModeButtons = keyerModeButtons;
  st.keyerInvertButton = keyerInvertButton;
  st.keyerInvertMaskButton = keyerInvertMaskButton;
  st.keyerBypassButton = keyerBypassButton;
  st.keyerPickButton = keyerPickButton;
  st.keyerColorInput = keyerColorInput;
  st.keyerToleranceInput = keyerToleranceInput;
  st.keyerSoftnessInput = keyerSoftnessInput;
  st.keyerGainInput = keyerGainInput;
  st.keyerBlurInput = keyerBlurInput;
  try {
    if (!frameSelectorNode) {
      const cs = node.computeSize?.() ?? [360, domMinHeight];
      node.setSize?.(getNodePreviewTargetSize(node, root, Math.max(cs[0], 360)));
    }
    node.resizable = true;
  } catch {
  }
  attachPreviewLayoutObserver(node, root);
  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }
  return st;
}
export {
  ensurePreviewWidget,
  getNodePreviewMinHeight,
  getNodePreviewTargetSize,
  syncCompactNativeWidgetControls
};
