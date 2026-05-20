import type { ComfyNode } from "../../types.js";
import { ensureState } from "../shared/state.js";
import { resolveImageOpsClassName } from "../shared/classes.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, setWidgetStringValuesByName, widgetNumber, widgetString } from "../shared/widgets.js";
import {
  createColorSwatch,
  createContextMenuSelect,
  setDarkColorInputState,
  styleSoftButton,
  styleSoftField,
  styleSoftRange,
  syncDarkColorInputUI,
} from "../shared/dom-styles.js";

const CONSTANT_RATIO_PRESETS: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

function resolveConstantRatioPreset(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  for (const [preset, presetRatio] of Object.entries(CONSTANT_RATIO_PRESETS)) {
    if (Math.abs(ratio - presetRatio) <= 0.02) return preset;
  }
  return "custom";
}

export const NODE_CLASS = "ImageOpsConstant";

export function isNode(node: ComfyNode): boolean {
  return resolveImageOpsClassName(node?.comfyClass) === NODE_CLASS;
}

export type ConstantControlsUi = {
  controls: HTMLDivElement;
};

export function createConstantControlsUi(): ConstantControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const makeRow = (): HTMLDivElement => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    row.style.minWidth = "0";
    return row;
  };

  const makeLabel = (text: string): HTMLDivElement => {
    const label = document.createElement("div");
    label.textContent = text;
    label.style.fontSize = "11px";
    label.style.opacity = "0.78";
    return label;
  };

  const modeRow = makeRow();
  modeRow.style.gridTemplateColumns = "auto auto minmax(0,1fr)";
  modeRow.appendChild(makeLabel("Mode"));
  for (const [value, label] of [["constant", "Solid"], ["checkerboard", "Checker"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.constantMode = value;
    styleSoftButton(button, value === "constant");
    modeRow.appendChild(button);
  }
  controls.appendChild(modeRow);

  const sizeRow = makeRow();
  sizeRow.style.gridTemplateColumns = "auto minmax(70px,96px)";
  sizeRow.appendChild(makeLabel("Ratio"));
  const ratioSelect = document.createElement("select");
  ratioSelect.dataset.constantRatio = "1";
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

  const alphaRow = makeRow();
  alphaRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto";
  alphaRow.appendChild(makeLabel("Alpha"));
  const alphaInput = document.createElement("input");
  alphaInput.type = "range";
  alphaInput.dataset.constantField = "alpha";
  alphaInput.min = "0";
  alphaInput.max = "100";
  alphaInput.step = "1";
  alphaInput.value = "100";
  alphaInput.title = "Opacity";
  styleSoftRange(alphaInput);
  alphaRow.appendChild(alphaInput);
  const alphaValue = document.createElement("div");
  alphaValue.dataset.constantAlphaLabel = "1";
  alphaValue.textContent = "100%";
  alphaValue.style.fontSize = "11px";
  alphaValue.style.opacity = "0.84";
  alphaValue.style.textAlign = "right";
  alphaRow.appendChild(alphaValue);
  controls.appendChild(alphaRow);

  const colorsRow = makeRow();
  colorsRow.style.gridTemplateColumns = "auto minmax(0,1fr) minmax(0,1fr)";
  colorsRow.appendChild(makeLabel("Colors"));
  const colorA = createColorSwatch("#ffffff");
  colorA.input.dataset.constantColor = "a";
  colorsRow.appendChild(colorA.host);
  const colorBWrap = document.createElement("div");
  colorBWrap.dataset.constantColorWrap = "b";
  colorBWrap.style.display = "grid";
  colorBWrap.style.gridTemplateColumns = "auto minmax(0,1fr)";
  colorBWrap.style.gap = "6px";
  colorBWrap.style.alignItems = "center";
  const colorBLabel = makeLabel("Alt");
  const colorB = createColorSwatch("#000000");
  colorB.input.dataset.constantColor = "b";
  colorBWrap.appendChild(colorBLabel);
  colorBWrap.appendChild(colorB.host);
  colorsRow.appendChild(colorBWrap);
  controls.appendChild(colorsRow);

  return { controls };
}

export function hideConstantWidgets(node: ComfyNode): void {
  // hideWidgetsByName covers ComfyUI's auto-added duplicates (e.g. an uppercase
  // COLOR widget paired with each `color` widget).
  for (const name of ["mode", "color", "color_b", "alpha", "frame_length", "batch_size"]) {
    hideWidgetsByName(node, name);
  }
}

export function getConstantInfoText(node: ComfyNode): string {
  const mode = widgetString(node, "mode", "constant").toLowerCase() === "checkerboard" ? "Checker" : "Solid";
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const frameCount = Math.max(1, Math.round(widgetNumber(node, "frame_count", widgetNumber(node, "frame_length", widgetNumber(node, "batch_size", 1)))));
  return `${mode} preview (${width}x${height}, frames ${frameCount})`;
}

export function syncConstantWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;

  hideConstantWidgets(node);

  const colorA = widgetString(node, "color", "#ffffff");
  const colorB = widgetString(node, "color_b", "#000000");
  setWidgetStringValuesByName(node, "color", colorA, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "color_b", colorB, { notify: false, dirty: false });

  const st = ensureState(node);
  const root = st.previewRoot;
  if (!root) return;

  const mode = widgetString(node, "mode", "constant").toLowerCase() === "checkerboard" ? "checkerboard" : "constant";
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  const height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
  const alpha = Math.max(0, Math.min(1, widgetNumber(node, "alpha", 1)));

  const ratioSelect = root.querySelector<HTMLSelectElement>('select[data-constant-ratio="1"]');
  if (ratioSelect) ratioSelect.value = resolveConstantRatioPreset(width, height);

  const alphaInput = root.querySelector<HTMLInputElement>('input[data-constant-field="alpha"]');
  if (alphaInput) alphaInput.value = String(Math.round(alpha * 100));

  const alphaLabel = root.querySelector<HTMLElement>('[data-constant-alpha-label]');
  if (alphaLabel) alphaLabel.textContent = `${Math.round(alpha * 100)}%`;

  const colorAInput = root.querySelector<HTMLInputElement>('input[data-constant-color="a"]');
  if (colorAInput) {
    colorAInput.value = colorA;
    syncDarkColorInputUI(colorAInput, colorA);
  }

  const colorBInput = root.querySelector<HTMLInputElement>('input[data-constant-color="b"]');
  if (colorBInput) {
    colorBInput.value = colorB;
    syncDarkColorInputUI(colorBInput, colorB);
  }

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-constant-mode]'))) {
    styleSoftButton(button, button.dataset.constantMode === mode);
  }

  const secondaryColorWrap = root.querySelector<HTMLElement>('[data-constant-color-wrap="b"]');
  if (secondaryColorWrap) secondaryColorWrap.style.display = mode === "checkerboard" ? "grid" : "none";
  setDarkColorInputState(colorBInput, false, mode !== "checkerboard");
}
