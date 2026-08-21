import type { ComfyNode, DrawPreviewGeometry } from "../../types.js";
import { findWidget, widgetNumber, widgetString, widgetBoolean, hideWidgetForGood, setWidgetValue, setWidgetStringValue } from "../shared/widgets.js";
import { ensureState } from "../shared/state.js";
import { styleSoftButton, syncDarkColorInputUI, setDarkColorInputState } from "../shared/dom-styles.js";
import {
  normalizeDrawColor, normalizeDrawEdge, normalizeDrawTool, normalizeDrawOverlayFormat,
  clampDrawDimension, clampDrawOpacity, clampDrawSize, clampDrawSoftness, canvasToOverlayData,
} from "../draw.js";

export const NODE_CLASS = "ImageOpsDraw";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function hideDrawWidgets(node: ComfyNode): void {
  hideWidgetForGood(node, findWidget(node, "bypass"));
  hideWidgetForGood(node, findWidget(node, "invert_mask"));
  hideWidgetForGood(node, findWidget(node, "width"));
  hideWidgetForGood(node, findWidget(node, "height"));
  hideWidgetForGood(node, findWidget(node, "sync_dimensions"));
  hideWidgetForGood(node, findWidget(node, "bg_color"));
  hideWidgetForGood(node, findWidget(node, "tool"));
  hideWidgetForGood(node, findWidget(node, "brush_color"));
  hideWidgetForGood(node, findWidget(node, "brush_edge"));
  hideWidgetForGood(node, findWidget(node, "brush_softness"));
  hideWidgetForGood(node, findWidget(node, "brush_opacity"));
  hideWidgetForGood(node, findWidget(node, "brush_size"));
  hideWidgetForGood(node, findWidget(node, "brush_pressure_size"));
  hideWidgetForGood(node, findWidget(node, "brush_pressure_opacity"));
  hideWidgetForGood(node, findWidget(node, "brush_tilt_size"));
  hideWidgetForGood(node, findWidget(node, "overlay_format"));
  hideWidgetForGood(node, findWidget(node, "overlay_data"));
  hideWidgetForGood(node, findWidget(node, "overlay_layers"));
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
  if (linkWidget) linkWidget.value = linked;
  if (bgWidget && st.drawBgColorInput && !inputConnected) bgWidget.value = st.drawBgColorInput.value;
  if (colorWidget && st.drawColorInput) colorWidget.value = st.drawColorInput.value;
  if (edgeWidget && st.drawEdgeSelect) edgeWidget.value = st.drawEdgeSelect.value;
  if (opacityWidget && st.drawOpacityInput) opacityWidget.value = Number(st.drawOpacityInput.value) / 100;
  if (sizeWidget && st.drawSizeInput) sizeWidget.value = Number(st.drawSizeInput.value);
  if (pressureSizeWidget && st.drawPressureSizeInput) pressureSizeWidget.value = st.drawPressureSizeInput.checked;
  if (pressureOpacityWidget && st.drawPressureOpacityInput) pressureOpacityWidget.value = st.drawPressureOpacityInput.checked;
  if (tiltSizeWidget && st.drawTiltSizeInput) tiltSizeWidget.value = st.drawTiltSizeInput.checked;
  if (overlayFormatWidget && st.drawOverlayFormatSelect) overlayFormatWidget.value = st.drawOverlayFormatSelect.value;
  updateDrawToolButtons(node);
}
