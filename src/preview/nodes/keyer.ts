import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { createColorSwatch, styleSoftButton, styleSoftRange, syncDarkColorInputUI } from "../shared/dom-styles.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, setWidgetBooleanValue, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsKeyer";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export type KeyerControlsUi = {
  controls: HTMLDivElement;
  modeButtons: HTMLButtonElement[];
  invertButton: HTMLButtonElement;
  invertMaskButton: HTMLButtonElement;
  bypassButton: HTMLButtonElement;
  pickButton: HTMLButtonElement;
  colorInput: HTMLInputElement;
  toleranceInput: HTMLInputElement;
  softnessInput: HTMLInputElement;
  gainInput: HTMLInputElement;
  blurInput: HTMLInputElement;
};

export function createKeyerControlsUi(): KeyerControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const modeButtons: HTMLButtonElement[] = [];

  const topRow = document.createElement("div");
  topRow.style.display = "grid";
  topRow.style.gridTemplateColumns = "repeat(2, minmax(0,1fr))";
  topRow.style.gap = "4px";
  for (const [value, label] of [["color", "Color"], ["luma", "Luma"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.keyerMode = value;
    styleSoftButton(button, value === "color");
    topRow.appendChild(button);
    modeButtons.push(button);
  }
  controls.appendChild(topRow);

  const actionRow = document.createElement("div");
  actionRow.style.display = "grid";
  actionRow.style.gridTemplateColumns = "minmax(0,1fr) auto auto auto auto";
  actionRow.style.gap = "6px";
  const keyerColorSwatch = createColorSwatch("#00ff00", { title: "Key color" });
  const colorInput = keyerColorSwatch.input;

  const invertButton = document.createElement("button");
  invertButton.type = "button";
  invertButton.textContent = "Invert off";
  styleSoftButton(invertButton, false);

  const invertMaskButton = document.createElement("button");
  invertMaskButton.type = "button";
  invertMaskButton.textContent = "Inv mask off";
  styleSoftButton(invertMaskButton, false);

  const pickButton = document.createElement("button");
  pickButton.type = "button";
  pickButton.textContent = "Pick";
  styleSoftButton(pickButton, false);

  const bypassButton = document.createElement("button");
  bypassButton.type = "button";
  bypassButton.textContent = "Bypass off";
  styleSoftButton(bypassButton, false);

  actionRow.appendChild(keyerColorSwatch.host);
  actionRow.appendChild(pickButton);
  actionRow.appendChild(invertButton);
  actionRow.appendChild(invertMaskButton);
  actionRow.appendChild(bypassButton);
  controls.appendChild(actionRow);

  const makeRange = (
    labelText: string,
    min: number,
    max: number,
    step: number,
    value: number,
    accent = "",
  ): [HTMLDivElement, HTMLInputElement] => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "54px minmax(0,1fr) 38px";
    row.style.gap = "7px";
    row.style.alignItems = "center";

    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = "11px";
    label.style.opacity = "0.78";

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    input.title = labelText;
    styleSoftRange(input);
    if (accent) input.style.accentColor = accent;

    const valueLabel = document.createElement("div");
    valueLabel.dataset.keyerValue = "1";
    valueLabel.textContent = String(value);
    valueLabel.style.fontSize = "11px";
    valueLabel.style.opacity = "0.84";
    valueLabel.style.textAlign = "right";

    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(valueLabel);
    return [row, input];
  };

  let row: HTMLDivElement;
  let toleranceInput: HTMLInputElement;
  let softnessInput: HTMLInputElement;
  let gainInput: HTMLInputElement;
  let blurInput: HTMLInputElement;
  [row, toleranceInput] = makeRange("Tol", 0, 1, 0.01, 0.25, "");
  controls.appendChild(row);
  [row, softnessInput] = makeRange("Soft", 0, 1, 0.01, 0.1, "");
  controls.appendChild(row);
  [row, gainInput] = makeRange("Gain", 0, 4, 0.01, 1, "");
  controls.appendChild(row);
  [row, blurInput] = makeRange("Blur", 0, 64, 0.1, 0, "");
  controls.appendChild(row);

  return {
    controls,
    modeButtons,
    invertButton,
    invertMaskButton,
    bypassButton,
    pickButton,
    colorInput,
    toleranceInput,
    softnessInput,
    gainInput,
    blurInput,
  };
}

