import type { ComfyNode } from "../../types.js";
import {
  createColorSwatch,
  createContextMenuSelect,
  setDarkColorInputState,
  styleSoftButton,
  styleSoftField,
  styleSoftRange,
  syncDarkColorInputUI,
} from "../shared/dom-styles.js";
import { ensureState } from "../shared/state.js";
import { findWidget, hideWidgetForGood, hideWidgetsByName, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
import { startEyedropper } from "../shared/eyedropper.js";

export const NODE_CLASS = "ImageOpsText";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export type TextControlsUi = {
  controls: HTMLDivElement;
};

export function createTextControlsUi(): TextControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const makeEyedropperButton = (getInput: () => HTMLInputElement): HTMLButtonElement => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "\uD83D\uDCA7";
    btn.title = "Pick color from a preview";
    btn.style.cssText = "background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = getInput();
      startEyedropper({
        onPick: (hex) => {
          input.value = hex;
          try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
          try { input.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
        },
      });
    });
    return btn;
  };

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
    options: { min: number; max?: number; step: number; width?: string; title: string },
  ): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "number";
    input.dataset.textField = field;
    input.min = String(options.min);
    if (typeof options.max === "number") input.max = String(options.max);
    input.step = String(options.step);
    input.title = options.title;
    input.style.width = options.width ?? "100%";
    input.style.minWidth = "0";
    input.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
    styleSoftField(input);
    return input;
  };

  const topRow = makeRow();
  topRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto minmax(0,1fr)";
  topRow.appendChild(makeLabel("Align"));
  const alignSelect = document.createElement("select");
  alignSelect.dataset.textSelect = "align";
  alignSelect.title = "Text alignment";
  alignSelect.style.width = "100%";
  alignSelect.style.minWidth = "0";
  styleSoftField(alignSelect);
  for (const [value, label] of [["left", "Left"], ["center", "Center"], ["right", "Right"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    alignSelect.appendChild(option);
  }
  topRow.appendChild(createContextMenuSelect(alignSelect));
  controls.appendChild(topRow);

  const posRow = makeRow();
  posRow.style.gridTemplateColumns = "auto minmax(0,1fr)";
  posRow.appendChild(makeLabel("X/Y"));
  const posWrap = document.createElement("div");
  posWrap.style.display = "flex";
  posWrap.style.gap = "6px";
  posWrap.style.alignItems = "center";
  posWrap.style.minWidth = "0";
  posWrap.appendChild(makeNumberInput("x", { min: -2, max: 3, step: 0.001, title: "Normalized X" }));
  posWrap.appendChild(makeNumberInput("y", { min: -2, max: 3, step: 0.001, title: "Normalized Y" }));
  posRow.appendChild(posWrap);
  controls.appendChild(posRow);

  const styleRow = makeRow();
  styleRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto";
  styleRow.appendChild(makeLabel("Opacity"));
  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.dataset.textField = "opacity";
  opacityInput.min = "0";
  opacityInput.max = "100";
  opacityInput.step = "1";
  opacityInput.value = "100";
  opacityInput.title = "Text opacity";
  styleSoftRange(opacityInput);
  styleRow.appendChild(opacityInput);
  const opacityLabel = document.createElement("div");
  opacityLabel.dataset.textOpacityLabel = "1";
  opacityLabel.textContent = "100%";
  opacityLabel.style.fontSize = "11px";
  opacityLabel.style.opacity = "0.84";
  opacityLabel.style.textAlign = "right";
  styleRow.appendChild(opacityLabel);
  controls.appendChild(styleRow);

  const colorsRow = makeRow();
  colorsRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto minmax(0,1fr)";
  colorsRow.appendChild(makeLabel("Fill"));
  const fillColor = createColorSwatch("#ffffff");
  fillColor.input.dataset.textColor = "fill";
  const fillWrap = document.createElement("div");
  fillWrap.style.cssText = "display:flex;gap:4px;align-items:center;min-width:0";
  fillWrap.appendChild(fillColor.host);
  const fillEye = makeEyedropperButton(() => fillColor.input);
  fillWrap.appendChild(fillEye);
  colorsRow.appendChild(fillWrap);
  colorsRow.appendChild(makeLabel("Stroke"));
  const strokeColor = createColorSwatch("#000000");
  strokeColor.input.dataset.textColor = "stroke";
  const strokeWrap = document.createElement("div");
  strokeWrap.style.cssText = "display:flex;gap:4px;align-items:center;min-width:0";
  strokeWrap.appendChild(strokeColor.host);
  const strokeEye = makeEyedropperButton(() => strokeColor.input);
  strokeWrap.appendChild(strokeEye);
  colorsRow.appendChild(strokeWrap);
  controls.appendChild(colorsRow);

  const bottomRow = makeRow();
  bottomRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto auto auto";
  bottomRow.appendChild(makeLabel("Font"));
  const fontPathInput = document.createElement("input");
  fontPathInput.type = "text";
  fontPathInput.dataset.textField = "font_path";
  fontPathInput.placeholder = "Optional font path";
  fontPathInput.title = "Optional font path";
  fontPathInput.style.width = "100%";
  fontPathInput.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
  styleSoftField(fontPathInput);
  bottomRow.appendChild(fontPathInput);

  const invertButton = document.createElement("button");
  invertButton.type = "button";
  invertButton.dataset.textToggle = "invert_mask";
  invertButton.textContent = "Invert mask off";
  styleSoftButton(invertButton, false);
  bottomRow.appendChild(invertButton);

  const bypassButton = document.createElement("button");
  bypassButton.type = "button";
  bypassButton.dataset.textToggle = "bypass";
  bypassButton.textContent = "Bypass off";
  styleSoftButton(bypassButton, false);
  bottomRow.appendChild(bypassButton);

  const hint = document.createElement("div");
  hint.textContent = "X/Y are normalized from -2 to 3.";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.64";
  bottomRow.appendChild(hint);
  controls.appendChild(bottomRow);

  return { controls };
}

const TEXT_ALIGN_OPTIONS = new Set(["left", "center", "right"]);

export function hideTextWidgets(node: ComfyNode): void {
  for (const name of [
    "bypass",
    "x",
    "y",
    "color",
    "opacity",
    "align",
    "stroke_color",
    "invert_mask",
    "font_path",
  ]) {
    hideWidgetsByName(node, name);
  }
}

export function getTextInfoText(node: ComfyNode): string {
  const text = String(widgetString(node, "text", "ImageOps Text") || "");
  const lineCount = Math.max(1, text.split(/\r?\n/).length);
  const fontSize = Math.max(1, Math.round(widgetNumber(node, "font_size", 64)));
  const align = widgetString(node, "align", "center");
  const opacity = Math.round(Math.max(0, Math.min(1, widgetNumber(node, "opacity", 1))) * 100);
  const bypass = widgetBoolean(node, "bypass", false) ? ", bypass" : "";
  return `Text preview (${lineCount} line${lineCount === 1 ? "" : "s"}, ${fontSize}px, ${align}, ${opacity}%${bypass})`;
}

export function syncTextWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;

  const st = ensureState(node);
  const root = st.previewRoot;
  if (!root) return;

  const text = widgetString(node, "text", "ImageOps Text");
  const x = widgetNumber(node, "x", 0.5);
  const y = widgetNumber(node, "y", 0.5);
  const fontSize = Math.max(1, Math.round(widgetNumber(node, "font_size", 64)));
  const opacity = Math.max(0, Math.min(1, widgetNumber(node, "opacity", 1)));
  const alignRaw = widgetString(node, "align", "center").toLowerCase();
  const align = TEXT_ALIGN_OPTIONS.has(alignRaw) ? alignRaw : "center";
  const lineSpacing = Math.max(0, Math.round(widgetNumber(node, "line_spacing", 4)));
  const strokeWidth = Math.max(0, Math.round(widgetNumber(node, "stroke_width", 0)));
  const color = widgetString(node, "color", "#ffffff");
  const strokeColor = widgetString(node, "stroke_color", "#000000");
  const invertMask = widgetBoolean(node, "invert_mask", false);
  const bypass = widgetBoolean(node, "bypass", false);
  const fontPath = widgetString(node, "font_path", "");

  const setNumberField = (name: string, value: number): void => {
    const input = root.querySelector<HTMLInputElement>(`input[data-text-field="${name}"]`);
    if (input) input.value = String(value);
  };

  setNumberField("x", x);
  setNumberField("y", y);
  setNumberField("font_size", fontSize);
  setNumberField("line_spacing", lineSpacing);
  setNumberField("stroke_width", strokeWidth);

  const fontPathInput = root.querySelector<HTMLInputElement>('input[data-text-field="font_path"]');
  if (fontPathInput && fontPathInput.value !== fontPath) fontPathInput.value = fontPath;

  const opacityInput = root.querySelector<HTMLInputElement>('input[data-text-field="opacity"]');
  if (opacityInput) opacityInput.value = String(Math.round(opacity * 100));

  const opacityLabel = root.querySelector<HTMLElement>('[data-text-opacity-label]');
  if (opacityLabel) opacityLabel.textContent = `${Math.round(opacity * 100)}%`;

  const alignSelect = root.querySelector<HTMLSelectElement>('select[data-text-select="align"]');
  if (alignSelect) alignSelect.value = align;

  const colorInput = root.querySelector<HTMLInputElement>('input[data-text-color="fill"]');
  if (colorInput) {
    colorInput.value = color;
    syncDarkColorInputUI(colorInput, color);
  }

  const strokeColorInput = root.querySelector<HTMLInputElement>('input[data-text-color="stroke"]');
  if (strokeColorInput) {
    strokeColorInput.value = strokeColor;
    syncDarkColorInputUI(strokeColorInput, strokeColor);
  }

  const invertButton = root.querySelector<HTMLButtonElement>('button[data-text-toggle="invert_mask"]');
  if (invertButton) {
    invertButton.textContent = invertMask ? "Invert mask on" : "Invert mask off";
    styleSoftButton(invertButton, invertMask);
  }

  const bypassButton = root.querySelector<HTMLButtonElement>('button[data-text-toggle="bypass"]');
  if (bypassButton) {
    bypassButton.textContent = bypass ? "Bypass on" : "Bypass off";
    styleSoftButton(bypassButton, bypass);
  }

  setDarkColorInputState(strokeColorInput, false, strokeWidth <= 0);
}

