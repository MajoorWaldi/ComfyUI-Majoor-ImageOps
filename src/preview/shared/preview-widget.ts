import type { ComfyNode, ComfyWidget, NodeState, ProgressBus } from "../../types.js";
import { ensureState } from "./state.js";
import { isImageOpsClass, isImageOpsNativeUiClass } from "./classes.js";
import { createPreviewControlsUi, isNode as isPreviewNode } from "../nodes/preview.js";
import { createConstantControlsUi, isNode as isConstantNode } from "../nodes/constant.js";
import { createGrainControlsUi, isNode as isGrainNode } from "../nodes/grain.js";
import { createRampControlsUi, isNode as isRampNode } from "../nodes/ramp.js";
import { createTextControlsUi, isNode as isTextNode } from "../nodes/text.js";
import { createColorCorrectControlsUi, isNode as isColorCorrectNode } from "../nodes/color-correct.js";
import { createCropResetButton, isNode as isCropNode } from "../nodes/crop.js";
import { createDrawControlsUi, isNode as isDrawNode } from "../nodes/draw.js";
import { createCompControlsUi, isNode as isCompNode } from "../nodes/comp.js";
import { createJoinControlsUi, isNode as isAppendNode } from "../nodes/append.js";
import { createFrameSelectorControlsUi, isNode as isFrameRangeNode } from "../nodes/frame-range.js";
import { createKeyerControlsUi, isNode as isKeyerNode } from "../nodes/keyer.js";
import { createPadOutControlsUi, isNode as isPadOutNode } from "../nodes/pad-out.js";
import { styleSoftButton, styleSoftField, styleSoftRange, styleInlineAction, createColorSwatch, createContextMenuSelect, syncDarkColorInputUI } from "./dom-styles.js";
import { getWidgetInputSpec, listCompactUiWidgets, setWidgetMixedValue } from "./widgets.js";
import { bindCollapsibleToUiState } from "./ui-persist.js";
import { attachDblClickReset } from "./dbl-click-reset.js";

type CompactWidgetBinding = {
  widget: ComfyWidget;
  kind: "boolean" | "select" | "number" | "text" | "color";
  control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
  integer: boolean;
};

export function getNodePreviewMinHeight(node: ComfyNode): number {
  if (isDrawNode(node)) return 220;
  if (isConstantNode(node)) return 390;
  if (isGrainNode(node)) return 390;
  if (isTextNode(node)) return 470;
  if (isRampNode(node)) return 430;
  if (isColorCorrectNode(node)) return 490;
  if (isCompNode(node)) return 400;
  if (isAppendNode(node)) return 430;
  if (isPreviewNode(node)) return 360;
  if (isFrameRangeNode(node)) return 390;
  if (isKeyerNode(node)) return 420;
  if (isPadOutNode(node)) return 430;
  return 320;
}

function getMeasuredBlockHeight(element: HTMLElement | null | undefined, extra: number = 0): number {
  if (!element || element.style.display === "none") return 0;
  return Math.max(element.offsetHeight ?? 0, element.scrollHeight ?? 0) + extra;
}

function getCanvasDisplayHeight(canvas: HTMLCanvasElement | null | undefined, container: HTMLElement | null): number {
  if (!canvas) return 0;
  const offsetHeight = canvas.offsetHeight ?? 0;
  if (offsetHeight > 0) return offsetHeight;

  const aspectWidth = Math.max(1, Math.round(canvas.width || 1));
  const aspectHeight = Math.max(1, Math.round(canvas.height || 1));
  const innerWidth = Math.max(0, Math.round((container?.clientWidth ?? container?.offsetWidth ?? 0) - 12));
  if (innerWidth <= 0) return 0;
  return Math.round((innerWidth * aspectHeight) / aspectWidth);
}

function getNodeSizeSnapshot(node: ComfyNode, fallbackHeight?: number): [number, number] {
  const rawSize = (node as any).size;
  const width = Number(rawSize?.[0]);
  const height = Number(rawSize?.[1]);
  return [
    Number.isFinite(width) && width > 0 ? width : 360,
    Number.isFinite(height) && height > 0 ? height : Math.max(320, Math.round(fallbackHeight ?? getNodePreviewMinHeight(node))),
  ];
}

function getNodePreviewContentHeight(node: ComfyNode, root: HTMLElement | null): number {
  const st = ensureState(node) as any;
  const minHeight = getNodePreviewMinHeight(node);
  const previewRoot = root ?? st.previewRoot;
  const mediaH = getMeasuredBlockHeight(st.mediaWrap, 0);
  const imageH = Math.max(getCanvasDisplayHeight(st.canvas, previewRoot), mediaH);
  const metaH = getMeasuredBlockHeight(st.previewMetaRow, 6);
  const controlsH = getMeasuredBlockHeight(st.previewControls, 8);
  const progressH = getMeasuredBlockHeight(st.progressWrap, 0);
  const compactPanelH = getMeasuredBlockHeight(st.compactNativePanel, 0);
  const chromeH = metaH + controlsH + progressH + compactPanelH + 12;
  return Math.max(minHeight, imageH + chromeH, chromeH);
}

