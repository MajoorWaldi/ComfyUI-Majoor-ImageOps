import { COMP_BLEND_MODES, getCompSlots, serializeCompLayers, syncCompLayers, clampCompCenter } from "../comp.js";
import { getFitPlacement } from "../shared/geometry.js";
import { findWidget, hideWidgetForGood, setWidgetStringValue, widgetBoolean, widgetString, widgetNumber, setWidgetValue } from "../shared/widgets.js";
import { ensureState } from "../shared/state.js";
import { markCanvasDirty } from "../shared/canvas.js";
import {
  createContextMenuSelect,
  setControlDisabled,
  styleSoftButton,
  styleSoftField,
  styleSoftRange
} from "../shared/dom-styles.js";
import { syncDarkColorInputUI as syncDarkColorInputUI2, setDarkColorInputState as setDarkColorInputState2 } from "../shared/dom-styles.js";
const NODE_CLASS = "ImageOpsComp";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createCompControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gridTemplateColumns = "auto auto auto auto auto minmax(0, 1fr)";
  controls.style.gap = "6px";
  controls.style.alignItems = "center";
  controls.style.minWidth = "0";
  controls.style.width = "100%";
  controls.style.boxSizing = "border-box";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "+";
  addButton.title = "Add layer";
  styleSoftButton(addButton, false);
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Reset";
  styleSoftButton(resetButton, false);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "\u2212";
  removeButton.title = "Remove layer";
  styleSoftButton(removeButton, false);
  const resizeButton = document.createElement("button");
  resizeButton.type = "button";
  resizeButton.textContent = "Scale";
  styleSoftButton(resizeButton, true);
  const cornerPinButton = document.createElement("button");
  cornerPinButton.type = "button";
  cornerPinButton.textContent = "Pin";
  styleSoftButton(cornerPinButton, false);
  const layerLabel = document.createElement("div");
  layerLabel.style.fontSize = "11px";
  layerLabel.style.opacity = "0.85";
  layerLabel.style.justifySelf = "end";
  layerLabel.style.whiteSpace = "nowrap";
  layerLabel.textContent = "L1";
  const bottomRow = document.createElement("div");
  bottomRow.style.gridColumn = "1 / -1";
  bottomRow.style.display = "grid";
  bottomRow.style.gridTemplateColumns = "minmax(0,1fr) auto minmax(0,1.2fr)";
  bottomRow.style.gap = "6px";
  bottomRow.style.alignItems = "center";
  bottomRow.style.minWidth = "0";
  const modeSelect = document.createElement("select");
  modeSelect.style.width = "100%";
  styleSoftField(modeSelect);
  for (const mode of COMP_BLEND_MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode.replace("_", " ");
    modeSelect.appendChild(option);
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
  opacityInput.title = "Layer opacity";
  styleSoftRange(opacityInput);
  controls.appendChild(addButton);
  controls.appendChild(removeButton);
  controls.appendChild(resetButton);
  controls.appendChild(resizeButton);
  controls.appendChild(cornerPinButton);
  controls.appendChild(layerLabel);
  bottomRow.appendChild(createContextMenuSelect(modeSelect));
  bottomRow.appendChild(opacityLabel);
  bottomRow.appendChild(opacityInput);
  controls.appendChild(bottomRow);
  return {
    controls,
    addButton,
    removeButton,
    resetButton,
    resizeButton,
    cornerPinButton,
    aspectRatioSelect: null,
    modeSelect,
    opacityInput,
    opacityLabel,
    layerLabel
  };
}
function hideCompWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "layers_json"));
}
function aspectRatioValue(value) {
  switch (String(value || "custom").trim().toLowerCase()) {
    case "1/1":
    case "1:1":
      return 1;
    case "3/4":
    case "3:4":
      return 3 / 4;
    case "4/3":
    case "4:3":
      return 4 / 3;
    case "16/9":
    case "16:9":
      return 16 / 9;
    case "9/16":
    case "9:16":
      return 9 / 16;
    default:
      return null;
  }
}
function syncCompWidgets(node, changedName, notify = true) {
  if (!isNode(node)) return;
  if (widgetBoolean(node, "use_first_layer_size", true) || widgetBoolean(node, "auto_layering", false)) {
    return;
  }
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  if (!widthWidget || !heightWidget) return;
  const preset = widgetString(node, "aspect_ratio", "custom");
  if (preset === "custom") {
    return;
  }
  const ratio = aspectRatioValue(preset);
  if (!ratio) return;
  let width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  let height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  if (changedName === "height") {
    width = Math.max(1, Math.round(height * ratio));
    setWidgetValue(widthWidget, width, { notify });
  } else {
    height = Math.max(1, Math.round(width / ratio));
    setWidgetValue(heightWidget, height, { notify });
  }
  markCanvasDirty();
}
function ensureCompInputs(node, minLayers = 1) {
  if (!isNode(node) || !node.addInput) return;
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
function removeCompInputAt(node, inputIndex) {
  if (inputIndex < 0) return;
  if (typeof node.removeInput === "function") {
    node.removeInput(inputIndex);
    return;
  }
  if (Array.isArray(node.inputs)) {
    node.inputs.splice(inputIndex, 1);
  }
}
function isCompSlotLinked(node, slot) {
  const imageLinked = slot.inputIndex >= 0 && (node.inputs?.[slot.inputIndex]?.link ?? null) != null;
  const maskLinked = slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null;
  return imageLinked || maskLinked;
}
function removeSelectedCompLayer(node) {
  if (!isNode(node) || !Array.isArray(node.inputs)) return false;
  const st = ensureState(node);
  const slots = getCompSlots(node);
  if (slots.length <= 1) return false;
  const selectedSlot = st.compSelectedSlot ?? slots[slots.length - 1]?.slot ?? null;
  const selected = slots.find((slot) => slot.slot === selectedSlot) ?? slots[slots.length - 1] ?? null;
  if (!selected) return false;
  if (isCompSlotLinked(node, selected)) return false;
  const indexes = [selected.inputIndex, selected.maskInputIndex ?? -1].filter((index) => index >= 0).sort((a, b) => b - a);
  for (const index of indexes) {
    removeCompInputAt(node, index);
  }
  const layers = readCompLayers(node).filter((layer) => layer.slot !== selected.slot);
  writeCompLayers(node, layers);
  st.compSelectedSlot = layers[layers.length - 1]?.slot ?? null;
  return true;
}
function readCompLayers(node) {
  return syncCompLayers(findWidget(node, "layers_json")?.value ?? "", getCompSlots(node));
}
function writeCompLayers(node, layers, notify = true) {
  setWidgetStringValue(findWidget(node, "layers_json"), serializeCompLayers(layers), { notify });
}
function getCompInfoText(_node, connectedLayers, totalLayers, width, height) {
  return `Comp preview (${connectedLayers}/${totalLayers} layers, ${width}x${height})`;
}
function normalizeCompAspectRatioValue(value) {
  const normalized = String(value || "custom").trim().toLowerCase().replace(":", "/");
  return ["1/1", "3/4", "4/3", "16/9", "9/16"].includes(normalized) ? normalized : "custom";
}
function getCompCursor(mode) {
  switch (mode) {
    case "move":
      return "move";
    case "rotate":
      return "crosshair";
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
function cloneCompCorners(corners) {
  if (!corners) return null;
  return {
    tl: { ...corners.tl },
    tr: { ...corners.tr },
    bl: { ...corners.bl },
    br: { ...corners.br }
  };
}
function clearCompLayerCorners(layer) {
  layer.tlX = null;
  layer.tlY = null;
  layer.trX = null;
  layer.trY = null;
  layer.blX = null;
  layer.blY = null;
  layer.brX = null;
  layer.brY = null;
}
function compDragHandleToCorner(mode) {
  if (mode === "nw") return "tl";
  if (mode === "ne") return "tr";
  if (mode === "sw") return "bl";
  if (mode === "se") return "br";
  return null;
}
function pointInCompPolygon(point, corners) {
  let sign = 0;
  for (let index = 0; index < corners.length; index++) {
    const a = corners[index];
    const b = corners[(index + 1) % corners.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) <= 0.01) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (sign !== currentSign) {
      return false;
    }
  }
  return true;
}
function ensureCompState(node, notify = true) {
  ensureCompInputs(node, 1);
  const layers = readCompLayers(node);
  writeCompLayers(node, layers, notify);
  const st = ensureState(node);
  if (!st.compSelectedSlot || !layers.some((layer) => layer.slot === st.compSelectedSlot)) {
    st.compSelectedSlot = layers[layers.length - 1]?.slot ?? null;
  }
  return layers;
}
function updateCompControls(node) {
  const st = ensureState(node);
  const layers = ensureCompState(node);
  const selected = layers.find((layer) => layer.slot === st.compSelectedSlot) ?? layers[layers.length - 1] ?? null;
  const customFormat = !widgetBoolean(node, "use_first_layer_size", true) && !widgetBoolean(node, "auto_layering", false);
  if (st.compAspectRatioSelect) {
    st.compAspectRatioSelect.value = normalizeCompAspectRatioValue(widgetString(node, "aspect_ratio", "custom"));
    setControlDisabled(st.compAspectRatioSelect, !customFormat);
    st.compAspectRatioSelect.title = customFormat ? "Custom Format aspect ratio" : "Aspect ratio is only used when Custom Format is active";
  }
  const isPin = st.compEditMode === "cornerpin";
  if (st.compResizeButton) styleSoftButton(st.compResizeButton, !isPin);
  if (st.compCornerPinButton) styleSoftButton(st.compCornerPinButton, isPin);
  if (!selected) {
    if (st.compLayerLabel) st.compLayerLabel.textContent = "\u2014";
    setControlDisabled(st.compResetButton, true);
    setControlDisabled(st.compRemoveButton, true);
    setControlDisabled(st.compModeSelect, true);
    setControlDisabled(st.compOpacityInput, true);
    if (st.compOpacityLabel) st.compOpacityLabel.textContent = "0%";
    return;
  }
  st.compSelectedSlot = selected.slot;
  setControlDisabled(st.compResetButton, false);
  const selectedSlotInfo = getCompSlots(node).find((slot) => slot.slot === selected.slot) ?? null;
  setControlDisabled(st.compRemoveButton, layers.length <= 1 || (selectedSlotInfo ? isCompSlotLinked(node, selectedSlotInfo) : true));
  if (st.compLayerLabel) {
    const match = /_(\d+)$/.exec(selected.slot);
    st.compLayerLabel.textContent = `L${match?.[1] ?? "?"}`;
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
function updateSelectedCompLayer(node, updater, notify = true) {
  const st = ensureState(node);
  const layers = ensureCompState(node, notify);
  const index = layers.findIndex((layer) => layer.slot === st.compSelectedSlot);
  if (index < 0) return;
  updater(layers[index]);
  writeCompLayers(node, layers, notify);
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
    const metrics = getCompCanvasMetrics(layer, fit, st.compOutputWidth || 1, st.compOutputHeight || 1);
    const near = (px, py) => Math.abs(x - px) <= threshold && Math.abs(y - py) <= threshold;
    const handleDx = x - metrics.rotationHandle.x;
    const handleDy = y - metrics.rotationHandle.y;
    if (handleDx * handleDx + handleDy * handleDy <= metrics.handleRadius * metrics.handleRadius) return { layer, mode: "rotate" };
    if (near(metrics.topLeft.x, metrics.topLeft.y)) return { layer, mode: "nw" };
    if (near(metrics.topRight.x, metrics.topRight.y)) return { layer, mode: "ne" };
    if (near(metrics.bottomLeft.x, metrics.bottomLeft.y)) return { layer, mode: "sw" };
    if (near(metrics.bottomRight.x, metrics.bottomRight.y)) return { layer, mode: "se" };
    if (pointInCompPolygon({ x, y }, [metrics.topLeft, metrics.topRight, metrics.bottomRight, metrics.bottomLeft])) return { layer, mode: "move" };
  }
  return null;
}
function writeCompLayerCorners(node, layer, corners) {
  const st = ensureState(node);
  const maxX = Math.max(1, (st.compOutputWidth || 1) - 1);
  const maxY = Math.max(1, (st.compOutputHeight || 1) - 1);
  layer.tlX = clampCompCenter(corners.tl.x / maxX);
  layer.tlY = clampCompCenter(corners.tl.y / maxY);
  layer.trX = clampCompCenter(corners.tr.x / maxX);
  layer.trY = clampCompCenter(corners.tr.y / maxY);
  layer.blX = clampCompCenter(corners.bl.x / maxX);
  layer.blY = clampCompCenter(corners.bl.y / maxY);
  layer.brX = clampCompCenter(corners.br.x / maxX);
  layer.brY = clampCompCenter(corners.br.y / maxY);
  layer.centerX = clampCompCenter((corners.tl.x + corners.tr.x + corners.bl.x + corners.br.x) / 4 / Math.max(1, st.compOutputWidth || 1));
  layer.centerY = clampCompCenter((corners.tl.y + corners.tr.y + corners.bl.y + corners.br.y) / 4 / Math.max(1, st.compOutputHeight || 1));
}
function getCompCanvasMetrics(layer, fit, outputWidth, outputHeight) {
  const scaleX = fit.drawWidth / Math.max(1, outputWidth);
  const scaleY = fit.drawHeight / Math.max(1, outputHeight);
  const toCanvas = (point) => ({
    x: fit.dx + point.x * scaleX,
    y: fit.dy + point.y * scaleY
  });
  const topLeft = toCanvas(layer.corners?.tl ?? { x: layer.centerX - layer.drawWidth / 2, y: layer.centerY - layer.drawHeight / 2 });
  const topRight = toCanvas(layer.corners?.tr ?? { x: layer.centerX + layer.drawWidth / 2, y: layer.centerY - layer.drawHeight / 2 });
  const bottomLeft = toCanvas(layer.corners?.bl ?? { x: layer.centerX - layer.drawWidth / 2, y: layer.centerY + layer.drawHeight / 2 });
  const bottomRight = toCanvas(layer.corners?.br ?? { x: layer.centerX + layer.drawWidth / 2, y: layer.centerY + layer.drawHeight / 2 });
  const center = {
    x: (topLeft.x + topRight.x + bottomLeft.x + bottomRight.x) / 4,
    y: (topLeft.y + topRight.y + bottomLeft.y + bottomRight.y) / 4
  };
  const topMid = {
    x: (topLeft.x + topRight.x) / 2,
    y: (topLeft.y + topRight.y) / 2
  };
  const edgeX = topRight.x - topLeft.x;
  const edgeY = topRight.y - topLeft.y;
  const edgeLength = Math.max(1, Math.hypot(edgeX, edgeY));
  let normalX = -edgeY / edgeLength;
  let normalY = edgeX / edgeLength;
  const towardCenterX = center.x - topMid.x;
  const towardCenterY = center.y - topMid.y;
  if (normalX * towardCenterX + normalY * towardCenterY > 0) {
    normalX *= -1;
    normalY *= -1;
  }
  const handleDistance = Math.max(16, Math.min(28, edgeLength * 0.28));
  const rotationHandle = {
    x: topMid.x + normalX * handleDistance,
    y: topMid.y + normalY * handleDistance
  };
  return {
    center,
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
    topMid,
    rotationHandle,
    handleRadius: 10
  };
}
export {
  NODE_CLASS,
  clearCompLayerCorners,
  cloneCompCorners,
  compCanvasToOutputPoint,
  compDragHandleToCorner,
  createCompControlsUi,
  ensureCompInputs,
  ensureCompState,
  getCompCanvasMetrics,
  getCompCursor,
  getCompHit,
  getCompInfoText,
  hideCompWidgets,
  isNode,
  readCompLayers,
  removeSelectedCompLayer,
  setDarkColorInputState2 as setDarkColorInputState,
  syncCompWidgets,
  syncDarkColorInputUI2 as syncDarkColorInputUI,
  updateCompControls,
  updateSelectedCompLayer,
  writeCompLayerCorners,
  writeCompLayers
};
