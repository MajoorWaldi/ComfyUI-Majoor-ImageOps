import type { ComfyNode, NodeState, ProgressBus } from "../../types.js";
import { ensureState } from "./state.js";
import { IMAGEOPS_CLASSES } from "./classes.js";
import { isNode as isPreviewNode } from "../nodes/preview.js";
import { isNode as isColorCorrectNode } from "../nodes/color-correct.js";
import { isNode as isCropNode } from "../nodes/crop.js";
import { isNode as isDrawNode } from "../nodes/draw.js";
import { isNode as isCompNode } from "../nodes/comp.js";
import { styleSoftButton, styleSoftField, styleSoftRange, styleInlineAction, createColorSwatch } from "./dom-styles.js";
import { COMP_BLEND_MODES } from "../comp.js";

export function ensurePreviewWidget(node: ComfyNode, progress: ProgressBus, canvasSize: number): NodeState | null {
  if (!IMAGEOPS_CLASSES.has(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;
  const previewNode = isPreviewNode(node);
  const colorCorrectNode = isColorCorrectNode(node);
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

  let cropResetButton: HTMLButtonElement | null = null;
  if (cropNode) {
    cropResetButton = document.createElement("button");
    cropResetButton.type = "button";
    cropResetButton.textContent = "Reset";
    styleInlineAction(cropResetButton);
    cropResetButton.style.opacity = "0.85";
  }

  let previewControls: HTMLDivElement | null = null;
  if (previewNode) {
    previewControls = document.createElement("div");
    previewControls.style.marginTop = "8px";
    previewControls.style.display = "grid";
    previewControls.style.gap = "6px";

    const targetRow = document.createElement("div");
    targetRow.style.display = "grid";
    targetRow.style.gridTemplateColumns = "auto auto auto minmax(0,1fr)";
    targetRow.style.gap = "6px";
    targetRow.style.alignItems = "center";

    for (const [value, label] of [["auto", "Auto"], ["image", "Image"], ["mask", "Mask"]] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.previewTarget = value;
      styleSoftButton(button, value === "auto");
      targetRow.appendChild(button);
    }

    const modeSelect = document.createElement("select");
    modeSelect.dataset.previewMode = "1";
    modeSelect.title = "Preview export mode";
    styleSoftField(modeSelect);
    modeSelect.style.width = "100%";
    for (const mode of ["images", "strip", "animated_webp", "animated_gif"]) {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode.replace(/_/g, " ");
      modeSelect.appendChild(option);
    }
    targetRow.appendChild(modeSelect);
    previewControls.appendChild(targetRow);
  }

  let colorWheelCanvas: HTMLCanvasElement | null = null;
  let colorHueLabel: HTMLDivElement | null = null;
  let colorSatLabel: HTMLDivElement | null = null;
  let colorSwatch: HTMLDivElement | null = null;
  let colorResetButton: HTMLButtonElement | null = null;
  let colorControls: HTMLDivElement | null = null;
  if (colorCorrectNode) {
    colorControls = document.createElement("div");
    colorControls.style.marginTop = "8px";
    colorControls.style.display = "grid";
    colorControls.style.gridTemplateColumns = "minmax(132px, 152px) minmax(0,1fr)";
    colorControls.style.gap = "10px";
    colorControls.style.alignItems = "stretch";

    colorWheelCanvas = document.createElement("canvas");
    colorWheelCanvas.width = 152;
    colorWheelCanvas.height = 152;
    colorWheelCanvas.style.width = "100%";
    colorWheelCanvas.style.aspectRatio = "1";
    colorWheelCanvas.style.borderRadius = "999px";
    colorWheelCanvas.style.cursor = "crosshair";
    colorWheelCanvas.style.background = "radial-gradient(circle at center, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.18) 100%)";
    colorWheelCanvas.style.border = "1px solid rgba(255,255,255,0.1)";
    colorWheelCanvas.style.boxSizing = "border-box";

    const colorMeta = document.createElement("div");
    colorMeta.style.display = "grid";
    colorMeta.style.gap = "6px";
    colorMeta.style.alignContent = "start";

    const colorTitle = document.createElement("div");
    colorTitle.textContent = "Color wheel";
    colorTitle.style.fontSize = "12px";
    colorTitle.style.fontWeight = "600";
    colorTitle.style.letterSpacing = "0.02em";

    const colorHint = document.createElement("div");
    colorHint.textContent = "Drag for hue and chroma. Use the saturation slider below for desat or negative fine tuning.";
    colorHint.style.fontSize = "11px";
    colorHint.style.opacity = "0.72";
    colorHint.style.lineHeight = "1.35";

    colorSwatch = document.createElement("div");
    colorSwatch.style.height = "34px";
    colorSwatch.style.borderRadius = "10px";
    colorSwatch.style.border = "1px solid rgba(255,255,255,0.12)";
    colorSwatch.style.background = "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02))";

    const readoutRow = document.createElement("div");
    readoutRow.style.display = "grid";
    readoutRow.style.gridTemplateColumns = "minmax(0,1fr) minmax(0,1fr)";
    readoutRow.style.gap = "6px";

    colorHueLabel = document.createElement("div");
    colorHueLabel.style.fontSize = "11px";
    colorHueLabel.style.opacity = "0.86";
    colorHueLabel.textContent = "Hue 0°";

    colorSatLabel = document.createElement("div");
    colorSatLabel.style.fontSize = "11px";
    colorSatLabel.style.opacity = "0.86";
    colorSatLabel.style.textAlign = "right";
    colorSatLabel.textContent = "Sat 0%";

    readoutRow.appendChild(colorHueLabel);
    readoutRow.appendChild(colorSatLabel);

    colorResetButton = document.createElement("button");
    colorResetButton.type = "button";
    colorResetButton.textContent = "Reset wheel";
    styleSoftButton(colorResetButton, false);
    colorResetButton.style.justifySelf = "start";

    colorMeta.appendChild(colorTitle);
    colorMeta.appendChild(colorHint);
    colorMeta.appendChild(colorSwatch);
    colorMeta.appendChild(readoutRow);
    colorMeta.appendChild(colorResetButton);

    colorControls.appendChild(colorWheelCanvas);
    colorControls.appendChild(colorMeta);
  }

  let compAddButton: HTMLButtonElement | null = null;
  let compResetButton: HTMLButtonElement | null = null;
  let compResizeButton: HTMLButtonElement | null = null;
  let compCornerPinButton: HTMLButtonElement | null = null;
  let compModeSelect: HTMLSelectElement | null = null;
  let compOpacityInput: HTMLInputElement | null = null;
  let compOpacityLabel: HTMLDivElement | null = null;
  let compLayerLabel: HTMLDivElement | null = null;
  let compControls: HTMLDivElement | null = null;
  if (compNode) {
    compControls = document.createElement("div");
    compControls.style.marginTop = "8px";
    compControls.style.display = "grid";
    compControls.style.gridTemplateColumns = "auto auto auto auto 1fr";
    compControls.style.gap = "6px";
    compControls.style.alignItems = "center";

    compAddButton = document.createElement("button");
    compAddButton.type = "button";
    compAddButton.textContent = "+ Layer";
    styleSoftButton(compAddButton, false);

    compResetButton = document.createElement("button");
    compResetButton.type = "button";
    compResetButton.textContent = "Reset";
    styleSoftButton(compResetButton, false);

    compResizeButton = document.createElement("button");
    compResizeButton.type = "button";
    compResizeButton.textContent = "Scale";
    styleSoftButton(compResizeButton, true);

    compCornerPinButton = document.createElement("button");
    compCornerPinButton.type = "button";
    compCornerPinButton.textContent = "Pin";
    styleSoftButton(compCornerPinButton, false);

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
    compControls.appendChild(compResizeButton);
    compControls.appendChild(compCornerPinButton);
    compControls.appendChild(compLayerLabel);
    compBottomRow.appendChild(compModeSelect);
    compBottomRow.appendChild(compOpacityLabel);
    compBottomRow.appendChild(compOpacityInput);
    compControls.appendChild(compBottomRow);
  }

  let drawBrushButton: HTMLButtonElement | null = null;
  let drawEraserButton: HTMLButtonElement | null = null;
  let drawClearButton: HTMLButtonElement | null = null;
  let drawColorInput: HTMLInputElement | null = null;
  let drawEdgeSelect: HTMLSelectElement | null = null;
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

    drawOverlayFormatSelect = document.createElement("select");
    drawOverlayFormatSelect.title = "Overlay format";
    drawOverlayFormatSelect.style.width = "72px";
    styleSoftField(drawOverlayFormatSelect);
    for (const format of ["png", "webp"]) {
      const option = document.createElement("option");
      option.value = format;
      option.textContent = format.toUpperCase();
      drawOverlayFormatSelect.appendChild(option);
    }

    const rightTools = document.createElement("div");
    rightTools.style.display = "flex";
    rightTools.style.alignItems = "center";
    rightTools.style.gap = "6px";
    rightTools.appendChild(drawOverlayFormatSelect);
    rightTools.appendChild(drawClearButton);

    toolRow.appendChild(drawBrushButton);
    toolRow.appendChild(drawEraserButton);
    topRow.appendChild(toolRow);
    topRow.appendChild(rightTools);

    const strokeRow = document.createElement("div");
    strokeRow.style.display = "grid";
    strokeRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto auto minmax(0,1fr)";
    strokeRow.style.alignItems = "center";
    strokeRow.style.gap = "6px";

    const colorLabel = document.createElement("div");
    colorLabel.textContent = "Color";
    colorLabel.style.fontSize = "11px";
    colorLabel.style.opacity = "0.78";

    const colorSwatchResult = createColorSwatch("#FFFFFF");
    drawColorInput = colorSwatchResult.input;

    drawEdgeSelect = document.createElement("select");
    styleSoftField(drawEdgeSelect);
    drawEdgeSelect.title = "Brush edge";
    for (const edge of ["hard", "soft"]) {
      const option = document.createElement("option");
      option.value = edge;
      option.textContent = edge === "hard" ? "Hard edge" : "Soft edge";
      drawEdgeSelect.appendChild(option);
    }

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
    strokeRow.appendChild(colorSwatchResult.host);
    strokeRow.appendChild(drawEdgeSelect);
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
    drawWidthInput.style.width = "62px";
    styleSoftField(drawWidthInput);

    drawHeightInput = document.createElement("input");
    drawHeightInput.type = "number";
    drawHeightInput.min = "64";
    drawHeightInput.max = "4096";
    drawHeightInput.step = "64";
    drawHeightInput.value = "1024";
    drawHeightInput.placeholder = "H";
    drawHeightInput.title = "Height";
    drawHeightInput.style.width = "62px";
    styleSoftField(drawHeightInput);

    drawLinkButton = document.createElement("button");
    drawLinkButton.type = "button";
    drawLinkButton.textContent = "Linked";
    styleSoftButton(drawLinkButton, true);

    const bgColorSwatchResult = createColorSwatch("#000000", { compact: true, title: "Background color" });
    drawBgColorInput = bgColorSwatchResult.input;

    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(drawSizeInput);
    sizeRow.appendChild(drawSizeLabel);
    sizeRow.appendChild(drawWidthInput);
    sizeRow.appendChild(drawHeightInput);
    sizeRow.appendChild(drawLinkButton);
    sizeRow.appendChild(bgColorSwatchResult.host);

    const dynamicsRow = document.createElement("div");
    dynamicsRow.style.display = "flex";
    dynamicsRow.style.alignItems = "center";
    dynamicsRow.style.gap = "10px";
    dynamicsRow.style.flexWrap = "wrap";
    dynamicsRow.style.fontSize = "11px";
    dynamicsRow.style.opacity = "0.86";

    const dynamicsLabel = document.createElement("span");
    dynamicsLabel.textContent = "Dynamics";
    dynamicsLabel.style.opacity = "0.78";

    const makeDynamicsToggle = (text: string, title: string): [HTMLLabelElement, HTMLInputElement] => {
      const label = document.createElement("label");
      label.style.display = "inline-flex";
      label.style.alignItems = "center";
      label.style.gap = "4px";
      label.title = title;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.style.margin = "0";
      label.appendChild(input);
      label.appendChild(document.createTextNode(text));
      return [label, input];
    };

    const [pressureSizeLabel, pressureSizeInput] = makeDynamicsToggle("Size pressure", "Pen pressure changes brush diameter");
    const [pressureOpacityLabel, pressureOpacityInput] = makeDynamicsToggle("Opacity pressure", "Pen pressure changes brush opacity");
    const [tiltSizeLabel, tiltSizeInput] = makeDynamicsToggle("Tilt size", "Pen tilt widens the brush footprint");
    drawPressureSizeInput = pressureSizeInput;
    drawPressureOpacityInput = pressureOpacityInput;
    drawTiltSizeInput = tiltSizeInput;
    dynamicsRow.appendChild(dynamicsLabel);
    dynamicsRow.appendChild(pressureSizeLabel);
    dynamicsRow.appendChild(pressureOpacityLabel);
    dynamicsRow.appendChild(tiltSizeLabel);

    drawControls.appendChild(topRow);
    drawControls.appendChild(strokeRow);
    drawControls.appendChild(sizeRow);
    drawControls.appendChild(dynamicsRow);
  }

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
  if (cropResetButton) metaRow.appendChild(cropResetButton);
  root.appendChild(metaRow);
  if (previewControls) root.appendChild(previewControls);
  if (colorControls) root.appendChild(colorControls);
  if (drawControls) root.appendChild(drawControls);
  if (compControls) root.appendChild(compControls);
  root.appendChild(progressWrap);

  const domMinHeight = drawNode ? 480 : colorCorrectNode ? 490 : compNode ? 400 : previewNode ? 360 : 320;
  node.addDOMWidget("preview", "ImageOpsPreview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => {
      // Use canvas/mediaWrap rendered height (determined by node WIDTH, not height) to avoid
      // the vertical feedback loop where a tall node makes the DOM tall which makes the node tall.
      const mediaH = mediaWrap.style.display !== "none" ? mediaWrap.offsetHeight : 0;
      const imageH = Math.max(canvas.offsetHeight, mediaH);
      if (imageH === 0) return domMinHeight;
      const metaH = metaRow.offsetHeight + 6; // 6px marginTop
      const activeControls = previewControls ?? colorControls ?? drawControls ?? compControls;
      const controlsH = activeControls ? activeControls.offsetHeight + 8 : 0;
      const progressH = progressWrap.offsetHeight;
      const naturalH = imageH + metaH + controlsH + progressH + 12; // 12px root padding
      return Math.max(domMinHeight, naturalH);
    },
  });

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
  st.scopes = null;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.mediaWrap = mediaWrap;
  st.mediaVideo = mediaVideo;
  st.mediaImage = mediaImage;
  st.scopes = null;
  st.cropResetButton = cropResetButton;
  st.drawBrushButton = drawBrushButton;
  st.drawEraserButton = drawEraserButton;
  st.drawClearButton = drawClearButton;
  st.drawColorInput = drawColorInput;
  st.drawEdgeSelect = drawEdgeSelect;
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
  st.compAddButton = compAddButton;
  st.compResetButton = compResetButton;
  st.compResizeButton = compResizeButton;
  st.compCornerPinButton = compCornerPinButton;
  st.compModeSelect = compModeSelect;
  st.compOpacityInput = compOpacityInput;
  st.compOpacityLabel = compOpacityLabel;
  st.compLayerLabel = compLayerLabel;

  try {
    const cs = (node as any).computeSize?.() ?? [360, domMinHeight];
    node.setSize?.([Math.max(cs[0], 360), Math.max(cs[1], domMinHeight)]);
    node.resizable = true;
  } catch {}

  // Also defer a resize so any post-configure restoration by ComfyUI is overridden.
  setTimeout(() => {
    try {
      const cs2 = (node as any).computeSize?.() ?? [360, domMinHeight];
      node.setSize?.([Math.max(cs2[0], 360), Math.max(cs2[1], domMinHeight)]);
      (node.graph as any)?.setDirtyCanvas(true, true);
    } catch {}
  }, 100);

  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }

  return st;
}