function prettifyWidgetLabel(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getCompactWidgetValue(widget: ComfyWidget, fallback: unknown): string {
  const raw = widget.value ?? fallback ?? "";
  return String(raw ?? "");
}

function buildCompactNativeWidgetControls(node: ComfyNode, onWidgetChange?: () => void): HTMLElement | null {
  if (!isImageOpsNativeUiClass(node.comfyClass) && !isCompNode(node)) return null;

  const widgets = listCompactUiWidgets(node);
  if (!widgets.length) return null;

  const st = ensureState(node) as any;
  const bindings: CompactWidgetBinding[] = [];
  const panel = document.createElement("div");
  panel.style.marginTop = "8px";
  panel.style.display = "grid";
  panel.style.gap = "8px";

  const seenNames = new Set<string>();

  for (const widget of widgets) {
    // Skip duplicate widget names (e.g. background_color has both a native canvas
    // widget and a ComfyUI-auto-added DOM color picker — only build one row).
    if (seenNames.has(widget.name)) continue;
    seenNames.add(widget.name);

    const spec = getWidgetInputSpec(node, widget.name);
    if (!spec) continue;

    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "minmax(84px, auto) minmax(0,1fr)";
    row.style.gap = "8px";
    row.style.alignItems = "center";

    const label = document.createElement("div");
    label.textContent = String(spec.options?.display_name ?? prettifyWidgetLabel(widget.name));
    label.style.fontSize = "11px";
    label.style.opacity = "0.78";
    label.style.lineHeight = "1.2";
    row.appendChild(label);

    const commitValue = (value: string | number | boolean): void => {
      setWidgetMixedValue(widget, value);
      syncCompactNativeWidgetControls(node);
      onWidgetChange?.();
    };

    // Old COMBO format: typeSpec is an array of option values.
    // New COMBO format: typeSpec is the string "COMBO" and options are in spec.options.options.
    const comboOptions = Array.isArray(spec.typeSpec)
      ? (spec.typeSpec as unknown[])
      : String(spec.typeSpec ?? "").trim().toUpperCase() === "COMBO" && Array.isArray(spec.options?.options)
        ? (spec.options!.options as unknown[])
        : null;

    if (comboOptions !== null) {
      const select = document.createElement("select");
      styleSoftField(select);
      select.style.width = "100%";
      for (const entry of comboOptions) {
        const option = document.createElement("option");
        option.value = String(entry);
        option.textContent = prettifyWidgetLabel(String(entry));
        select.appendChild(option);
      }
      if (spec.options?.tooltip) select.title = String(spec.options.tooltip);
      select.addEventListener("change", () => commitValue(select.value));
      row.appendChild(createContextMenuSelect(select));
      bindings.push({ widget, kind: "select", control: select, integer: false });
      panel.appendChild(row);
      continue;
    }

    const kind = String(spec.typeSpec ?? "").trim().toUpperCase();
    if (kind === "BOOLEAN") {
      const button = document.createElement("button");
      button.type = "button";
      if (spec.options?.tooltip) button.title = String(spec.options.tooltip);
      button.addEventListener("click", () => {
        const active = String(widget.value ?? "false").toLowerCase().match(/^(true|1)$/) != null;
        commitValue(!active);
      });
      row.appendChild(button);
      bindings.push({ widget, kind: "boolean", control: button, integer: false });
      panel.appendChild(row);
      continue;
    }

    if (kind === "COLOR") {
      const initialColor = String(widget.value ?? spec.options?.default ?? "#000000");
      const { input: colorInput, host: colorHost } = createColorSwatch(initialColor, {
        title: spec.options?.tooltip ? String(spec.options.tooltip) : undefined,
      });
      colorInput.addEventListener("input", () => commitValue(colorInput.value));
      const defaultColor = String(spec.options?.default ?? "#000000");
      attachDblClickReset(colorHost, { defaultValue: defaultColor, onReset: (v) => commitValue(String(v)) });
      attachDblClickReset(colorInput, { defaultValue: defaultColor, onReset: (v) => commitValue(String(v)) });
      row.appendChild(colorHost);
      bindings.push({ widget, kind: "color", control: colorInput, integer: false });
      panel.appendChild(row);
      continue;
    }

    const input = document.createElement("input");
    input.type = kind === "STRING" ? "text" : "number";
    input.style.width = "100%";
    if (kind !== "STRING") {
      if (spec.options?.min != null) input.min = String(spec.options.min);
      if (spec.options?.max != null) input.max = String(spec.options.max);
      if (spec.options?.step != null) input.step = String(spec.options.step);
      input.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
      input.addEventListener("input", () => {
        const next = Number(input.value);
        if (!Number.isFinite(next)) return;
        commitValue(kind === "INT" ? Math.round(next) : next);
      });
      const numericDefault = Number(spec.options?.default ?? 0);
      if (Number.isFinite(numericDefault)) {
        attachDblClickReset(input, {
          defaultValue: kind === "INT" ? Math.round(numericDefault) : numericDefault,
          onReset: (v) => commitValue(v),
        });
      }
    } else {
      input.addEventListener("change", () => commitValue(input.value));
      const stringDefault = String(spec.options?.default ?? "");
      attachDblClickReset(input, { defaultValue: stringDefault, onReset: (v) => commitValue(String(v)) });
    }
    if (spec.options?.tooltip) input.title = String(spec.options.tooltip);
    styleSoftField(input);
    // For INT widgets named "seed", append a randomize 🎲 button.
    if (kind === "INT" && widget.name === "seed") {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:4px;align-items:center;min-width:0";
      wrap.appendChild(input);
      const rand = document.createElement("button");
      rand.type = "button";
      rand.textContent = "\uD83C\uDFB2";
      rand.title = "Randomize seed";
      rand.style.cssText = "background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:2px 6px;cursor:pointer;font-size:12px;line-height:1;flex:0 0 auto";
      rand.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const max = Number.isFinite(Number(spec.options?.max)) ? Number(spec.options?.max) : 2147483647;
        const min = Number.isFinite(Number(spec.options?.min)) ? Number(spec.options?.min) : 0;
        const span = Math.max(1, Math.min(max, 2147483647) - Math.max(min, 0));
        const next = Math.floor(Math.random() * span) + Math.max(min, 0);
        input.value = String(next);
        commitValue(next);
      });
      wrap.appendChild(rand);
      row.appendChild(wrap);
    } else {
      row.appendChild(input);
    }
    bindings.push({ widget, kind: kind === "STRING" ? "text" : "number", control: input, integer: kind === "INT" });
    panel.appendChild(row);
  }

  if (!bindings.length) return null;
  st.compactWidgetBindings = bindings;
  syncCompactNativeWidgetControls(node);

  // For tall panels (>4 controls), wrap in a collapsible <details> so the node
  // doesn't grow vertically out of control. Open/closed state is persisted per
  // node-class via localStorage.
  const COLLAPSE_THRESHOLD = 4;
  if (bindings.length > COLLAPSE_THRESHOLD) {
    const details = document.createElement("details");
    details.style.marginTop = "8px";
    details.style.background = "rgba(255,255,255,0.03)";
    details.style.border = "1px solid rgba(255,255,255,0.08)";
    details.style.borderRadius = "6px";
    details.style.padding = "4px 8px 8px";
    const summary = document.createElement("summary");
    summary.textContent = `Controls (${bindings.length})`;
    summary.style.cursor = "pointer";
    summary.style.fontSize = "11px";
    summary.style.opacity = "0.85";
    summary.style.padding = "4px 0";
    summary.style.userSelect = "none";
    details.appendChild(summary);
    panel.style.marginTop = "6px";
    details.appendChild(panel);
    bindCollapsibleToUiState(details, String(node.comfyClass ?? "unknown"), "compactPanelOpen", false);
    // When toggled, recompute node layout so height shrinks/grows accordingly.
    details.addEventListener("toggle", () => {
      try { (node as any).graph?.setDirtyCanvas?.(true, true); } catch {}
      try {
        const root = (ensureState(node) as any).previewRoot as HTMLElement | undefined;
        const target = getNodePreviewTargetSize(node, root ?? null, Math.max(360, Math.round((node as any).size?.[0] ?? 360)));
        node.setSize?.(target);
      } catch {}
    });
    return details;
  }

  return panel;
}