const KEYER_WIDGETS = [
  "bypass",
  "mode",
  "key_color",
  "key_colors",
  "tolerance",
  "softness",
  "gain",
  "blur",
  "invert",
  "invert_mask",
];

function ensureKeyColorsWidget(node: ComfyNode) {
  let widget = findWidget(node, "key_colors");
  if (widget) return widget;

  const created = (node as any).addWidget?.("text", "key_colors", "", () => {}, { serialize: true });
  if (created) {
    created.value = created.value ?? "";
    created.serializeValue = created.serializeValue ?? (() => created.value ?? "");
    hideWidgetForGood(node, created);
    return created;
  }

  const fallbackWidget = {
    name: "key_colors",
    type: "hidden",
    value: "",
    computeSize: () => [0, -4],
    serializeValue: () => fallbackWidget.value ?? "",
  } as any;
  node.widgets = node.widgets ?? [];
  node.widgets.push(fallbackWidget);
  hideWidgetForGood(node, fallbackWidget);
  return fallbackWidget;
}

function parseKeyColorSelection(node: ComfyNode): string[] {
  const raw = String((ensureKeyColorsWidget(node)?.value ?? widgetString(node, "key_colors", ""))).trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

function writeKeyColorSelection(node: ComfyNode, colors: string[]): void {
  const next = colors
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value, index, arr) => /^#[0-9a-f]{6}$/i.test(value) && arr.indexOf(value) === index);
  setWidgetStringValue(ensureKeyColorsWidget(node), JSON.stringify(next));
  if (next.length > 0) {
    setWidgetStringValuesByName(node, "key_color", next[next.length - 1]);
  }
}

function findClosestSelectionIndex(colors: string[], color: string): number {
  const target = hexToRgb(color);
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < colors.length; index += 1) {
    const current = hexToRgb(colors[index]);
    const distance = Math.hypot(target[0] - current[0], target[1] - current[1], target[2] - current[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function hexToRgb(color: string): [number, number, number] {
  const raw = String(color || "#00ff00").replace(/^#/, "");
  const full = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw.padEnd(6, "0").slice(0, 6);
  return [
    Number.parseInt(full.slice(0, 2), 16) || 0,
    Number.parseInt(full.slice(2, 4), 16) || 0,
    Number.parseInt(full.slice(4, 6), 16) || 0,
  ];
}

export function hideKeyerWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  ensureKeyColorsWidget(node);
  for (const name of KEYER_WIDGETS) hideWidgetsByName(node, name);
}

function setRange(input: HTMLInputElement | null, value: number): void {
  if (!input) return;
  input.value = String(Number.isFinite(value) ? value : 0);
  const label = input.parentElement?.querySelector("[data-keyer-value]") as HTMLDivElement | null;
  if (label) label.textContent = value.toFixed(2);
}

export function syncKeyerWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  ensureKeyColorsWidget(node);
  hideKeyerWidgets(node);
  const st = node.__imageops_state as any;
  if (!st?.keyerControls) return;

  const mode = widgetString(node, "mode", "color").toLowerCase();
  const keyColor = widgetString(node, "key_color", "#00ff00");
  const invert = widgetBoolean(node, "invert", false);
  const invertMask = widgetBoolean(node, "invert_mask", false);
  const bypass = widgetBoolean(node, "bypass", false);
  const picking = st.keyerPicking === true;
  const selectionCount = Math.max(1, parseKeyColorSelection(node).length || (keyColor ? 1 : 0));

  setWidgetStringValuesByName(node, "key_color", keyColor, { notify: false, dirty: false });

  for (const button of st.keyerModeButtons ?? []) {
    styleSoftButton(button, button.dataset.keyerMode === mode);
  }
  if (st.keyerColorInput) syncDarkColorInputUI(st.keyerColorInput, keyColor);
  setRange(st.keyerToleranceInput, widgetNumber(node, "tolerance", 0.25));
  setRange(st.keyerSoftnessInput, widgetNumber(node, "softness", 0.1));
  setRange(st.keyerGainInput, widgetNumber(node, "gain", 1.0));
  setRange(st.keyerBlurInput, widgetNumber(node, "blur", 0.0));

  if (st.keyerInvertButton) {
    st.keyerInvertButton.textContent = invert ? "Invert on" : "Invert off";
    styleSoftButton(st.keyerInvertButton, invert);
  }
  if (st.keyerInvertMaskButton) {
    st.keyerInvertMaskButton.textContent = invertMask ? "Inv mask on" : "Inv mask off";
    styleSoftButton(st.keyerInvertMaskButton, invertMask);
  }
  if (st.keyerBypassButton) {
    st.keyerBypassButton.textContent = bypass ? "Bypass on" : "Bypass off";
    styleSoftButton(st.keyerBypassButton, bypass);
  }
  if (st.keyerPickButton) {
    st.keyerPickButton.textContent = picking ? `Picking ${selectionCount}` : (selectionCount > 1 ? `Pick ${selectionCount}` : "Pick");
    styleSoftButton(st.keyerPickButton, picking);
  }
  if (st.canvas) st.canvas.style.cursor = picking ? "crosshair" : "";
}

function toHexByte(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function sampleCanvasColor(canvas: HTMLCanvasElement, event: PointerEvent): string | null {
  const point = getCanvasPointer(canvas, event);
  const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(point.x)));
  const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(point.y)));
  try {
    const pixel = canvas.getContext("2d")?.getImageData(x, y, 1, 1).data;
    if (!pixel) return null;
    return `#${toHexByte(pixel[0])}${toHexByte(pixel[1])}${toHexByte(pixel[2])}`;
  } catch {
    return null;
  }
}

