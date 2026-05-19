import type { ComfyNode, NodeInteractionContext, PadOutPreviewGeometry, PadOutDragMode } from "../../types.js";
import { createContextMenuSelect, styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, setWidgetBooleanValue, setWidgetStringValue, setWidgetValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsPadOut";

export type PadOutControlsUi = {
  controls: HTMLDivElement;
};

const PADOUT_WIDGETS = [
  "bypass",
  "target_format",
  "fill_mode",
  "fill_preset",
  "fill_color",
  "blur_radius",
  "invert_mask",
];

const TARGET_RATIO_MAP: Record<string, number> = {
  "1:1": 1,
  "square": 1,
  "nearest_square": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
};

type PadOutFrame = {
  sourceWidth: number;
  sourceHeight: number;
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  outWidth: number;
  outHeight: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  centerX: number;
  centerY: number;
};

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function createPadOutControlsUi(): PadOutControlsUi {
  const controls = document.createElement("div");
  controls.dataset.padoutUi = "1";
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";

  const makeRow = (): HTMLDivElement => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "6px";
    row.style.flexWrap = "wrap";
    return row;
  };

  const makeLabel = (text: string): HTMLSpanElement => {
    const label = document.createElement("span");
    label.textContent = text;
    label.style.fontSize = "11px";
    label.style.opacity = "0.76";
    return label;
  };

  const ratioRow = makeRow();
  ratioRow.appendChild(makeLabel("Ratio"));
  const ratioSelect = document.createElement("select");
  ratioSelect.dataset.padout = "ratio_select";
  styleSoftField(ratioSelect);
  ratioSelect.style.width = "120px";
  for (const [value, label] of [["custom", "Free"], ["1:1", "1:1"], ["16:9", "16:9"], ["9:16", "9:16"], ["4:3", "4:3"], ["3:4", "3:4"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    ratioSelect.appendChild(option);
  }
  ratioRow.appendChild(createContextMenuSelect(ratioSelect));
  controls.appendChild(ratioRow);

  const anchorRow = makeRow();
  anchorRow.appendChild(makeLabel("Anchor"));
  const anchorSelect = document.createElement("select");
  anchorSelect.dataset.padout = "anchor_select";
  styleSoftField(anchorSelect);
  anchorSelect.style.width = "120px";
  for (const [value, label] of [["center", "Center"], ["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"], ["fit_w", "Fit W"], ["fit_h", "Fit H"]] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    anchorSelect.appendChild(option);
  }
  anchorRow.appendChild(createContextMenuSelect(anchorSelect));
  controls.appendChild(anchorRow);

  const actionsRow = makeRow();
  const fitButton = document.createElement("button");
  fitButton.type = "button";
  fitButton.textContent = "Fit All";
  fitButton.dataset.padout = "fit_all";
  styleSoftButton(fitButton, false);
  actionsRow.appendChild(fitButton);

  const invertMaskButton = document.createElement("button");
  invertMaskButton.type = "button";
  invertMaskButton.textContent = "Inv mask off";
  invertMaskButton.dataset.padout = "invert_mask";
  styleSoftButton(invertMaskButton, false);
  actionsRow.appendChild(invertMaskButton);

  const bypassButton = document.createElement("button");
  bypassButton.type = "button";
  bypassButton.textContent = "Bypass off";
  bypassButton.dataset.padout = "bypass";
  styleSoftButton(bypassButton, false);
  actionsRow.appendChild(bypassButton);

  const hint = document.createElement("div");
  hint.textContent = "Wheel: zoom. Middle drag: pan. Arrow keys: nudge. Shift: x4.";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.7";
  hint.style.marginLeft = "auto";
  actionsRow.appendChild(hint);
  controls.appendChild(actionsRow);

  return { controls };
}

function normalizeTargetFormat(value: string): string {
  return String(value || "custom").trim().toLowerCase().replace(/[-\s]+/g, "_");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function projectedWidth(deltaX: number, deltaY: number, targetRatio: number): number {
  const ratio = Math.max(0.0001, targetRatio);
  return (deltaX + deltaY / ratio) / (1 + 1 / (ratio * ratio));
}

function controlRoot(node: ComfyNode): HTMLDivElement | null {
  const st = node.__imageops_state as any;
  const root = st?.previewControls ?? null;
  return root instanceof HTMLDivElement && root.dataset.padoutUi === "1" ? root : null;
}

function control<T extends HTMLElement>(node: ComfyNode, name: string): T | null {
  return controlRoot(node)?.querySelector(`[data-padout="${name}"]`) as T | null;
}

export function getPadOutInfoText(_node: ComfyNode, width: number, height: number): string {
  return `PadOut (${width}×${height})`;
}

export function hidePadOutWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  const names = new Set(PADOUT_WIDGETS);
  for (const widget of node.widgets ?? []) {
    if (widget && names.has(String(widget.name ?? ""))) {
      hideWidgetForGood(node, widget as any);
    }
  }
}

export function getPadOutSnap(node: ComfyNode): number {
  return Math.max(1, Math.round(widgetNumber(node, "snap_to_multiple", 1)));
}

export function snapPadValue(value: number, snap: number): number {
  return snap <= 1 ? Math.max(0, Math.round(value)) : Math.max(0, Math.round(Math.round(value) / snap) * snap);
}

export function getPadOutTargetRatio(node: ComfyNode): number | null {
  return TARGET_RATIO_MAP[normalizeTargetFormat(widgetString(node, "target_format", "custom"))] ?? null;
}

function getPadOutSourceSize(node: ComfyNode, geometry: PadOutPreviewGeometry | null = null): { sourceWidth: number; sourceHeight: number } {
  if (geometry?.sourceWidth && geometry?.sourceHeight) {
    return { sourceWidth: geometry.sourceWidth, sourceHeight: geometry.sourceHeight };
  }
  const st = node.__imageops_state as any;
  const sourceWidth = Math.max(1, Math.round(Number(st?.padOutSourceWidth) || Number(st?.padOutBackendSourceW) || Number(st?.previewSourceWidth) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(st?.padOutSourceHeight) || Number(st?.padOutBackendSourceH) || Number(st?.previewSourceHeight) || 1));
  return { sourceWidth, sourceHeight };
}

export function getPadOutFrame(node: ComfyNode, geometry: PadOutPreviewGeometry | null = null): PadOutFrame {
  const snap = getPadOutSnap(node);
  const { sourceWidth, sourceHeight } = getPadOutSourceSize(node, geometry);
  const padLeft = snapPadValue(widgetNumber(node, "pad_left", geometry?.padLeft ?? 0), snap);
  const padTop = snapPadValue(widgetNumber(node, "pad_top", geometry?.padTop ?? 0), snap);
  const padRight = snapPadValue(widgetNumber(node, "pad_right", geometry?.padRight ?? 0), snap);
  const padBottom = snapPadValue(widgetNumber(node, "pad_bottom", geometry?.padBottom ?? 0), snap);
  const outWidth = Math.max(1, sourceWidth + padLeft + padRight);
  const outHeight = Math.max(1, sourceHeight + padTop + padBottom);
  const x1 = -padLeft;
  const y1 = -padTop;
  const x2 = sourceWidth + padRight;
  const y2 = sourceHeight + padBottom;
  return {
    sourceWidth,
    sourceHeight,
    padLeft,
    padTop,
    padRight,
    padBottom,
    outWidth,
    outHeight,
    x1,
    y1,
    x2,
    y2,
    centerX: (x1 + x2) / 2,
    centerY: (y1 + y2) / 2,
  };
}

export function setPadOutPadding(node: ComfyNode, left: number, top: number, right: number, bottom: number, notify: boolean = true): void {
  const snap = getPadOutSnap(node);
  setWidgetValue(findWidget(node, "pad_left"), snapPadValue(left, snap), { notify });
  setWidgetValue(findWidget(node, "pad_top"), snapPadValue(top, snap), { notify });
  setWidgetValue(findWidget(node, "pad_right"), snapPadValue(right, snap), { notify });
  setWidgetValue(findWidget(node, "pad_bottom"), snapPadValue(bottom, snap), { notify });
}

export function setPadOutOutputRect(node: ComfyNode, sourceWidth: number, sourceHeight: number, x1: number, y1: number, outWidth: number, outHeight: number, notify: boolean = true): void {
  const snap = getPadOutSnap(node);
  let nextOutWidth = Math.max(sourceWidth, snapPadValue(outWidth, snap));
  let nextOutHeight = Math.max(sourceHeight, snapPadValue(outHeight, snap));
  const nextX1 = clamp(x1, sourceWidth - nextOutWidth, 0);
  const nextY1 = clamp(y1, sourceHeight - nextOutHeight, 0);
  const nextX2 = nextX1 + nextOutWidth;
  const nextY2 = nextY1 + nextOutHeight;
  const left = snapPadValue(-nextX1, snap);
  const top = snapPadValue(-nextY1, snap);
  const right = snapPadValue(nextX2 - sourceWidth, snap);
  const bottom = snapPadValue(nextY2 - sourceHeight, snap);
  setPadOutPadding(node, left, top, right, bottom, notify);
}

function setPadOutTargetFormatCustomIfNeeded(node: ComfyNode): void {
  const currentFormat = widgetString(node, "target_format", "custom");
  const ratio = TARGET_RATIO_MAP[normalizeTargetFormat(currentFormat)] ?? null;
  if (ratio == null) return;
  const frame = getPadOutFrame(node);
  const actualRatio = frame.outWidth / Math.max(1, frame.outHeight);
  if (Math.abs(actualRatio - ratio) > 0.015) {
    setWidgetStringValue(findWidget(node, "target_format"), "custom");
  }
}

export function applyPadOutTargetFormat(node: ComfyNode, targetFormat: string): void {
  const ratio = TARGET_RATIO_MAP[normalizeTargetFormat(targetFormat)] ?? null;
  if (ratio == null) return;
  const frame = getPadOutFrame(node);
  let outWidth = frame.outWidth;
  let outHeight = frame.outHeight;
  if (outWidth / Math.max(1, outHeight) < ratio) {
    outWidth = outHeight * ratio;
  } else if (outWidth / Math.max(1, outHeight) > ratio) {
    outHeight = outWidth / ratio;
  }
  setPadOutOutputRect(node, frame.sourceWidth, frame.sourceHeight, frame.centerX - outWidth / 2, frame.centerY - outHeight / 2, outWidth, outHeight);
}

export function hydratePadOutTargetFormat(node: ComfyNode): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state as any;
  if (st?.padOutRatioHydrated) return;
  if (st) st.padOutRatioHydrated = true;
  const targetFormat = widgetString(node, "target_format", "custom");
  const ratio = TARGET_RATIO_MAP[normalizeTargetFormat(targetFormat)] ?? null;
  if (ratio == null) return;
  const frame = getPadOutFrame(node);
  if (Math.abs(frame.outWidth / Math.max(1, frame.outHeight) - ratio) <= 0.015) return;
  applyPadOutTargetFormat(node, targetFormat);
}

export function applyPadOutAnchor(node: ComfyNode, anchor: string): void {
  const frame = getPadOutFrame(node);
  const ratio = getPadOutTargetRatio(node);
  let outWidth = frame.outWidth;
  let outHeight = frame.outHeight;
  let x1 = frame.x1;
  let y1 = frame.y1;

  switch (anchor) {
    case "center":
      x1 = (frame.sourceWidth - outWidth) / 2;
      y1 = (frame.sourceHeight - outHeight) / 2;
      break;
    case "top":
      y1 = 0;
      break;
    case "bottom":
      y1 = frame.sourceHeight - outHeight;
      break;
    case "left":
      x1 = 0;
      break;
    case "right":
      x1 = frame.sourceWidth - outWidth;
      break;
    case "fit_w":
      outWidth = frame.sourceWidth;
      x1 = 0;
      if (ratio != null) {
        outHeight = Math.max(frame.sourceHeight, outWidth / ratio);
        y1 = (frame.sourceHeight - outHeight) / 2;
      }
      break;
    case "fit_h":
      outHeight = frame.sourceHeight;
      y1 = 0;
      if (ratio != null) {
        outWidth = Math.max(frame.sourceWidth, outHeight * ratio);
        x1 = (frame.sourceWidth - outWidth) / 2;
      }
      break;
    default:
      return;
  }

  setPadOutOutputRect(node, frame.sourceWidth, frame.sourceHeight, x1, y1, outWidth, outHeight);
}

export function syncPadOutControls(node: ComfyNode): void {
  if (!isNode(node)) return;
  const root = controlRoot(node);
  if (!root) return;

  const targetFormat = widgetString(node, "target_format", "custom");
  const bypass = widgetBoolean(node, "bypass", false);
  const invertMask = widgetBoolean(node, "invert_mask", false);

  const ratioSelect = control<HTMLSelectElement>(node, "ratio_select");
  if (ratioSelect && ratioSelect.value !== targetFormat) ratioSelect.value = targetFormat;

  const anchorSelect = control<HTMLSelectElement>(node, "anchor_select");
  if (anchorSelect && !anchorSelect.value) anchorSelect.value = "center";

  const invertButton = control<HTMLButtonElement>(node, "invert_mask");
  if (invertButton) {
    invertButton.textContent = invertMask ? "Inv mask on" : "Inv mask off";
    styleSoftButton(invertButton, invertMask);
  }

  const bypassButton = control<HTMLButtonElement>(node, "bypass");
  if (bypassButton) {
    bypassButton.textContent = bypass ? "Bypass on" : "Bypass off";
    styleSoftButton(bypassButton, bypass);
  }

  const fitButton = control<HTMLButtonElement>(node, "fit_all");
  if (fitButton) styleSoftButton(fitButton, false);
}

export function attachPadOutControls(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const root = controlRoot(node);
  if (!root || root.dataset.padoutHooked === "1") return;
  root.dataset.padoutHooked = "1";

  const rerender = (): void => {
    syncPadOutControls(node);
    ctx.refreshNode(node);
  };

  control<HTMLSelectElement>(node, "ratio_select")?.addEventListener("change", (event) => {
    const targetFormat = (event.currentTarget as HTMLSelectElement).value || "custom";
    setWidgetStringValue(findWidget(node, "target_format"), targetFormat);
    if (targetFormat !== "custom") applyPadOutTargetFormat(node, targetFormat);
    rerender();
  });

  control<HTMLSelectElement>(node, "anchor_select")?.addEventListener("change", (event) => {
    applyPadOutAnchor(node, (event.currentTarget as HTMLSelectElement).value || "center");
    rerender();
  });

  control<HTMLButtonElement>(node, "invert_mask")?.addEventListener("click", () => {
    setWidgetBooleanValue(findWidget(node, "invert_mask"), !widgetBoolean(node, "invert_mask", false));
    rerender();
  });

  control<HTMLButtonElement>(node, "bypass")?.addEventListener("click", () => {
    setWidgetBooleanValue(findWidget(node, "bypass"), !widgetBoolean(node, "bypass", false));
    rerender();
  });

  control<HTMLButtonElement>(node, "fit_all")?.addEventListener("click", () => {
    const st = node.__imageops_state as any;
    st.previewZoom = 1;
    st.previewPanX = 0;
    st.previewPanY = 0;
    rerender();
  });

  syncPadOutControls(node);
}

export function getPadOutInteractionMode(geometry: PadOutPreviewGeometry | null, x: number, y: number): PadOutDragMode | "move" | null {
  if (!geometry) return null;
  const scaleX = geometry.fitDrawWidth / Math.max(1, geometry.outputWidth);
  const scaleY = geometry.fitDrawHeight / Math.max(1, geometry.outputHeight);

  const oLeft = geometry.fitDx;
  const oTop = geometry.fitDy;
  const oRight = geometry.fitDx + geometry.fitDrawWidth;
  const oBottom = geometry.fitDy + geometry.fitDrawHeight;
  const oMidX = (oLeft + oRight) / 2;
  const oMidY = (oTop + oBottom) / 2;

  const iLeft = geometry.fitDx + geometry.padLeft * scaleX;
  const iTop = geometry.fitDy + geometry.padTop * scaleY;
  const iRight = iLeft + geometry.sourceWidth * scaleX;
  const iBottom = iTop + geometry.sourceHeight * scaleY;

  const T = 12;
  const near = (px: number, py: number): boolean => Math.abs(x - px) <= T && Math.abs(y - py) <= T;

  if (near(oLeft, oTop)) return "nw";
  if (near(oRight, oTop)) return "ne";
  if (near(oLeft, oBottom)) return "sw";
  if (near(oRight, oBottom)) return "se";
  if (near(oMidX, oTop) && x >= oLeft && x <= oRight) return "n";
  if (near(oRight, oMidY) && y >= oTop && y <= oBottom) return "e";
  if (near(oMidX, oBottom) && x >= oLeft && x <= oRight) return "s";
  if (near(oLeft, oMidY) && y >= oTop && y <= oBottom) return "w";
  if (Math.abs(y - oTop) <= T && x > oLeft + T && x < oRight - T) return "n";
  if (Math.abs(x - oRight) <= T && y > oTop + T && y < oBottom - T) return "e";
  if (Math.abs(y - oBottom) <= T && x > oLeft + T && x < oRight - T) return "s";
  if (Math.abs(x - oLeft) <= T && y > oTop + T && y < oBottom - T) return "w";
  if (x >= iLeft && x <= iRight && y >= iTop && y <= iBottom) return "move";
  return null;
}

export function getPadOutCursor(mode: PadOutDragMode | "move" | null): string {
  switch (mode) {
    case "move": return "move";
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
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

export function dragLockedPadOutFrame(
  node: ComfyNode,
  geometry: PadOutPreviewGeometry,
  mode: PadOutDragMode,
  deltaX: number,
  deltaY: number,
  startPadLeft: number,
  startPadTop: number,
  startPadRight: number,
  startPadBottom: number,
  notify: boolean = true,
): void {
  const ratio = getPadOutTargetRatio(node);
  if (ratio == null) return;

  const sourceWidth = geometry.sourceWidth;
  const sourceHeight = geometry.sourceHeight;
  const startX1 = -startPadLeft;
  const startY1 = -startPadTop;
  const startOutWidth = sourceWidth + startPadLeft + startPadRight;
  const startOutHeight = sourceHeight + startPadTop + startPadBottom;
  const startX2 = startX1 + startOutWidth;
  const startY2 = startY1 + startOutHeight;
  const startCenterX = startX1 + startOutWidth / 2;
  const startCenterY = startY1 + startOutHeight / 2;
  const minOutWidth = Math.max(sourceWidth, sourceHeight * ratio);
  const minOutHeight = Math.max(sourceHeight, sourceWidth / ratio);

  let x1 = startX1;
  let y1 = startY1;
  let outWidth = startOutWidth;
  let outHeight = startOutHeight;

  if (mode === "n") {
    outHeight = Math.max(minOutHeight, startY2 - (startY1 + deltaY));
    outWidth = Math.max(minOutWidth, outHeight * ratio);
    x1 = startCenterX - outWidth / 2;
    y1 = startY2 - outHeight;
  } else if (mode === "s") {
    outHeight = Math.max(minOutHeight, startOutHeight + deltaY);
    outWidth = Math.max(minOutWidth, outHeight * ratio);
    x1 = startCenterX - outWidth / 2;
    y1 = startY1;
  } else if (mode === "w") {
    outWidth = Math.max(minOutWidth, startX2 - (startX1 + deltaX));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX2 - outWidth;
    y1 = startCenterY - outHeight / 2;
  } else if (mode === "e") {
    outWidth = Math.max(minOutWidth, startOutWidth + deltaX);
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX1;
    y1 = startCenterY - outHeight / 2;
  } else if (mode === "nw") {
    outWidth = Math.max(minOutWidth, projectedWidth(startX2 - (startX1 + deltaX), startY2 - (startY1 + deltaY), ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX2 - outWidth;
    y1 = startY2 - outHeight;
  } else if (mode === "ne") {
    outWidth = Math.max(minOutWidth, projectedWidth((startX2 + deltaX) - startX1, startY2 - (startY1 + deltaY), ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX1;
    y1 = startY2 - outHeight;
  } else if (mode === "sw") {
    outWidth = Math.max(minOutWidth, projectedWidth(startX2 - (startX1 + deltaX), (startY2 + deltaY) - startY1, ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX2 - outWidth;
    y1 = startY1;
  } else if (mode === "se") {
    outWidth = Math.max(minOutWidth, projectedWidth((startX2 + deltaX) - startX1, (startY2 + deltaY) - startY1, ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX1;
    y1 = startY1;
  }

  setPadOutOutputRect(node, sourceWidth, sourceHeight, x1, y1, outWidth, outHeight, notify);
}