export function syncCompactNativeWidgetControls(node: ComfyNode): void {
  const bindings = ((ensureState(node) as any).compactWidgetBindings ?? []) as CompactWidgetBinding[];
  for (const binding of bindings) {
    const spec = getWidgetInputSpec(node, binding.widget.name);
    const fallback = spec?.options?.default;
    if (binding.kind === "boolean") {
      const button = binding.control as HTMLButtonElement;
      const active = String(binding.widget.value ?? fallback ?? "false").toLowerCase().match(/^(true|1)$/) != null;
      const labelOn = spec?.options?.label_on ? String(spec.options.label_on) : "On";
      const labelOff = spec?.options?.label_off ? String(spec.options.label_off) : "Off";
      button.textContent = active ? labelOn : labelOff;
      styleSoftButton(button, active);
      continue;
    }
    if (binding.kind === "select") {
      (binding.control as HTMLSelectElement).value = getCompactWidgetValue(binding.widget, fallback);
      continue;
    }
    if (binding.kind === "number") {
      const input = binding.control as HTMLInputElement;
      const raw = Number(binding.widget.value ?? fallback ?? "");
      input.value = Number.isFinite(raw) ? String(binding.integer ? Math.round(raw) : raw) : "";
      continue;
    }
    if (binding.kind === "color") {
      syncDarkColorInputUI(binding.control as HTMLInputElement, String(binding.widget.value ?? fallback ?? "#000000"));
      continue;
    }
    (binding.control as HTMLInputElement).value = getCompactWidgetValue(binding.widget, fallback);
  }
}

export function getNodePreviewTargetSize(
  node: ComfyNode,
  root: HTMLElement | null,
  fallbackWidth: number = 360,
): [number, number] {
  const minWidth = 360;
  const width = Math.max(minWidth, Math.round(fallbackWidth));
  const contentHeight = getNodePreviewContentHeight(node, root);

  // ComfyUI/LiteGraph node size is the full node box, not only the DOM widget
  // height. Let core add title, slots, margins and visible widget layout using
  // the preview widget's getMinHeight/computeLayoutSize contract.
  try {
    const computed = node.computeSize?.([width, contentHeight]);
    if (Array.isArray(computed)) {
      const computedWidth = Number(computed[0]);
      const computedHeight = Number(computed[1]);
      return [
        Number.isFinite(computedWidth) ? Math.max(width, Math.round(computedWidth)) : width,
        Number.isFinite(computedHeight) ? Math.max(contentHeight, Math.round(computedHeight)) : contentHeight,
      ];
    }
  } catch {}

  return [width, contentHeight];
}

