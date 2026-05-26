import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { createColorSwatch, styleSoftButton, styleSoftRange, syncDarkColorInputUI } from "../shared/dom-styles.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, setWidgetBooleanValue, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsKeyer";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

function styleSegmentControl(container: HTMLElement): void {
  container.style.display = "flex";
  container.style.background = "#181818";
  container.style.borderRadius = "6px";
  container.style.padding = "2px";
  container.style.border = "1px solid #2e2e2e";
  container.style.width = "100%";
  container.style.boxSizing = "border-box";
}

function styleSegmentButton(button: HTMLButtonElement, active: boolean): void {
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

function setupSegmentHover(button: HTMLButtonElement): void {
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

export type KeyerControlsUi = {
  controls: HTMLDivElement;
  modeButtons: HTMLButtonElement[];
  invertButton: HTMLButtonElement | null;
  invertMaskButton: HTMLButtonElement | null;
  bypassButton: HTMLButtonElement | null;
  pickButton: HTMLButtonElement;
  colorInput: HTMLInputElement | null;
  toleranceInput: HTMLInputElement | null;
  softnessInput: HTMLInputElement | null;
  gainInput: HTMLInputElement | null;
  blurInput: HTMLInputElement | null;
};

export function createKeyerControlsUi(): KeyerControlsUi {
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

  const styleLabel = (el: HTMLElement) => {
    el.style.fontSize = "11px";
    el.style.opacity = "0.78";
    el.style.fontFamily = "var(--comfy-font-sans, Inter, sans-serif)";
    el.style.whiteSpace = "nowrap";
  };

  const modeButtons: HTMLButtonElement[] = [];

  // Row 1: Mode Segment Control
  const modeLabel = document.createElement("div");
  modeLabel.textContent = "Mode";
  styleLabel(modeLabel);

  const modeGroup = document.createElement("div");
  styleSegmentControl(modeGroup);

  for (const [value, label] of [["color", "Color"], ["luma", "Luma"]] as const) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.keyerMode = value;
    styleSegmentButton(button, value === "color");
    setupSegmentHover(button);
    modeGroup.appendChild(button);
    modeButtons.push(button);
  }

  controls.appendChild(modeLabel);
  controls.appendChild(modeGroup);

  // Row 2: Sampling Control (Pick button only)
  const pickLabel = document.createElement("div");
  pickLabel.textContent = "Sampling";
  styleLabel(pickLabel);
  pickLabel.dataset.keyerPickerLabel = "1";

  const pickButton = document.createElement("button");
  pickButton.type = "button";
  pickButton.textContent = "Pick";
  styleSoftButton(pickButton, false);
  pickButton.style.width = "100%";

  const pickWrapper = document.createElement("div");
  pickWrapper.style.display = "flex";
  pickWrapper.style.width = "100%";
  pickWrapper.appendChild(pickButton);
  pickWrapper.dataset.keyerPickerWrapper = "1";

  controls.appendChild(pickLabel);
  controls.appendChild(pickWrapper);

  return {
    controls,
    modeButtons,
    invertButton: null,
    invertMaskButton: null,
    bypassButton: null,
    pickButton,
    colorInput: null,
    toleranceInput: null,
    softnessInput: null,
    gainInput: null,
    blurInput: null,
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
  
  // Hide internal storage and widgets rendered as custom HTML DOM elements
  const namesToHide = ["key_colors", "mode"];
  for (const name of namesToHide) {
    hideWidgetsByName(node, name);
  }


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
    styleSegmentButton(button, button.dataset.keyerMode === mode);
  }

  // Picker row visibility
  const pickLabel = st.previewRoot?.querySelector('[data-keyer-picker-label]') as HTMLElement | null;
  const pickWrapper = st.previewRoot?.querySelector('[data-keyer-picker-wrapper]') as HTMLElement | null;
  if (pickLabel && pickWrapper) {
    const show = mode === "color";
    pickLabel.style.display = show ? "" : "none";
    pickWrapper.style.display = show ? "" : "none";
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
    st.keyerInvertMaskButton.textContent = invertMask ? "Invert mask on" : "Invert mask off";
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
    const pixel = canvas.getContext("2d", { willReadFrequently: true })?.getImageData(x, y, 1, 1).data;
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
