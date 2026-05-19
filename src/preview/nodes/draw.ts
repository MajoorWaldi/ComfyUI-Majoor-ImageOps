import type { ComfyNode, DrawPreviewGeometry } from "../../types.js";
import { findWidget, widgetNumber, widgetString, widgetBoolean, hideWidgetForGood, hideWidgetsByName, setWidgetValue, setWidgetStringValue, setWidgetBooleanValue } from "../shared/widgets.js";
import { ensureState } from "../shared/state.js";
import {
  createColorSwatch,
  createContextMenuSelect,
  setDarkColorInputState,
  styleInlineAction,
  styleSoftButton,
  styleSoftField,
  styleSoftRange,
  syncDarkColorInputUI,
} from "../shared/dom-styles.js";
import {
  normalizeDrawColor, normalizeDrawEdge, normalizeDrawTool, normalizeDrawOverlayFormat,
  clampDrawDimension, clampDrawOpacity, clampDrawSize, clampDrawSoftness, canvasToOverlayData,
} from "../draw.js";

export const NODE_CLASS = "ImageOpsDraw";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export type DrawControlsUi = {
  controls: HTMLDivElement;
  brushButton: HTMLButtonElement;
  eraserButton: HTMLButtonElement;
  clearButton: HTMLButtonElement;
  colorInput: HTMLInputElement;
  edgeSelect: HTMLSelectElement;
  softnessInput: HTMLInputElement;
  softnessLabel: HTMLDivElement;
  opacityInput: HTMLInputElement;
  opacityLabel: HTMLDivElement;
  sizeInput: HTMLInputElement | null;
  sizeLabel: HTMLDivElement | null;
  widthInput: HTMLInputElement | null;
  heightInput: HTMLInputElement | null;
  linkButton: HTMLButtonElement;
  bgColorInput: HTMLInputElement;
  overlayFormatSelect: HTMLSelectElement;
  pressureSizeInput: HTMLInputElement;
  pressureOpacityInput: HTMLInputElement;
  tiltSizeInput: HTMLInputElement;
};

export function createDrawControlsUi(): DrawControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const topRow = document.createElement("div");
  topRow.style.display = "flex";
  topRow.style.alignItems = "center";
  topRow.style.justifyContent = "space-between";
  topRow.style.gap = "8px";

  const toolRow = document.createElement("div");
  toolRow.style.display = "flex";
  toolRow.style.alignItems = "center";
  toolRow.style.gap = "6px";

  const brushButton = document.createElement("button");
  brushButton.type = "button";
  brushButton.textContent = "Brush";
  styleSoftButton(brushButton, true);

  const eraserButton = document.createElement("button");
  eraserButton.type = "button";
  eraserButton.textContent = "Eraser";
  styleSoftButton(eraserButton, false);

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "Clear";
  styleInlineAction(clearButton);

  const overlayFormatSelect = document.createElement("select");
  overlayFormatSelect.title = "Overlay format";
  overlayFormatSelect.style.width = "72px";
  styleSoftField(overlayFormatSelect);
  for (const format of ["png", "webp"]) {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format.toUpperCase();
    overlayFormatSelect.appendChild(option);
  }

  const rightTools = document.createElement("div");
  rightTools.style.display = "flex";
  rightTools.style.alignItems = "center";
  rightTools.style.gap = "6px";
  rightTools.appendChild(createContextMenuSelect(overlayFormatSelect));
  rightTools.appendChild(clearButton);

  toolRow.appendChild(brushButton);
  toolRow.appendChild(eraserButton);
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
  const colorInput = colorSwatchResult.input;

  const edgeSelect = document.createElement("select");
  styleSoftField(edgeSelect);
  edgeSelect.title = "Brush edge";
  for (const edge of ["hard", "soft"]) {
    const option = document.createElement("option");
    option.value = edge;
    option.textContent = edge === "hard" ? "Hard edge" : "Soft edge";
    edgeSelect.appendChild(option);
  }

  const opacityLabel = document.createElement("div");
  opacityLabel.textContent = "100%";
  opacityLabel.style.fontSize = "11px";
  opacityLabel.style.opacity = "0.82";
  opacityLabel.style.justifySelf = "end";

  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.min = "0";
  opacityInput.max = "100";
  opacityInput.step = "1";
  opacityInput.value = "100";
  opacityInput.title = "Brush opacity";
  styleSoftRange(opacityInput);

  strokeRow.appendChild(colorLabel);
  strokeRow.appendChild(colorSwatchResult.host);
  strokeRow.appendChild(createContextMenuSelect(edgeSelect));
  strokeRow.appendChild(opacityLabel);
  strokeRow.appendChild(opacityInput);

  const softnessRow = document.createElement("div");
  softnessRow.style.display = "grid";
  softnessRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto";
  softnessRow.style.alignItems = "center";
  softnessRow.style.gap = "6px";

  const softnessTextLabel = document.createElement("div");
  softnessTextLabel.textContent = "Softness";
  softnessTextLabel.style.fontSize = "11px";
  softnessTextLabel.style.opacity = "0.78";

  const softnessInput = document.createElement("input");
  softnessInput.type = "range";
  softnessInput.min = "0";
  softnessInput.max = "100";
  softnessInput.step = "1";
  softnessInput.value = "50";
  softnessInput.title = "Soft brush feather (only when edge=Soft)";
  styleSoftRange(softnessInput);

  const softnessLabel = document.createElement("div");
  softnessLabel.textContent = "50%";
  softnessLabel.style.fontSize = "11px";
  softnessLabel.style.opacity = "0.82";
  softnessLabel.style.justifySelf = "end";

  softnessRow.appendChild(softnessTextLabel);
  softnessRow.appendChild(softnessInput);
  softnessRow.appendChild(softnessLabel);

  const sizeRow = document.createElement("div");
  sizeRow.style.display = "grid";
  sizeRow.style.gridTemplateColumns = "auto auto";
  sizeRow.style.alignItems = "center";
  sizeRow.style.gap = "6px";
  sizeRow.style.minWidth = "0";

  const linkButton = document.createElement("button");
  linkButton.type = "button";
  linkButton.textContent = "Linked";
  styleSoftButton(linkButton, true);

  const bgColorSwatchResult = createColorSwatch("#000000", { compact: true, title: "Background color" });
  const bgColorInput = bgColorSwatchResult.input;

  sizeRow.appendChild(linkButton);
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
  dynamicsRow.appendChild(dynamicsLabel);
  dynamicsRow.appendChild(pressureSizeLabel);
  dynamicsRow.appendChild(pressureOpacityLabel);
  dynamicsRow.appendChild(tiltSizeLabel);

  controls.appendChild(topRow);
  controls.appendChild(strokeRow);
  controls.appendChild(softnessRow);
  controls.appendChild(sizeRow);
  controls.appendChild(dynamicsRow);

  return {
    controls,
    brushButton,
    eraserButton,
    clearButton,
    colorInput,
    edgeSelect,
    softnessInput,
    softnessLabel,
    opacityInput,
    opacityLabel,
    sizeInput: null,
    sizeLabel: null,
    widthInput: null,
    heightInput: null,
    linkButton,
    bgColorInput,
    overlayFormatSelect,
    pressureSizeInput,
    pressureOpacityInput,
    tiltSizeInput,
  };
}