function attachPreviewLayoutObserver(node: ComfyNode, root: HTMLElement): void {
  const st = ensureState(node) as any;
  if (st._layoutObserverCleanup) return;

  let rafId: number | null = null;
  const syncSize = (): void => {
    if (rafId != null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      try {
        const currentSize = getNodeSizeSnapshot(node);
        const target = getNodePreviewTargetSize(node, root, Math.max(360, Math.round(currentSize?.[0] ?? 360)));
        const widthChanged = Math.abs(Math.round(currentSize?.[0] ?? 0) - target[0]) > 1;
        const heightChanged = Math.abs(Math.round(currentSize?.[1] ?? 0) - target[1]) > 1;
        if (widthChanged || heightChanged) {
          node.setSize?.(target);
          (node.graph as any)?.setDirtyCanvas?.(true, true);
        }
      } catch {}
    });
  };

  if (typeof ResizeObserver !== "function") {
    st._layoutObserverCleanup = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    syncSize();
    return;
  }

  const observer = new ResizeObserver(() => syncSize());
  for (const element of [
    root,
    st.canvas,
    st.mediaWrap,
    st.previewMetaRow,
    st.previewControls,
    st.progressWrap,
  ]) {
    if (element instanceof HTMLElement) observer.observe(element);
  }

  st._layoutObserverCleanup = () => {
    if (rafId != null) cancelAnimationFrame(rafId);
    observer.disconnect();
  };

  syncSize();
}

