import { styleSoftButton } from "../shared/dom-styles.js";
import { findWidget, setWidgetStringValue, setWidgetValue, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsPadOut";
const PADOUT_WIDGETS = [
  "bypass",
  "aspect_ratio",
  "fill_mode",
  "fill_preset",
  "fill_color",
  "blur_radius",
  "invert_mask"
];
const TARGET_RATIO_MAP = {
  "1:1": 1,
  "square": 1,
  "nearest_square": 1,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "4:3": 4 / 3,
  "3:4": 3 / 4
};
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createPadOutControlsUi() {
  const controls = document.createElement("div");
  controls.dataset.padoutUi = "1";
  controls.style.marginTop = "8px";
  controls.style.display = "flex";
  controls.style.justifyContent = "center";
  controls.style.width = "100%";
  const fitButton = document.createElement("button");
  fitButton.type = "button";
  fitButton.textContent = "Fit All";
  fitButton.dataset.padout = "fit_all";
  styleSoftButton(fitButton, false);
  fitButton.style.padding = "4px 16px";
  fitButton.style.fontSize = "11px";
  controls.appendChild(fitButton);
  return { controls };
}
function normalizeTargetFormat(value) {
  return String(value || "custom").trim().toLowerCase().replace(/[-\s]+/g, "_");
}
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function projectedWidth(deltaX, deltaY, targetRatio) {
  const ratio = Math.max(1e-4, targetRatio);
  return (deltaX + deltaY / ratio) / (1 + 1 / (ratio * ratio));
}
function controlRoot(node) {
  const st = node.__imageops_state;
  const root = st?.previewControls ?? null;
  return root instanceof HTMLDivElement && root.dataset.padoutUi === "1" ? root : null;
}
function control(node, name) {
  return controlRoot(node)?.querySelector(`[data-padout="${name}"]`);
}
function getPadOutInfoText(_node, width, height) {
  return `PadOut (${width}\xD7${height})`;
}
function hidePadOutWidgets(node) {
  if (!isNode(node)) return;
}
function getPadOutSnap(node) {
  return Math.max(1, Math.round(widgetNumber(node, "snap_to_multiple", 1)));
}
function snapPadValue(value, snap) {
  return snap <= 1 ? Math.max(0, Math.round(value)) : Math.max(0, Math.round(Math.round(value) / snap) * snap);
}
function getPadOutTargetRatio(node) {
  return TARGET_RATIO_MAP[normalizeTargetFormat(widgetString(node, "aspect_ratio", "custom"))] ?? null;
}
function getPadOutSourceSize(node, geometry = null) {
  if (geometry?.sourceWidth && geometry?.sourceHeight) {
    return { sourceWidth: geometry.sourceWidth, sourceHeight: geometry.sourceHeight };
  }
  const st = node.__imageops_state;
  const sourceWidth = Math.max(1, Math.round(Number(st?.padOutSourceWidth) || Number(st?.padOutBackendSourceW) || Number(st?.previewSourceWidth) || 1));
  const sourceHeight = Math.max(1, Math.round(Number(st?.padOutSourceHeight) || Number(st?.padOutBackendSourceH) || Number(st?.previewSourceHeight) || 1));
  return { sourceWidth, sourceHeight };
}
function getPadOutFrame(node, geometry = null) {
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
    centerY: (y1 + y2) / 2
  };
}
function setPadOutPadding(node, left, top, right, bottom, notify = true) {
  const snap = getPadOutSnap(node);
  setWidgetValue(findWidget(node, "pad_left"), snapPadValue(left, snap), { notify });
  setWidgetValue(findWidget(node, "pad_top"), snapPadValue(top, snap), { notify });
  setWidgetValue(findWidget(node, "pad_right"), snapPadValue(right, snap), { notify });
  setWidgetValue(findWidget(node, "pad_bottom"), snapPadValue(bottom, snap), { notify });
}
function setPadOutOutputRect(node, sourceWidth, sourceHeight, x1, y1, outWidth, outHeight, notify = true) {
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
function setPadOutTargetFormatCustomIfNeeded(node) {
  const currentFormat = widgetString(node, "aspect_ratio", "custom");
  const ratio = TARGET_RATIO_MAP[normalizeTargetFormat(currentFormat)] ?? null;
  if (ratio == null) return;
  const frame = getPadOutFrame(node);
  const actualRatio = frame.outWidth / Math.max(1, frame.outHeight);
  if (Math.abs(actualRatio - ratio) > 0.015) {
    setWidgetStringValue(findWidget(node, "aspect_ratio"), "custom");
  }
}
function applyPadOutTargetFormat(node, targetFormat) {
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
function hydratePadOutTargetFormat(node) {
  if (!isNode(node)) return;
  const st = node.__imageops_state;
  if (st?.padOutRatioHydrated) return;
  if (st) st.padOutRatioHydrated = true;
  const targetFormat = widgetString(node, "aspect_ratio", "custom");
  const ratio = TARGET_RATIO_MAP[normalizeTargetFormat(targetFormat)] ?? null;
  if (ratio == null) return;
  const frame = getPadOutFrame(node);
  if (Math.abs(frame.outWidth / Math.max(1, frame.outHeight) - ratio) <= 0.015) return;
  applyPadOutTargetFormat(node, targetFormat);
}
function applyPadOutAnchor(node, anchor) {
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
function syncPadOutControls(node) {
  if (!isNode(node)) return;
  hidePadOutWidgets(node);
  const root = controlRoot(node);
  if (!root) return;
  const fitButton = control(node, "fit_all");
  if (fitButton) styleSoftButton(fitButton, false);
}
function attachPadOutControls(node, ctx) {
  if (!isNode(node)) return;
  const root = controlRoot(node);
  if (!root || root.dataset.padoutHooked === "1") return;
  root.dataset.padoutHooked = "1";
  const rerender = () => {
    syncPadOutControls(node);
    ctx.refreshNode(node);
  };
  control(node, "fit_all")?.addEventListener("click", () => {
    const st = node.__imageops_state;
    st.previewZoom = 1;
    st.previewPanX = 0;
    st.previewPanY = 0;
    rerender();
  });
  syncPadOutControls(node);
}
function getPadOutInteractionMode(geometry, x, y) {
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
  const near = (px, py) => Math.abs(x - px) <= T && Math.abs(y - py) <= T;
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
function getPadOutCursor(mode) {
  switch (mode) {
    case "move":
      return "move";
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
function dragLockedPadOutFrame(node, geometry, mode, deltaX, deltaY, startPadLeft, startPadTop, startPadRight, startPadBottom, notify = true) {
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
    outWidth = Math.max(minOutWidth, projectedWidth(startX2 + deltaX - startX1, startY2 - (startY1 + deltaY), ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX1;
    y1 = startY2 - outHeight;
  } else if (mode === "sw") {
    outWidth = Math.max(minOutWidth, projectedWidth(startX2 - (startX1 + deltaX), startY2 + deltaY - startY1, ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX2 - outWidth;
    y1 = startY1;
  } else if (mode === "se") {
    outWidth = Math.max(minOutWidth, projectedWidth(startX2 + deltaX - startX1, startY2 + deltaY - startY1, ratio));
    outHeight = Math.max(minOutHeight, outWidth / ratio);
    x1 = startX1;
    y1 = startY1;
  }
  setPadOutOutputRect(node, sourceWidth, sourceHeight, x1, y1, outWidth, outHeight, notify);
}
export {
  NODE_CLASS,
  applyPadOutAnchor,
  applyPadOutTargetFormat,
  attachPadOutControls,
  createPadOutControlsUi,
  dragLockedPadOutFrame,
  getPadOutCursor,
  getPadOutFrame,
  getPadOutInfoText,
  getPadOutInteractionMode,
  getPadOutSnap,
  getPadOutTargetRatio,
  hidePadOutWidgets,
  hydratePadOutTargetFormat,
  isNode,
  setPadOutOutputRect,
  setPadOutPadding,
  snapPadValue,
  syncPadOutControls
};
