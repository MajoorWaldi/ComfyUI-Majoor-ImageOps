import {
  canvasToOverlayData,
  clampDrawDimension,
  clampDrawOpacity,
  clampDrawSize,
  clampDrawSoftness,
  normalizeDrawColor,
  normalizeDrawEdge,
  normalizeDrawOverlayFormat,
  normalizeDrawTool
} from "../draw.js";
import {
  setDarkColorInputState,
  styleSoftButton,
  syncDarkColorInputUI
} from "../shared/dom-styles.js";
import { ensureState } from "../shared/state.js";
import { findWidget, hideWidgetsByName, setWidgetBooleanValue, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsDraw";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function styleSegmentControl(container) {
  container.style.display = "flex";
  container.style.background = "#181818";
  container.style.borderRadius = "6px";
  container.style.padding = "2px";
  container.style.border = "1px solid #2e2e2e";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";
}
function styleSegmentButton(button, active) {
  button.style.flex = "1";
  button.style.border = "none";
  button.style.outline = "none";
  button.style.borderRadius = "4px";
  button.style.padding = "4px 8px";
  button.style.fontSize = "10.5px";
  button.style.fontFamily = "var(--comfy-font-sans, Inter, sans-serif)";
  button.style.cursor = "pointer";
  button.style.transition = "background 0.15s, color 0.15s";
  button.style.lineHeight = "1.2";
  button.style.textAlign = "center";
  if (active) {
    button.classList.add("active");
    button.style.background = "#525252";
    button.style.color = "#ffffff";
    button.style.fontWeight = "600";
  } else {
    button.classList.remove("active");
    button.style.background = "transparent";
    button.style.color = "#aaaaaa";
    button.style.fontWeight = "normal";
  }
}
function setupSegmentHover(button) {
  button.addEventListener("mouseenter", () => {
    if (!button.classList.contains("active")) {
      button.style.background = "rgba(255,255,255,0.06)";
      button.style.color = "#ffffff";
    }
  });
  button.addEventListener("mouseleave", () => {
    if (!button.classList.contains("active")) {
      button.style.background = "transparent";
      button.style.color = "#aaaaaa";
    }
  });
}
function createDrawControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gridTemplateColumns = "72px 1fr";
  controls.style.rowGap = "8px";
  controls.style.columnGap = "12px";
  controls.style.alignItems = "center";
  controls.style.width = "100%";
  controls.style.boxSizing = "border-box";
  controls.style.padding = "0 4px";
  const styleLabel = (el) => {
    el.style.fontSize = "11px";
    el.style.opacity = "0.78";
    el.style.fontFamily = "var(--comfy-font-sans, Inter, sans-serif)";
    el.style.whiteSpace = "nowrap";
  };
  const toolLabel = document.createElement("div");
  toolLabel.textContent = "Tool";
  styleLabel(toolLabel);
  const brushButton = document.createElement("button");
  brushButton.type = "button";
  brushButton.textContent = "Brush";
  styleSegmentButton(brushButton, true);
  setupSegmentHover(brushButton);
  const eraserButton = document.createElement("button");
  eraserButton.type = "button";
  eraserButton.textContent = "Eraser";
  styleSegmentButton(eraserButton, false);
  setupSegmentHover(eraserButton);
  const toolGroup = document.createElement("div");
  styleSegmentControl(toolGroup);
  toolGroup.appendChild(brushButton);
  toolGroup.appendChild(eraserButton);
  controls.appendChild(toolLabel);
  controls.appendChild(toolGroup);
  const edgeLabel = document.createElement("div");
  edgeLabel.textContent = "Edge";
  styleLabel(edgeLabel);
  const edgeSelect = document.createElement("select");
  edgeSelect.style.display = "none";
  for (const edge of ["hard", "soft"]) {
    const option = document.createElement("option");
    option.value = edge;
    option.textContent = edge === "hard" ? "Hard" : "Soft";
    edgeSelect.appendChild(option);
  }
  const hardButton = document.createElement("button");
  hardButton.type = "button";
  hardButton.textContent = "Hard";
  styleSegmentButton(hardButton, true);
  setupSegmentHover(hardButton);
  const softButton = document.createElement("button");
  softButton.type = "button";
  softButton.textContent = "Soft";
  styleSegmentButton(softButton, false);
  setupSegmentHover(softButton);
  edgeSelect.__hardButton = hardButton;
  edgeSelect.__softButton = softButton;
  const updateEdgeUi = (edge) => {
    styleSegmentButton(hardButton, edge === "hard");
    styleSegmentButton(softButton, edge === "soft");
  };
  hardButton.addEventListener("click", (e) => {
    e.preventDefault();
    edgeSelect.value = "hard";
    edgeSelect.dispatchEvent(new Event("change"));
    updateEdgeUi("hard");
  });
  softButton.addEventListener("click", (e) => {
    e.preventDefault();
    edgeSelect.value = "soft";
    edgeSelect.dispatchEvent(new Event("change"));
    updateEdgeUi("soft");
  });
  const edgeGroup = document.createElement("div");
  styleSegmentControl(edgeGroup);
  edgeGroup.appendChild(hardButton);
  edgeGroup.appendChild(softButton);
  edgeGroup.appendChild(edgeSelect);
  controls.appendChild(edgeLabel);
  controls.appendChild(edgeGroup);
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "\u21BA Clear";
  clearButton.style.border = "1px solid #3f3f3f";
  clearButton.style.background = "#2a2a2a";
  clearButton.style.color = "#ccc";
  clearButton.style.borderRadius = "4px";
  clearButton.style.padding = "4px 16px";
  clearButton.style.cursor = "pointer";
  clearButton.style.fontSize = "11px";
  clearButton.style.lineHeight = "1.2";
  clearButton.style.transition = "background 0.15s ease, color 0.15s ease, border-color 0.15s ease";
  clearButton.addEventListener("mouseenter", () => {
    clearButton.style.background = "#3e3e3e";
    clearButton.style.color = "#fff";
    clearButton.style.borderColor = "#555";
  });
  clearButton.addEventListener("mouseleave", () => {
    clearButton.style.background = "#2a2a2a";
    clearButton.style.color = "#ccc";
    clearButton.style.borderColor = "#3f3f3f";
  });
  clearButton.addEventListener("mousedown", () => {
    clearButton.style.background = "#1c1c1c";
    clearButton.style.color = "#aaa";
  });
  clearButton.addEventListener("mouseup", () => {
    clearButton.style.background = "#3e3e3e";
    clearButton.style.color = "#fff";
  });
  return {
    controls,
    brushButton,
    eraserButton,
    clearButton,
    colorInput: null,
    edgeSelect,
    softnessInput: null,
    softnessLabel: null,
    opacityInput: null,
    opacityLabel: null,
    sizeInput: null,
    sizeLabel: null,
    widthInput: null,
    heightInput: null,
    linkButton: null,
    bgColorInput: null,
    overlayFormatSelect: null,
    pressureSizeInput: null,
    pressureOpacityInput: null,
    tiltSizeInput: null
  };
}
function hideDrawWidgets(node) {
  const namesToHide = [
    "overlay_data",
    "overlay_layers",
    "tool",
    "brush_edge"
  ];
  for (const name of namesToHide) {
    hideWidgetsByName(node, name);
  }
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
function getDrawInfoText(node, width, height) {
  const inputConnected = (node.inputs?.[0]?.link ?? null) != null;
  return inputConnected ? `Paint preview (paint over input, ${width}x${height})` : `Paint preview (${width}x${height})`;
}
function updateDrawToolButtons(node) {
  const st = ensureState(node);
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  if (st.drawBrushButton) styleSegmentButton(st.drawBrushButton, tool === "brush");
  if (st.drawEraserButton) styleSegmentButton(st.drawEraserButton, tool === "eraser");
}
function updateDrawOverlayWidget(node) {
  const st = ensureState(node);
  const value = canvasToOverlayData(st.drawCanvas, normalizeDrawOverlayFormat(widgetString(node, "overlay_format", "png")));
  const layers = value ? JSON.stringify({ version: 1, active: 0, layers: [{ name: "Layer 1", enabled: true, opacity: 1, data: value }] }) : "";
  st.drawOverlayKey = `${layers}
${value}`;
  setWidgetStringValue(findWidget(node, "overlay_data"), value);
  setWidgetStringValue(findWidget(node, "overlay_layers"), layers);
}
function syncDrawWidgets(node, changedName) {
  if (!isNode(node)) return;
  hideDrawWidgets(node);
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
  const softnessWidget = findWidget(node, "brush_softness");
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
    setWidgetStringValuesByName(node, "bg_color", bgColor, { notify: false, dirty: false });
    syncDarkColorInputUI(st.drawBgColorInput, bgColor);
    setDarkColorInputState(st.drawBgColorInput, inputConnected);
  }
  if (st.drawColorInput) {
    const brushColor = normalizeDrawColor(widgetString(node, "brush_color", "#FFFFFF"), "#FFFFFF");
    setWidgetStringValuesByName(node, "brush_color", brushColor, { notify: false, dirty: false });
    syncDarkColorInputUI(st.drawColorInput, brushColor);
  }
  if (st.drawEdgeSelect) {
    const edgeMode = normalizeDrawEdge(widgetString(node, "brush_edge", "hard"));
    st.drawEdgeSelect.value = edgeMode;
    const hb = st.drawEdgeSelect.__hardButton;
    const sb = st.drawEdgeSelect.__softButton;
    if (hb) styleSegmentButton(hb, edgeMode === "hard");
    if (sb) styleSegmentButton(sb, edgeMode === "soft");
    if (st.drawSoftnessInput) {
      const softnessPercent = Math.round(clampDrawSoftness(widgetNumber(node, "brush_softness", 0.5), 0.5) * 100);
      const hardness = edgeMode === "hard" ? 100 : 100 - softnessPercent;
      st.drawSoftnessInput.value = String(hardness);
      st.drawSoftnessInput.title = `Brush edge hardness ${hardness}%`;
      if (st.drawSoftnessLabel) {
        st.drawSoftnessLabel.textContent = `${hardness}%`;
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
  if (st.drawSoftnessInput) {
    const hardness = Number(st.drawSoftnessInput.value);
    if (hardness === 100) {
      setWidgetStringValue(edgeWidget, "hard");
      setWidgetValue(softnessWidget, 0);
    } else {
      setWidgetStringValue(edgeWidget, "soft");
      setWidgetValue(softnessWidget, (100 - hardness) / 100);
    }
  }
  if (st.drawOpacityInput) setWidgetValue(opacityWidget, Number(st.drawOpacityInput.value) / 100);
  if (st.drawSizeInput) setWidgetValue(sizeWidget, Number(st.drawSizeInput.value));
  if (st.drawWidthInput && !inputConnected) setWidgetValue(widthWidget, Number(st.drawWidthInput.value));
  if (st.drawHeightInput && !inputConnected) setWidgetValue(heightWidget, Number(st.drawHeightInput.value));
  if (st.drawPressureSizeInput) setWidgetBooleanValue(pressureSizeWidget, st.drawPressureSizeInput.checked);
  if (st.drawPressureOpacityInput) setWidgetBooleanValue(pressureOpacityWidget, st.drawPressureOpacityInput.checked);
  if (st.drawTiltSizeInput) setWidgetBooleanValue(tiltSizeWidget, st.drawTiltSizeInput.checked);
  if (st.drawOverlayFormatSelect) setWidgetStringValue(overlayFormatWidget, st.drawOverlayFormatSelect.value);
  updateDrawToolButtons(node);
}
export {
  NODE_CLASS,
  canvasToDrawSourcePoint,
  createDrawControlsUi,
  getDrawInfoText,
  hideDrawWidgets,
  isNode,
  styleSegmentButton,
  syncDrawWidgets,
  updateDrawOverlayWidget,
  updateDrawToolButtons
};