export function ensurePreviewWidget(node: ComfyNode, progress: ProgressBus, canvasSize: number, onNativeWidgetChange?: () => void): NodeState | null {
  if (!isImageOpsClass(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;
  const previewNode = isPreviewNode(node);
  const constantNode = isConstantNode(node);
  const grainNode = isGrainNode(node);
  const rampNode = isRampNode(node);
  const textNode = isTextNode(node);
  const colorCorrectNode = isColorCorrectNode(node);
  const cropNode = isCropNode(node);
  const drawNode = isDrawNode(node);
  const compNode = isCompNode(node);
  const joinNode = isAppendNode(node);
  const frameSelectorNode = isFrameRangeNode(node);
  const keyerNode = isKeyerNode(node);
  const padOutNode = isPadOutNode(node);

  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.boxSizing = "border-box";
  root.style.padding = "6px";

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.display = "block";
  canvas.style.borderRadius = "8px";
  canvas.style.background = "rgba(0,0,0,0.35)";
  canvas.style.border = "1px solid rgba(255,255,255,0.08)";
  canvas.style.touchAction = "none";
  canvas.tabIndex = 0;

  const mediaWrap = document.createElement("div");
  mediaWrap.style.width = "100%";
  mediaWrap.style.display = "none";
  mediaWrap.style.borderRadius = "8px";
  mediaWrap.style.overflow = "hidden";
  mediaWrap.style.background = "rgba(0,0,0,0.35)";
  mediaWrap.style.border = "1px solid rgba(255,255,255,0.08)";

  const mediaVideo = document.createElement("video");
  mediaVideo.controls = false;
  mediaVideo.loop = true;
  mediaVideo.muted = true;
  mediaVideo.playsInline = true;
  mediaVideo.autoplay = true;
  mediaVideo.preload = "metadata";
  mediaVideo.style.width = "100%";
  mediaVideo.style.height = "auto";
  mediaVideo.style.display = "block";
  mediaVideo.style.background = "transparent";
  mediaVideo.hidden = true;

  const mediaImage = document.createElement("img");
  mediaImage.style.width = "100%";
  mediaImage.style.height = "auto";
  mediaImage.style.display = "block";
  mediaImage.style.background = "transparent";
  mediaImage.hidden = true;

  mediaWrap.appendChild(mediaVideo);
  mediaWrap.appendChild(mediaImage);

  const metaRow = document.createElement("div");
  metaRow.style.marginTop = "6px";
  metaRow.style.display = "flex";
  metaRow.style.alignItems = "center";
  metaRow.style.justifyContent = "space-between";
  metaRow.style.gap = "8px";

  const info = document.createElement("div") as HTMLDivElement;
  info.style.fontSize = "11px";
  info.style.opacity = "0.8";
  info.style.flex = "1 1 auto";
  info.textContent = "Live preview (no queue)";

  let nodeResetButton: HTMLButtonElement | null = null;
  if (!cropNode && !colorCorrectNode && !compNode) {
    nodeResetButton = document.createElement("button");
    nodeResetButton.type = "button";
    nodeResetButton.textContent = "Reset";
    styleInlineAction(nodeResetButton);
    nodeResetButton.style.opacity = "0.85";
  }

  let cropResetButton: HTMLButtonElement | null = null;
  if (cropNode) {
    cropResetButton = createCropResetButton();
  }

  let previewControls: HTMLDivElement | null = null;
  if (previewNode) {
    previewControls = createPreviewControlsUi().controls;
  } else if (constantNode) {
    previewControls = createConstantControlsUi().controls;

  } else if (grainNode) {
    previewControls = createGrainControlsUi().controls;
  } else if (textNode) {
    previewControls = createTextControlsUi().controls;
  } else if (rampNode) {
    previewControls = createRampControlsUi().controls;
  } else if (padOutNode) {
    previewControls = createPadOutControlsUi().controls;
  }

  let colorWheelCanvas: HTMLCanvasElement | null = null;
  let colorHueLabel: HTMLDivElement | null = null;
  let colorSatLabel: HTMLDivElement | null = null;
  let colorSwatch: HTMLDivElement | null = null;
  let colorResetButton: HTMLButtonElement | null = null;
  let colorTemperatureInput: HTMLInputElement | null = null;
  let colorTemperatureLabel: HTMLDivElement | null = null;
  let colorTintInput: HTMLInputElement | null = null;
  let colorTintLabel: HTMLDivElement | null = null;
  let colorContrastInput: HTMLInputElement | null = null;
  let colorContrastLabel: HTMLDivElement | null = null;
  let colorSaturationInput: HTMLInputElement | null = null;
  let colorSaturationValueLabel: HTMLDivElement | null = null;
  let colorVibranceInput: HTMLInputElement | null = null;
  let colorVibranceLabel: HTMLDivElement | null = null;
  let colorGammaInput: HTMLInputElement | null = null;
  let colorGammaLabel: HTMLDivElement | null = null;
  let colorShadowWheelCanvas: HTMLCanvasElement | null = null;
  let colorShadowLabel: HTMLDivElement | null = null;
  let colorMidtoneWheelCanvas: HTMLCanvasElement | null = null;
  let colorMidtoneLabel: HTMLDivElement | null = null;
  let colorHighlightWheelCanvas: HTMLCanvasElement | null = null;
  let colorHighlightLabel: HTMLDivElement | null = null;
  let colorBrightnessInput: HTMLInputElement | null = null;
  let colorBrightnessLabel: HTMLDivElement | null = null;
  // Zone tabs let one slider set drive global, shadows, midtones or highlights
  // sliders depending on the active tab. The DOM stays compact (one set of
  // sliders) but bound widget names switch dynamically — the active zone is
  // exposed on the node state so the interaction layer can route writes.
  let colorZoneTabsRow: HTMLDivElement | null = null;
  let colorZoneTabGlobal: HTMLButtonElement | null = null;
  let colorZoneTabShadows: HTMLButtonElement | null = null;
  let colorZoneTabMidtones: HTMLButtonElement | null = null;
  let colorZoneTabHighlights: HTMLButtonElement | null = null;
  let colorControls: HTMLDivElement | null = null;
  if (colorCorrectNode) {
    const colorUi = createColorCorrectControlsUi();
    colorControls = colorUi.controls;
    colorWheelCanvas = colorUi.wheelCanvas;
    colorHueLabel = colorUi.hueLabel;
    colorSatLabel = colorUi.satLabel;
    colorSwatch = colorUi.swatch;
    colorResetButton = colorUi.resetButton;
    colorTemperatureInput = colorUi.temperatureInput;
    colorTemperatureLabel = colorUi.temperatureLabel;
    colorTintInput = colorUi.tintInput;
    colorTintLabel = colorUi.tintLabel;
    colorContrastInput = colorUi.contrastInput;
    colorContrastLabel = colorUi.contrastLabel;
    colorSaturationInput = colorUi.saturationInput;
    colorSaturationValueLabel = colorUi.saturationValueLabel;
    colorVibranceInput = colorUi.vibranceInput;
    colorVibranceLabel = colorUi.vibranceLabel;
    colorGammaInput = colorUi.gammaInput;
    colorGammaLabel = colorUi.gammaLabel;
    colorShadowWheelCanvas = colorUi.shadowWheelCanvas;
    colorShadowLabel = colorUi.shadowLabel;
    colorMidtoneWheelCanvas = colorUi.midtoneWheelCanvas;
    colorMidtoneLabel = colorUi.midtoneLabel;
    colorHighlightWheelCanvas = colorUi.highlightWheelCanvas;
    colorHighlightLabel = colorUi.highlightLabel;
    colorBrightnessInput = colorUi.brightnessInput;
    colorBrightnessLabel = colorUi.brightnessLabel;
    colorZoneTabsRow = colorUi.zoneTabsRow;
    colorZoneTabGlobal = colorUi.zoneTabGlobal;
    colorZoneTabShadows = colorUi.zoneTabShadows;
    colorZoneTabMidtones = colorUi.zoneTabMidtones;
    colorZoneTabHighlights = colorUi.zoneTabHighlights;
  }

  let compAddButton: HTMLButtonElement | null = null;
  let compRemoveButton: HTMLButtonElement | null = null;
  let compResetButton: HTMLButtonElement | null = null;
  let compResizeButton: HTMLButtonElement | null = null;
  let compCornerPinButton: HTMLButtonElement | null = null;
  let compAspectRatioSelect: HTMLSelectElement | null = null;
  let compModeSelect: HTMLSelectElement | null = null;
  let compOpacityInput: HTMLInputElement | null = null;
  let compOpacityLabel: HTMLDivElement | null = null;
  let compLayerLabel: HTMLDivElement | null = null;
  let compControls: HTMLDivElement | null = null;
  if (compNode) {
    const compUi = createCompControlsUi();
    compControls = compUi.controls;
    compAddButton = compUi.addButton;
    compRemoveButton = compUi.removeButton;
    compResetButton = compUi.resetButton;
    compResizeButton = compUi.resizeButton;
    compCornerPinButton = compUi.cornerPinButton;
    compAspectRatioSelect = compUi.aspectRatioSelect;
    compModeSelect = compUi.modeSelect;
    compOpacityInput = compUi.opacityInput;
    compOpacityLabel = compUi.opacityLabel;
    compLayerLabel = compUi.layerLabel;
  }

  let frameSelectorControls: HTMLDivElement | null = null;
  let frameSelectorLabel: HTMLDivElement | null = null;
  let frameSelectorTrimStart: HTMLInputElement | null = null;
  let frameSelectorTrimEnd: HTMLInputElement | null = null;
  let frameSelectorHoldFrame: HTMLInputElement | null = null;
  let frameSelectorRuler: HTMLDivElement | null = null;
  let frameSelectorSliderBox: HTMLDivElement | null = null;
  let frameSelectorFill: HTMLDivElement | null = null;
  let frameSelectorFillLabel: HTMLDivElement | null = null;
  let frameSelectorStartHandle: HTMLDivElement | null = null;
  let frameSelectorEndHandle: HTMLDivElement | null = null;
  let frameSelectorPlayhead: HTMLDivElement | null = null;
  let frameSelectorHoldToggle: HTMLButtonElement | null = null;
  let frameSelectorHoldRow: HTMLDivElement | null = null;
  let frameSelectorRepeatRow: HTMLDivElement | null = null;
  let frameSelectorRepeatToggle: HTMLButtonElement | null = null;
  let frameSelectorRepeatModeSelect: HTMLSelectElement | null = null;
  let frameSelectorRepeatCountInput: HTMLInputElement | null = null;
  if (frameSelectorNode) {
    const frameSelectorUi = createFrameSelectorControlsUi();
    frameSelectorControls = frameSelectorUi.controls;
    frameSelectorLabel = frameSelectorUi.label;
    frameSelectorTrimStart = frameSelectorUi.trimStart;
    frameSelectorTrimEnd = frameSelectorUi.trimEnd;
    frameSelectorHoldFrame = frameSelectorUi.holdFrame;
    frameSelectorRuler = frameSelectorUi.ruler;
    frameSelectorSliderBox = frameSelectorUi.sliderBox;
    frameSelectorFill = frameSelectorUi.fill;
    frameSelectorFillLabel = frameSelectorUi.fillLabel;
    frameSelectorStartHandle = frameSelectorUi.startHandle;
    frameSelectorEndHandle = frameSelectorUi.endHandle;
    frameSelectorPlayhead = frameSelectorUi.playhead;
    frameSelectorHoldToggle = frameSelectorUi.holdToggle;
    frameSelectorHoldRow = frameSelectorUi.holdRow;
    frameSelectorRepeatRow = frameSelectorUi.repeatRow;
    frameSelectorRepeatToggle = frameSelectorUi.repeatToggle;
    frameSelectorRepeatModeSelect = frameSelectorUi.repeatModeSelect;
    frameSelectorRepeatCountInput = frameSelectorUi.repeatCountInput;
  }

  let joinControls: HTMLDivElement | null = null;
  let joinAddButton: HTMLButtonElement | null = null;
  let joinTrimList: HTMLDivElement | null = null;
  if (joinNode) {
    const joinUi = createJoinControlsUi();
    joinControls = joinUi.controls;
    joinAddButton = joinUi.addButton;
    joinTrimList = joinUi.trimList;
  }

  let keyerControls: HTMLDivElement | null = null;
  let keyerModeButtons: HTMLButtonElement[] = [];
  let keyerInvertButton: HTMLButtonElement | null = null;
  let keyerInvertMaskButton: HTMLButtonElement | null = null;
  let keyerBypassButton: HTMLButtonElement | null = null;
  let keyerPickButton: HTMLButtonElement | null = null;
  let keyerColorInput: HTMLInputElement | null = null;
  let keyerToleranceInput: HTMLInputElement | null = null;
  let keyerSoftnessInput: HTMLInputElement | null = null;
  let keyerGainInput: HTMLInputElement | null = null;
  let keyerBlurInput: HTMLInputElement | null = null;
  if (keyerNode) {
    const keyerUi = createKeyerControlsUi();
    keyerControls = keyerUi.controls;
    keyerModeButtons = keyerUi.modeButtons;
    keyerInvertButton = keyerUi.invertButton;
    keyerInvertMaskButton = keyerUi.invertMaskButton;
    keyerBypassButton = keyerUi.bypassButton;
    keyerPickButton = keyerUi.pickButton;
    keyerColorInput = keyerUi.colorInput;
    keyerToleranceInput = keyerUi.toleranceInput;
    keyerSoftnessInput = keyerUi.softnessInput;
    keyerGainInput = keyerUi.gainInput;
    keyerBlurInput = keyerUi.blurInput;
  }

  let drawBrushButton: HTMLButtonElement | null = null;
  let drawEraserButton: HTMLButtonElement | null = null;
  let drawClearButton: HTMLButtonElement | null = null;
  let drawColorInput: HTMLInputElement | null = null;
  let drawEdgeSelect: HTMLSelectElement | null = null;
  let drawSoftnessInput: HTMLInputElement | null = null;
  let drawSoftnessLabel: HTMLDivElement | null = null;
  let drawOpacityInput: HTMLInputElement | null = null;
  let drawOpacityLabel: HTMLDivElement | null = null;
  let drawSizeInput: HTMLInputElement | null = null;
  let drawSizeLabel: HTMLDivElement | null = null;
  let drawWidthInput: HTMLInputElement | null = null;
  let drawHeightInput: HTMLInputElement | null = null;
  let drawLinkButton: HTMLButtonElement | null = null;
  let drawBgColorInput: HTMLInputElement | null = null;
  let drawOverlayFormatSelect: HTMLSelectElement | null = null;
  let drawPressureSizeInput: HTMLInputElement | null = null;
  let drawPressureOpacityInput: HTMLInputElement | null = null;
  let drawTiltSizeInput: HTMLInputElement | null = null;
  let drawControls: HTMLDivElement | null = null;
  if (drawNode) {
    const drawUi = createDrawControlsUi();
    drawControls = drawUi.controls;
    drawBrushButton = drawUi.brushButton;
    drawEraserButton = drawUi.eraserButton;
    drawClearButton = drawUi.clearButton;
    drawColorInput = drawUi.colorInput;
    drawEdgeSelect = drawUi.edgeSelect;
    drawSoftnessInput = drawUi.softnessInput;
    drawSoftnessLabel = drawUi.softnessLabel;
    drawOpacityInput = drawUi.opacityInput;
    drawOpacityLabel = drawUi.opacityLabel;
    drawSizeInput = drawUi.sizeInput;
    drawSizeLabel = drawUi.sizeLabel;
    drawWidthInput = drawUi.widthInput;
    drawHeightInput = drawUi.heightInput;
    drawLinkButton = drawUi.linkButton;
    drawBgColorInput = drawUi.bgColorInput;
    drawOverlayFormatSelect = drawUi.overlayFormatSelect;
    drawPressureSizeInput = drawUi.pressureSizeInput;
    drawPressureOpacityInput = drawUi.pressureOpacityInput;
    drawTiltSizeInput = drawUi.tiltSizeInput;
  }

  const compactNativeControls = buildCompactNativeWidgetControls(node, onNativeWidgetChange);

  const progressWrap = document.createElement("div") as HTMLDivElement;
  progressWrap.style.marginTop = "6px";
  progressWrap.style.height = "6px";
  progressWrap.style.borderRadius = "999px";
  progressWrap.style.background = "rgba(255,255,255,0.12)";
  progressWrap.style.overflow = "hidden";
  progressWrap.style.display = "none";

  const progressBar = document.createElement("div") as HTMLDivElement;
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.borderRadius = "999px";
  progressBar.style.background = "rgba(255,255,255,0.55)";
  progressWrap.appendChild(progressBar);

  root.appendChild(mediaWrap);
  root.appendChild(canvas);
  metaRow.appendChild(info);
  if (nodeResetButton) metaRow.appendChild(nodeResetButton);
  if (cropResetButton) metaRow.appendChild(cropResetButton);
  root.appendChild(metaRow);
  if (previewControls) root.appendChild(previewControls);
  if (colorControls) root.appendChild(colorControls);
  if (drawControls) root.appendChild(drawControls);
  if (compControls) root.appendChild(compControls);
  if (joinControls) root.appendChild(joinControls);
  if (frameSelectorControls) root.appendChild(frameSelectorControls);
  if (keyerControls) root.appendChild(keyerControls);
  if (compactNativeControls) {
    root.appendChild(compactNativeControls);
    (ensureState(node) as any).compactNativePanel = compactNativeControls;
  }
  root.appendChild(progressWrap);

  const activeControls = previewControls ?? colorControls ?? drawControls ?? compControls ?? joinControls ?? frameSelectorControls ?? keyerControls ?? compactNativeControls;

  // Ensure pointer events reach our canvas even if Node 2.0 applies pointer-events:none on parent containers.
  root.style.pointerEvents = "auto";

  const domMinHeight = getNodePreviewMinHeight(node);
  if (typeof node.addDOMWidget === "function") {
    node.addDOMWidget("preview", "ImageOpsPreview", root, {
      serialize: false,
      hideOnZoom: false,
      getMinHeight: () => {
        return getNodePreviewContentHeight(node, root);
      },
    });
    const domWidget = (node.widgets ?? []).find((widget) => widget?.name === "preview") as any;
    // ComfyUI (Vue) hides the DOM widget wrapper by default via widget.hidden.
    // Force it visible so the controls appear without needing a preview image first.
    if (domWidget?.hidden !== false) {
      domWidget.hidden = false;
    }
    // Belt-and-suspenders: Vue adds class h-full w-full to our root element and
    // sets its style.display = "none" via v-show when no preview image is set.
    // We observe root directly and undo any display:none immediately.
    requestAnimationFrame(() => {
      const state = ensureState(node) as any;
      if (state._displayObserverCleanup) return;
      if (root.style.display === "none") root.style.display = "";
      const obs = new MutationObserver(() => {
        if (root.style.display === "none") root.style.display = "";
      });
      obs.observe(root, { attributes: true, attributeFilter: ["style"] });
      state._displayObserverCleanup = () => obs.disconnect();
    });
  } else {
    // Node 2.0 fallback: inject the root element directly into the node's DOM container.
    const domEl = (node as any).domElement ?? (node as any).element;
    if (domEl instanceof HTMLElement) {
      domEl.appendChild(root);
    } else {
      console.warn("[ImageOps] addDOMWidget unavailable and no DOM container found on node", node.id);
    }
  }

  // Force the preview widget to the top (before sliders), like KayTool.
  try {
    const widgets = node.widgets ?? [];
    const idx = widgets.findIndex(w => w?.name === "preview");
    if (idx > 0) {
      const [removed] = widgets.splice(idx, 1);
      widgets.unshift(removed);
    }
  } catch {}

  st.canvas = canvas;
  st.previewRoot = root;
  st.previewMetaRow = metaRow;
  st.previewControls = activeControls;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.mediaWrap = mediaWrap;
  st.mediaVideo = mediaVideo;
  st.mediaImage = mediaImage;
  (st as any).nodeResetButton = nodeResetButton;
  st.cropResetButton = cropResetButton;
  st.drawBrushButton = drawBrushButton;
  st.drawEraserButton = drawEraserButton;
  st.drawClearButton = drawClearButton;
  st.drawColorInput = drawColorInput;
  st.drawEdgeSelect = drawEdgeSelect;
  st.drawSoftnessInput = drawSoftnessInput;
  st.drawSoftnessLabel = drawSoftnessLabel;
  st.drawOpacityInput = drawOpacityInput;
  st.drawOpacityLabel = drawOpacityLabel;
  st.drawSizeInput = drawSizeInput;
  st.drawSizeLabel = drawSizeLabel;
  st.drawWidthInput = drawWidthInput;
  st.drawHeightInput = drawHeightInput;
  st.drawLinkButton = drawLinkButton;
  st.drawBgColorInput = drawBgColorInput;
  st.drawOverlayFormatSelect = drawOverlayFormatSelect;
  st.drawPressureSizeInput = drawPressureSizeInput;
  st.drawPressureOpacityInput = drawPressureOpacityInput;
  st.drawTiltSizeInput = drawTiltSizeInput;
  st.colorWheelCanvas = colorWheelCanvas;
  st.colorHueLabel = colorHueLabel;
  st.colorSatLabel = colorSatLabel;
  st.colorSwatch = colorSwatch;
  st.colorResetButton = colorResetButton;
  st.colorTemperatureInput = colorTemperatureInput;
  st.colorTemperatureLabel = colorTemperatureLabel;
  st.colorTintInput = colorTintInput;
  st.colorTintLabel = colorTintLabel;
  st.colorContrastInput = colorContrastInput;
  st.colorContrastLabel = colorContrastLabel;
  st.colorSaturationInput = colorSaturationInput;
  st.colorSaturationValueLabel = colorSaturationValueLabel;
  st.colorVibranceInput = colorVibranceInput;
  st.colorVibranceLabel = colorVibranceLabel;
  st.colorGammaInput = colorGammaInput;
  st.colorGammaLabel = colorGammaLabel;
  st.colorShadowWheelCanvas = colorShadowWheelCanvas;
  st.colorShadowLabel = colorShadowLabel;
  st.colorMidtoneWheelCanvas = colorMidtoneWheelCanvas;
  st.colorMidtoneLabel = colorMidtoneLabel;
  st.colorHighlightWheelCanvas = colorHighlightWheelCanvas;
  st.colorHighlightLabel = colorHighlightLabel;
  st.colorBrightnessInput = colorBrightnessInput;
  st.colorBrightnessLabel = colorBrightnessLabel;
  st.colorZoneTabsRow = colorZoneTabsRow;
  st.colorZoneTabGlobal = colorZoneTabGlobal;
  st.colorZoneTabShadows = colorZoneTabShadows;
  st.colorZoneTabMidtones = colorZoneTabMidtones;
  st.colorZoneTabHighlights = colorZoneTabHighlights;
  st.compAddButton = compAddButton;
  st.compRemoveButton = compRemoveButton;
  st.compResetButton = compResetButton;
  st.compResizeButton = compResizeButton;
  st.compCornerPinButton = compCornerPinButton;
  st.compAspectRatioSelect = compAspectRatioSelect;
  st.compModeSelect = compModeSelect;
  st.compOpacityInput = compOpacityInput;
  st.compOpacityLabel = compOpacityLabel;
  st.compLayerLabel = compLayerLabel;
  (st as any).joinAddButton = joinAddButton;
  (st as any).joinTrimList = joinTrimList;
  (st as any).joinControls = joinControls;
  st.frameSelectorControls = frameSelectorControls;
  st.frameSelectorLabel = frameSelectorLabel;
  st.frameSelectorTrimStart = frameSelectorTrimStart;
  st.frameSelectorTrimEnd = frameSelectorTrimEnd;
  st.frameSelectorHoldFrame = frameSelectorHoldFrame;
  st.frameSelectorRuler = frameSelectorRuler;
  st.frameSelectorSliderBox = frameSelectorSliderBox;
  st.frameSelectorFill = frameSelectorFill;
  (st as any).frameSelectorFillLabel = frameSelectorFillLabel;
  st.frameSelectorStartHandle = frameSelectorStartHandle;
  st.frameSelectorEndHandle = frameSelectorEndHandle;
  st.frameSelectorPlayhead = frameSelectorPlayhead;
  st.frameSelectorHoldToggle = frameSelectorHoldToggle;
  (st as any).frameSelectorHoldRow = frameSelectorHoldRow;
  (st as any).frameSelectorRepeatRow = frameSelectorRepeatRow;
  (st as any).frameSelectorRepeatToggle = frameSelectorRepeatToggle;
  (st as any).frameSelectorRepeatModeSelect = frameSelectorRepeatModeSelect;
  (st as any).frameSelectorRepeatCountInput = frameSelectorRepeatCountInput;
  (st as any).keyerControls = keyerControls;
  (st as any).keyerModeButtons = keyerModeButtons;
  (st as any).keyerInvertButton = keyerInvertButton;
  (st as any).keyerInvertMaskButton = keyerInvertMaskButton;
  (st as any).keyerBypassButton = keyerBypassButton;
  (st as any).keyerPickButton = keyerPickButton;
  (st as any).keyerColorInput = keyerColorInput;
  (st as any).keyerToleranceInput = keyerToleranceInput;
  (st as any).keyerSoftnessInput = keyerSoftnessInput;
  (st as any).keyerGainInput = keyerGainInput;
  (st as any).keyerBlurInput = keyerBlurInput;

  try {
    if (!frameSelectorNode) {
      const cs = (node as any).computeSize?.() ?? [360, domMinHeight];
      node.setSize?.(getNodePreviewTargetSize(node, root, Math.max(cs[0], 360)));
    }
    node.resizable = true;
  } catch {}

  attachPreviewLayoutObserver(node, root);

  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }

  return st;
}