export function hideDrawWidgets(node: ComfyNode): void {
  // Use hideWidgetsByName so duplicate widgets (e.g. ComfyUI auto-adds an
  // uppercase COLOR / BOOLEAN copy alongside the original) are all hidden.
  const names = [
    "bypass",
    "invert_mask",
    "sync_dimensions",
    "width",
    "height",
    "bg_color",
    "tool",
    "brush_color",
    "brush_size",
    "brush_edge",
    "brush_softness",
    "brush_opacity",
    "brush_pressure_size",
    "brush_pressure_opacity",
    "brush_tilt_size",
    "overlay_format",
    "overlay_data",
    "overlay_layers",
  ];
  for (const name of names) hideWidgetsByName(node, name);
}

export function canvasToDrawSourcePoint(geometry: DrawPreviewGeometry | null, x: number, y: number): { x: number; y: number; inside: boolean } {
  if (!geometry) return { x: 0, y: 0, inside: false };
  const localX = (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth);
  const localY = (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight);
  const inside = localX >= 0 && localX <= 1 && localY >= 0 && localY <= 1;
  return {
    x: Math.max(0, Math.min(geometry.sourceWidth, localX * geometry.sourceWidth)),
    y: Math.max(0, Math.min(geometry.sourceHeight, localY * geometry.sourceHeight)),
    inside,
  };
}

// ── Runtime widget sync helpers ──

export function getDrawInfoText(node: ComfyNode, width: number, height: number): string {
  const inputConnected = (node.inputs?.[0]?.link ?? null) != null;
  return inputConnected
    ? `Paint preview (paint over input, ${width}x${height})`
    : `Paint preview (${width}x${height})`;
}

export function updateDrawToolButtons(node: ComfyNode): void {
  const st = ensureState(node);
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  if (st.drawBrushButton) styleSoftButton(st.drawBrushButton, tool === "brush");
  if (st.drawEraserButton) styleSoftButton(st.drawEraserButton, tool === "eraser");
}