function applyPickedColor(node: ComfyNode, sampledColor: string, event: PointerEvent): void {
  const current = parseKeyColorSelection(node);
  if (event.altKey) {
    if (current.length <= 1) return;
    const removeIndex = findClosestSelectionIndex(current, sampledColor);
    if (removeIndex < 0) return;
    current.splice(removeIndex, 1);
    writeKeyColorSelection(node, current);
    return;
  }

  if (event.ctrlKey || event.metaKey) {
    const next = current.length > 0 ? [...current] : [widgetString(node, "key_color", "#00ff00")];
    const normalized = sampledColor.toLowerCase();
    if (!next.includes(normalized)) next.push(normalized);
    writeKeyColorSelection(node, next);
    return;
  }

  writeKeyColorSelection(node, [sampledColor]);
}

export function attachKeyerControls(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  ensureKeyColorsWidget(node);
  const st = node.__imageops_state as any;
  if (!st?.keyerControls || st.keyerHooked) return;
  st.keyerHooked = true;

  const refresh = (): void => {
    syncKeyerWidgets(node);
    ctx.refreshNode(node);
  };
  const bindRange = (input: HTMLInputElement | null, widgetName: string): void => {
    input?.addEventListener("input", () => {
      setWidgetValue(findWidget(node, widgetName), Number(input.value));
      refresh();
    });
  };

  for (const button of st.keyerModeButtons ?? []) {
    button.addEventListener("click", () => {
      setWidgetStringValue(findWidget(node, "mode"), String(button.dataset.keyerMode ?? "color"));
      refresh();
    });
  }
  st.keyerColorInput?.addEventListener("input", () => {
    setWidgetStringValuesByName(node, "key_color", st.keyerColorInput.value);
    writeKeyColorSelection(node, [st.keyerColorInput.value]);
    refresh();
  });
  st.keyerPickButton?.addEventListener("click", () => {
    st.keyerPicking = !st.keyerPicking;
    syncKeyerWidgets(node);
  });
  st.canvas?.addEventListener("pointerdown", (event: PointerEvent) => {
    if (!st.keyerPicking || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const color = sampleCanvasColor(st.canvas, event);
    if (color) {
      applyPickedColor(node, color, event);
    }
    st.keyerPicking = !!(event.ctrlKey || event.metaKey || event.altKey);
    refresh();
  });
  st.keyerInvertButton?.addEventListener("click", () => {
    setWidgetBooleanValue(findWidget(node, "invert"), !widgetBoolean(node, "invert", false));
    refresh();
  });
  st.keyerInvertMaskButton?.addEventListener("click", () => {
    setWidgetBooleanValue(findWidget(node, "invert_mask"), !widgetBoolean(node, "invert_mask", false));
    refresh();
  });
  st.keyerBypassButton?.addEventListener("click", () => {
    setWidgetBooleanValue(findWidget(node, "bypass"), !widgetBoolean(node, "bypass", false));
    refresh();
  });

  bindRange(st.keyerToleranceInput, "tolerance");
  bindRange(st.keyerSoftnessInput, "softness");
  bindRange(st.keyerGainInput, "gain");
  bindRange(st.keyerBlurInput, "blur");
  syncKeyerWidgets(node);
}
