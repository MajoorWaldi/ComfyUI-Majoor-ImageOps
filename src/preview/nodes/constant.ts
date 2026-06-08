import type { ComfyNode } from "../../types.js";
import { ensureState } from "../shared/state.js";
import { resolveImageOpsClassName } from "../shared/classes.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, setWidgetStringValuesByName, widgetNumber, widgetString, setWidgetValue } from "../shared/widgets.js";
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



  return { controls };
}

export function hideConstantWidgets(node: ComfyNode): void {
  // hideWidgetsByName covers ComfyUI's auto-added duplicates (e.g. an uppercase
  // COLOR widget paired with each `color` widget).
  for (const name of ["mode", "alpha", "frame_length", "batch_size"]) {
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

function aspectRatioValue(value: string): number | null {
  switch (String(value || "custom").trim().toLowerCase()) {
    case "1/1":
    case "1:1": return 1;
    case "3/4":
    case "3:4": return 3 / 4;
    case "4/3":
    case "4:3": return 4 / 3;
    case "16/9":
    case "16:9": return 16 / 9;
    case "9/16":
    case "9:16": return 9 / 16;
    default: return null;
  }
}

export function syncConstantWidgets(node: ComfyNode, changedName?: string, notify: boolean = true): void {
  if (!isNode(node)) return;

  hideConstantWidgets(node);

  const colorA = widgetString(node, "color", "#ffffff");
  const colorB = widgetString(node, "color_b", "#000000");
  setWidgetStringValuesByName(node, "color", colorA, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "color_b", colorB, { notify: false, dirty: false });

  const st = ensureState(node);
  const root = st.previewRoot;
  if (!root) return;

  // Bidirectional aspect ratio constraints
  const widthWidget = findWidget(node, "width");
  const heightWidget = findWidget(node, "height");
  if (widthWidget && heightWidget) {
    const preset = widgetString(node, "aspect_ratio", "custom");
    if (preset !== "custom") {
      const ratio = aspectRatioValue(preset);
      if (ratio) {
        let width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
        let height = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
        if (changedName === "height") {
          width = Math.max(1, Math.round(height * ratio));
          setWidgetValue(widthWidget, width, { notify });
        } else {
          height = Math.max(1, Math.round(width / ratio));
          setWidgetValue(heightWidget, height, { notify });
        }
      }
    }
  }

  const mode = widgetString(node, "mode", "constant").toLowerCase() === "checkerboard" ? "checkerboard" : "constant";
  const alpha = Math.max(0, Math.min(1, widgetNumber(node, "alpha", 1)));

  const alphaInput = root.querySelector<HTMLInputElement>('input[data-constant-field="alpha"]');
  if (alphaInput) alphaInput.value = String(Math.round(alpha * 100));

  const alphaLabel = root.querySelector<HTMLElement>('[data-constant-alpha-label]');
  if (alphaLabel) alphaLabel.textContent = `${Math.round(alpha * 100)}%`;

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-constant-mode]'))) {
    styleSoftButton(button, button.dataset.constantMode === mode);
  }
}