export function updateDrawOverlayWidget(node: ComfyNode): void {
  const st = ensureState(node);
  const value = canvasToOverlayData(st.drawCanvas, normalizeDrawOverlayFormat(widgetString(node, "overlay_format", "png")));
  const layers = value
    ? JSON.stringify({ version: 1, active: 0, layers: [{ name: "Layer 1", enabled: true, opacity: 1, data: value }] })
    : "";
  st.drawOverlayKey = `${layers}\n${value}`;
  setWidgetStringValue(findWidget(node, "overlay_data"), value);
  setWidgetStringValue(findWidget(node, "overlay_layers"), layers);
}

export function syncDrawWidgets(node: ComfyNode, changedName?: string): void {
  if (!isNode(node)) return;
  const st = ensureState(node);
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  const linkWidget = findWidget(node, "sync_dimensions");
  const bgWidget = findWidget(node, "bg_color");
  const colorWidget = findWidget(node, "brush_color");
  const edgeWidget = findWidget(node, "brush_edge");
  const opacityWidget = findWidget(node, "brush_opacity");
  const sizeWidget = findWidget(node, "brush_size");
  const pressureSizeWidget = findWidget(node, "brush_pressure_size");
  const pressureOpacityWidget = findWidget(node, "brush_pressure_opacity");
  const tiltSizeWidget = findWidget(node, "brush_tilt_size");
  const overlayFormatWidget = findWidget(node, "overlay_format");
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

  setWidgetValue(widthWidget, width);
  setWidgetValue(heightWidget, height);

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
    const bgColor = normalizeDrawColor(widgetString(node, "bg_color", "#000000"), "#000000");
    syncDarkColorInputUI(st.drawBgColorInput, bgColor);
    setDarkColorInputState(st.drawBgColorInput, inputConnected);
  }
  if (st.drawColorInput) {
    const brushColor = normalizeDrawColor(widgetString(node, "brush_color", "#FFFFFF"), "#FFFFFF");
    syncDarkColorInputUI(st.drawColorInput, brushColor);
  }
  if (st.drawEdgeSelect) {
    const edgeMode = normalizeDrawEdge(widgetString(node, "brush_edge", "hard"));
    st.drawEdgeSelect.value = edgeMode;
    if (st.drawSoftnessInput) {
      const softness = Math.round(clampDrawSoftness(widgetNumber(node, "brush_softness", 0.5), 0.5) * 100);
      st.drawSoftnessInput.value = String(softness);
      st.drawSoftnessInput.disabled = edgeMode === "hard";
      st.drawSoftnessInput.style.opacity = edgeMode === "hard" ? "0.45" : "1";
      st.drawSoftnessInput.title = `Soft brush feather ${softness}%`;
      if (st.drawSoftnessLabel) {
        st.drawSoftnessLabel.textContent = `${softness}%`;
        st.drawSoftnessLabel.style.opacity = edgeMode === "hard" ? "0.45" : "0.82";
      }
    }
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
  if (st.drawOverlayFormatSelect) {
    st.drawOverlayFormatSelect.value = normalizeDrawOverlayFormat(widgetString(node, "overlay_format", "png"));
  }
  if (st.drawPressureSizeInput) {
    st.drawPressureSizeInput.checked = widgetBoolean(node, "brush_pressure_size", true);
  }
  if (st.drawPressureOpacityInput) {
    st.drawPressureOpacityInput.checked = widgetBoolean(node, "brush_pressure_opacity", true);
  }
  if (st.drawTiltSizeInput) {
    st.drawTiltSizeInput.checked = widgetBoolean(node, "brush_tilt_size", false);
  }
  setWidgetBooleanValue(linkWidget, linked);
  if (st.drawBgColorInput && !inputConnected) setWidgetStringValue(bgWidget, st.drawBgColorInput.value);
  if (st.drawColorInput) setWidgetStringValue(colorWidget, st.drawColorInput.value);
  if (st.drawEdgeSelect) setWidgetStringValue(edgeWidget, st.drawEdgeSelect.value);
  if (st.drawOpacityInput) setWidgetValue(opacityWidget, Number(st.drawOpacityInput.value) / 100);
  if (st.drawSizeInput) setWidgetValue(sizeWidget, Number(st.drawSizeInput.value));
  if (st.drawPressureSizeInput) setWidgetBooleanValue(pressureSizeWidget, st.drawPressureSizeInput.checked);
  if (st.drawPressureOpacityInput) setWidgetBooleanValue(pressureOpacityWidget, st.drawPressureOpacityInput.checked);
  if (st.drawTiltSizeInput) setWidgetBooleanValue(tiltSizeWidget, st.drawTiltSizeInput.checked);
  if (st.drawOverlayFormatSelect) setWidgetStringValue(overlayFormatWidget, st.drawOverlayFormatSelect.value);
  updateDrawToolButtons(node);
}
