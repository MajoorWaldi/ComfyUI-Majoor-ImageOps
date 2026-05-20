import type { ComfyNode, RampHandle, RampPreviewGeometry } from "../../types.js";
import {
  createColorSwatch,
  createContextMenuSelect,
  setDarkColorInputState,
  styleSoftButton,
  styleSoftField,
  styleSoftRange,
  syncDarkColorInputUI,
} from "../shared/dom-styles.js";
import { resolveImageOpsClassName } from "../shared/classes.js";
import { ensureState } from "../shared/state.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, setWidgetStringValuesByName, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";

const RAMP_RATIO_PRESETS: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

function resolveRampRatioPreset(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  for (const [preset, presetRatio] of Object.entries(RAMP_RATIO_PRESETS)) {
    if (Math.abs(ratio - presetRatio) <= 0.02) return preset;
  }
  return "custom";
}

export const NODE_CLASS = "ImageOpsRamp";

export function isNode(node: ComfyNode): boolean {
  return resolveImageOpsClassName(node?.comfyClass) === NODE_CLASS;
}

export type RampControlsUi = {
  controls: HTMLDivElement;
};

export function createRampControlsUi(): RampControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const makeRow = (): HTMLDivElement => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    return row;
  };

  const makeLabel = (text: string): HTMLDivElement => {
    const label = document.createElement("div");
    label.textContent = text;
    label.style.fontSize = "11px";
    label.style.opacity = "0.78";
    return label;
  };

  const makeNumberInput = (
    field: string,
    options: { min: number; max: number; step: number; width?: string; title: string },
  ): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "number";
    input.dataset.rampField = field;
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.title = options.title;
    input.style.width = options.width ?? "100%";
    input.style.minWidth = "0";
    input.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
    styleSoftField(input);
    return input;
  };

  const topRow = makeRow();
  topRow.style.gridTemplateColumns = "auto minmax(0,1fr) minmax(0,1fr) auto";
  topRow.appendChild(makeLabel("Style"));

  const shapeSelect = document.createElement("select");
  shapeSelect.dataset.rampSelect = "shape";
  shapeSelect.title = "Ramp shape";
  shapeSelect.style.width = "100%";
  shapeSelect.style.minWidth = "0";
  styleSoftField(shapeSelect);
  for (const [value, label] of [["linear", "Linear"], ["radial", "Radial"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    shapeSelect.appendChild(option);
  }
  topRow.appendChild(createContextMenuSelect(shapeSelect));

  const modeSelect = document.createElement("select");
  modeSelect.dataset.rampSelect = "mode";
  modeSelect.title = "Ramp curve";
  modeSelect.style.width = "100%";
  modeSelect.style.minWidth = "0";
  styleSoftField(modeSelect);
  for (const [value, label] of [["linear", "Linear"], ["ease_in", "Ease In"], ["ease_out", "Ease Out"], ["smoothstep", "Smooth"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  }
  topRow.appendChild(createContextMenuSelect(modeSelect));

  const invertButton = document.createElement("button");
  invertButton.type = "button";
  invertButton.dataset.rampToggle = "invert";
  invertButton.textContent = "Invert off";
  styleSoftButton(invertButton, false);
  topRow.appendChild(invertButton);
  controls.appendChild(topRow);

  const sizeRow = makeRow();
  sizeRow.style.gridTemplateColumns = "auto minmax(70px,96px)";
  sizeRow.appendChild(makeLabel("Ratio"));
  const ratioSelect = document.createElement("select");
  ratioSelect.dataset.rampRatio = "1";
  ratioSelect.title = "Standard ratio or Free";
  ratioSelect.style.width = "100%";
  ratioSelect.style.minWidth = "0";
  styleSoftField(ratioSelect);
  for (const [value, label] of [["custom", "Free"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    ratioSelect.appendChild(option);
  }
  sizeRow.appendChild(createContextMenuSelect(ratioSelect));
  controls.appendChild(sizeRow);

  const colorsRow = makeRow();
  colorsRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto minmax(0,1fr)";
  colorsRow.appendChild(makeLabel("Color A"));
  const colorA = createColorSwatch("#ffffff");
  colorA.input.dataset.rampColor = "a";
  colorsRow.appendChild(colorA.host);
  colorsRow.appendChild(makeLabel("Color B"));
  const colorB = createColorSwatch("#000000");
  colorB.input.dataset.rampColor = "b";
  colorsRow.appendChild(colorB.host);
  controls.appendChild(colorsRow);

  const alphaRow = makeRow();
  alphaRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto";
  alphaRow.appendChild(makeLabel("Alpha"));
  const alphaInput = document.createElement("input");
  alphaInput.type = "range";
  alphaInput.dataset.rampField = "alpha";
  alphaInput.min = "0";
  alphaInput.max = "100";
  alphaInput.step = "1";
  alphaInput.value = "100";
  alphaInput.title = "Opacity";
  styleSoftRange(alphaInput);
  alphaRow.appendChild(alphaInput);
  const alphaValue = document.createElement("div");
  alphaValue.dataset.rampAlphaLabel = "1";
  alphaValue.textContent = "100%";
  alphaValue.style.fontSize = "11px";
  alphaValue.style.opacity = "0.84";
  alphaValue.style.textAlign = "right";
  alphaRow.appendChild(alphaValue);
  controls.appendChild(alphaRow);

  const pointsRow = makeRow();
  pointsRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto minmax(0,1fr)";
  pointsRow.appendChild(makeLabel("Start X"));
  pointsRow.appendChild(makeNumberInput("start_x", { min: -2, max: 3, step: 0.001, title: "Start X" }));
  pointsRow.appendChild(makeLabel("Start Y"));
  pointsRow.appendChild(makeNumberInput("start_y", { min: -2, max: 3, step: 0.001, title: "Start Y" }));
  pointsRow.appendChild(makeLabel("End X"));
  pointsRow.appendChild(makeNumberInput("end_x", { min: -2, max: 3, step: 0.001, title: "End X" }));
  pointsRow.appendChild(makeLabel("End Y"));
  pointsRow.appendChild(makeNumberInput("end_y", { min: -2, max: 3, step: 0.001, title: "End Y" }));
  controls.appendChild(pointsRow);

  return { controls };
}

export function hideRampWidgets(node: ComfyNode): void {
  for (const name of [
    "color_a",
    "color_b",
    "alpha",
    "frame_length",
    "batch_size",
    "start_x",
    "start_y",
    "end_x",
    "end_y",
    "ramp_shape",
    "ramp_mode",
    "invert",
  ]) {
    hideWidgetsByName(node, name);
  }
}

export function getRampInfoText(node: ComfyNode): string {
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const frameCount = Math.max(1, Math.round(widgetNumber(node, "frame_count", widgetNumber(node, "frame_length", widgetNumber(node, "batch_size", 1)))));
  const shape = widgetString(node, "ramp_shape", "linear");
  return `Ramp preview (${shape}, ${width}x${height}, frames ${frameCount})`;
}

export function rampCanvasPoint(geometry: RampPreviewGeometry, xNorm: number, yNorm: number): { x: number; y: number } {
  return {
    x: geometry.fitDx + xNorm * geometry.fitDrawWidth,
    y: geometry.fitDy + yNorm * geometry.fitDrawHeight,
  };
}

export function rampControlPoints(node: ComfyNode, geometry: RampPreviewGeometry): Record<RampHandle, { x: number; y: number }> {
  return {
    start: rampCanvasPoint(geometry, widgetNumber(node, "start_x", 0), widgetNumber(node, "start_y", 0.5)),
    end: rampCanvasPoint(geometry, widgetNumber(node, "end_x", 1), widgetNumber(node, "end_y", 0.5)),
  };
}

export function getRampHit(node: ComfyNode, geometry: RampPreviewGeometry | null, x: number, y: number): RampHandle | null {
  if (!geometry) return null;
  const points = rampControlPoints(node, geometry);
  const threshold = 14;
  for (const key of ["start", "end"] as RampHandle[]) {
    const point = points[key];
    const dx = x - point.x;
    const dy = y - point.y;
    if (dx * dx + dy * dy <= threshold * threshold) return key;
  }
  return null;
}

export function rampCanvasToNormalized(geometry: RampPreviewGeometry, x: number, y: number): { xNorm: number; yNorm: number } {
  return {
    xNorm: Math.max(-2, Math.min(3, (x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth))),
    yNorm: Math.max(-2, Math.min(3, (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight))),
  };
}

export function setRampHandle(node: ComfyNode, handle: RampHandle, xNorm: number, yNorm: number, notify: boolean = true): void {
  if (handle === "start") {
    setWidgetValue(findWidget(node, "start_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "start_y"), yNorm, { notify });
  } else {
    setWidgetValue(findWidget(node, "end_x"), xNorm, { notify });
    setWidgetValue(findWidget(node, "end_y"), yNorm, { notify });
  }
}

export function syncRampWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;

  hideRampWidgets(node);

  const colorA = widgetString(node, "color_a", "#ffffff");
  const colorB = widgetString(node, "color_b", "#000000");
  setWidgetStringValuesByName(node, "color_a", colorA, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "color_b", colorB, { notify: false, dirty: false });

  const st = ensureState(node);
  const root = st.previewRoot;
  if (!root) return;

  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const frameCount = Math.max(1, Math.round(widgetNumber(node, "frame_count", widgetNumber(node, "frame_length", widgetNumber(node, "batch_size", 1)))));
  const alpha = Math.max(0, Math.min(1, widgetNumber(node, "alpha", 1)));
  const startX = widgetNumber(node, "start_x", 0);
  const startY = widgetNumber(node, "start_y", 0.5);
  const endX = widgetNumber(node, "end_x", 1);
  const endY = widgetNumber(node, "end_y", 0.5);
  const shape = widgetString(node, "ramp_shape", "linear");
  const mode = widgetString(node, "ramp_mode", "linear");
  const invert = widgetBoolean(node, "invert", false);

  const setNumberField = (name: string, value: number): void => {
    const input = root.querySelector<HTMLInputElement>(`input[data-ramp-field="${name}"]`);
    if (input) input.value = String(value);
  };

  setNumberField("width", width);
  setNumberField("height", height);
  setNumberField("frame_count", frameCount);
  setNumberField("frame_length", frameCount);
  setNumberField("batch_size", frameCount);
  setNumberField("start_x", startX);
  setNumberField("start_y", startY);
  setNumberField("end_x", endX);
  setNumberField("end_y", endY);

  const ratioSelect = root.querySelector<HTMLSelectElement>('select[data-ramp-ratio="1"]');
  if (ratioSelect) ratioSelect.value = resolveRampRatioPreset(width, height);

  const alphaInput = root.querySelector<HTMLInputElement>('input[data-ramp-field="alpha"]');
  if (alphaInput) alphaInput.value = String(Math.round(alpha * 100));

  const alphaLabel = root.querySelector<HTMLElement>('[data-ramp-alpha-label]');
  if (alphaLabel) alphaLabel.textContent = `${Math.round(alpha * 100)}%`;

  const colorAInput = root.querySelector<HTMLInputElement>('input[data-ramp-color="a"]');
  if (colorAInput) {
    colorAInput.value = colorA;
    syncDarkColorInputUI(colorAInput, colorA);
  }

  const colorBInput = root.querySelector<HTMLInputElement>('input[data-ramp-color="b"]');
  if (colorBInput) {
    colorBInput.value = colorB;
    syncDarkColorInputUI(colorBInput, colorB);
  }

  const shapeSelect = root.querySelector<HTMLSelectElement>('select[data-ramp-select="shape"]');
  if (shapeSelect) shapeSelect.value = shape;

  const modeSelect = root.querySelector<HTMLSelectElement>('select[data-ramp-select="mode"]');
  if (modeSelect) modeSelect.value = mode;

  const invertButton = root.querySelector<HTMLButtonElement>('button[data-ramp-toggle="invert"]');
  if (invertButton) {
    invertButton.textContent = invert ? "Invert on" : "Invert off";
    styleSoftButton(invertButton, invert);
  }

  setDarkColorInputState(colorAInput, false, false);
  setDarkColorInputState(colorBInput, false, false);
}
