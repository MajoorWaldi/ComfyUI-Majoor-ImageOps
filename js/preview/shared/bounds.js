import { ensureState, setInfo } from "./state.js";
import { getFitPlacement, drawOutputFormatBox } from "./geometry.js";
import { widgetNumber } from "./widgets.js";
import { hideNativeMediaPreview, showNativeMediaPreview, getNativePreviewImage } from "./media.js";
import { isNode as isCropNode, getCropControlState, getCropCanvasMetrics } from "../nodes/crop.js";
import { computeCropRect } from "../crop.js";
import { isNode as isCompNode, getCompCanvasMetrics } from "../nodes/comp.js";
import { isNode as isCornerPinNode, cornerPinControlPoints } from "../nodes/corner-pin.js";
import { isNode as isRampNode, rampControlPoints } from "../nodes/ramp.js";
import { isNode as isPadOutNode } from "../nodes/pad-out.js";
import { isNode as isDrawNode } from "../nodes/draw.js";
function drawTransformBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (String(node?.comfyClass ?? "") !== "ImageOpsTransform") return;
  const tx = widgetNumber(node, "translate_x", 0);
  const ty = widgetNumber(node, "translate_y", 0);
  const rotDeg = widgetNumber(node, "rotate_deg", 0);
  const scale = Math.max(0.01, widgetNumber(node, "scale", 1));
  const rad = rotDeg * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = sourceWidth / 2;
  const cy = sourceHeight / 2;
  const corners = [
    { x: 0, y: 0 },
    { x: sourceWidth, y: 0 },
    { x: sourceWidth, y: sourceHeight },
    { x: 0, y: sourceHeight }
  ].map((point) => {
    const localX = (point.x - cx) * scale;
    const localY = (point.y - cy) * scale;
    return {
      x: localX * cos - localY * sin + cx + tx,
      y: localX * sin + localY * cos + cy + ty
    };
  });
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  const mapped = corners.map((point) => ({
    x: fit.dx + point.x * scaleX,
    y: fit.dy + point.y * scaleY
  }));
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(fit.dx + 0.5, fit.dy + 0.5, fit.drawWidth, fit.drawHeight);
  ctx.strokeStyle = "rgba(80, 180, 255, 0.95)";
  ctx.fillStyle = "rgba(80, 180, 255, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(mapped[0].x, mapped[0].y);
  for (let i = 1; i < mapped.length; i++) {
    ctx.lineTo(mapped[i].x, mapped[i].y);
  }
  ctx.closePath();
  ctx.stroke();
  for (const point of mapped) {
    ctx.fillRect(point.x - 2, point.y - 2, 4, 4);
  }
  ctx.restore();
}
function drawCropBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (!isCropNode(node)) return null;
  const state = getCropControlState(node, sourceWidth, sourceHeight);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    state.aspectRatio,
    state.centerX,
    state.centerY,
    state.scale
  );
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  const left = fit.dx + crop.x * scaleX;
  const top = fit.dy + crop.y * scaleY;
  const cropWidth = crop.cropWidth * scaleX;
  const cropHeight = crop.cropHeight * scaleY;
  const metrics = getCropCanvasMetrics(left, top, cropWidth, cropHeight);
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.rect(left, top, cropWidth, cropHeight);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(235, 239, 140, 0.95)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(left + 0.5, top + 0.5, cropWidth, cropHeight);
  ctx.strokeStyle = "rgba(235, 239, 140, 0.35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  const thirdX = cropWidth / 3;
  const thirdY = cropHeight / 3;
  for (let i = 1; i < 3; i++) {
    const x = left + thirdX * i;
    const y = top + thirdY * i;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + cropHeight);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + cropWidth, y);
    ctx.stroke();
  }
  const handleLength = Math.max(10, Math.min(16, Math.floor(Math.min(cropWidth, cropHeight) * 0.12)));
  const drawCorner = (x, y, sx, sy) => {
    ctx.beginPath();
    ctx.moveTo(x, y + sy * handleLength);
    ctx.lineTo(x, y);
    ctx.lineTo(x + sx * handleLength, y);
    ctx.stroke();
  };
  ctx.strokeStyle = "rgba(235, 239, 140, 1)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  drawCorner(left, top, 1, 1);
  drawCorner(left + cropWidth, top, -1, 1);
  drawCorner(left, top + cropHeight, 1, -1);
  drawCorner(left + cropWidth, top + cropHeight, -1, -1);
  ctx.fillStyle = "rgba(235, 239, 140, 0.92)";
  for (const point of [metrics.topMid, metrics.rightMid, metrics.bottomMid, metrics.leftMid]) {
    ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
  }
  ctx.restore();
  return {
    sourceWidth,
    sourceHeight,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight,
    cropX: crop.x,
    cropY: crop.y,
    cropWidth: crop.cropWidth,
    cropHeight: crop.cropHeight,
    bbox: {
      x: crop.x,
      y: crop.y,
      width: crop.cropWidth,
      height: crop.cropHeight,
      sourceWidth,
      sourceHeight,
      coordinateSpace: "source"
    }
  };
}
function drawCompBounds(node, ctx, width, height, sourceWidth, sourceHeight, layers) {
  if (!isCompNode(node) || layers.length === 0) return;
  const st = ensureState(node);
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  ctx.save();
  for (const layer of layers) {
    const selected = layer.slot === st.compSelectedSlot;
    const metrics = getCompCanvasMetrics(layer, fit, sourceWidth, sourceHeight);
    const corners = [metrics.topLeft, metrics.topRight, metrics.bottomRight, metrics.bottomLeft];
    ctx.strokeStyle = selected ? "rgba(235, 239, 140, 0.98)" : "rgba(255,255,255,0.35)";
    ctx.lineWidth = selected ? 1.6 : 1;
    ctx.setLineDash(selected ? [] : [4, 4]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let index = 1; index < corners.length; index++) {
      ctx.lineTo(corners[index].x, corners[index].y);
    }
    ctx.closePath();
    ctx.stroke();
    if (!selected) continue;
    ctx.fillStyle = "rgba(235, 239, 140, 0.95)";
    for (const point of corners) {
      ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
    }
    ctx.strokeStyle = "rgba(235, 239, 140, 0.8)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(metrics.topMid.x, metrics.topMid.y);
    ctx.lineTo(metrics.rotationHandle.x, metrics.rotationHandle.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(metrics.rotationHandle.x, metrics.rotationHandle.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
function drawRampBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (!isRampNode(node)) return null;
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const geometry = {
    sourceWidth,
    sourceHeight,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight
  };
  const points = rampControlPoints(node, geometry);
  ctx.save();
  ctx.strokeStyle = "rgba(126, 214, 255, 0.92)";
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(points.start.x, points.start.y);
  ctx.lineTo(points.end.x, points.end.y);
  ctx.stroke();
  const drawHandle = (x, y, label, fill) => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = "rgba(10, 12, 16, 0.92)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, x, y - 10);
  };
  drawHandle(points.start.x, points.start.y, "A", "rgba(255, 196, 87, 0.95)");
  drawHandle(points.end.x, points.end.y, "B", "rgba(86, 208, 255, 0.95)");
  ctx.restore();
  return geometry;
}
function drawCornerPinBounds(node, ctx, width, height, sourceWidth, sourceHeight) {
  if (!isCornerPinNode(node)) return null;
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const geometry = {
    sourceWidth,
    sourceHeight,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight
  };
  const points = cornerPinControlPoints(node, geometry);
  ctx.save();
  ctx.strokeStyle = "rgba(98, 224, 255, 0.96)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(points.tl.x, points.tl.y);
  ctx.lineTo(points.tr.x, points.tr.y);
  ctx.lineTo(points.br.x, points.br.y);
  ctx.lineTo(points.bl.x, points.bl.y);
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = "rgba(98, 224, 255, 0.35)";
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(points.tl.x, points.tl.y);
  ctx.lineTo(points.br.x, points.br.y);
  ctx.moveTo(points.tr.x, points.tr.y);
  ctx.lineTo(points.bl.x, points.bl.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const labels = { tl: "TL", tr: "TR", bl: "BL", br: "BR" };
  for (const key of ["tl", "tr", "bl", "br"]) {
    const point = points[key];
    ctx.fillStyle = "rgba(98, 224, 255, 0.95)";
    ctx.strokeStyle = "rgba(10, 18, 24, 0.95)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.font = "10px sans-serif";
    ctx.fillText(labels[key], point.x + 8, point.y - 8);
  }
  ctx.restore();
  return geometry;
}
function drawPadOutBounds(node, ctx, width, height, outputWidth, outputHeight, fixedSourceWidth = 0, fixedSourceHeight = 0) {
  if (!isPadOutNode(node)) return null;
  const snap = Math.max(1, Math.round(widgetNumber(node, "snap_to_multiple", 1)));
  const snapPad = (value) => snap <= 1 ? Math.max(0, Math.round(value)) : Math.max(0, Math.round(Math.round(value) / snap) * snap);
  const padLeft = snapPad(widgetNumber(node, "pad_left", 0));
  const padTop = snapPad(widgetNumber(node, "pad_top", 0));
  const padRight = snapPad(widgetNumber(node, "pad_right", 0));
  const padBottom = snapPad(widgetNumber(node, "pad_bottom", 0));
  const sourceWidth = fixedSourceWidth > 0 ? fixedSourceWidth : Math.max(1, outputWidth - padLeft - padRight);
  const sourceHeight = fixedSourceHeight > 0 ? fixedSourceHeight : Math.max(1, outputHeight - padTop - padBottom);
  const effectiveOutputWidth = sourceWidth + padLeft + padRight;
  const effectiveOutputHeight = sourceHeight + padTop + padBottom;
  const fit = getFitPlacement(width, height, effectiveOutputWidth, effectiveOutputHeight);
  const scaleX = fit.drawWidth / Math.max(1, outputWidth);
  const scaleY = fit.drawHeight / Math.max(1, outputHeight);
  const left = fit.dx + padLeft * scaleX;
  const top = fit.dy + padTop * scaleY;
  const innerWidth = sourceWidth * scaleX;
  const innerHeight = sourceHeight * scaleY;
  const drawLabel = (text, centerX, centerY) => {
    ctx.save();
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const metrics = ctx.measureText(text);
    const boxWidth = Math.ceil(metrics.width + 14);
    const boxHeight = 20;
    const x = Math.round(centerX - boxWidth / 2);
    const y = Math.round(centerY - boxHeight / 2);
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.strokeRect(x + 0.5, y + 0.5, boxWidth - 1, boxHeight - 1);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(text, x + boxWidth / 2, y + boxHeight / 2 + 0.5);
    ctx.restore();
  };
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.rect(fit.dx, fit.dy, fit.drawWidth, fit.drawHeight);
  ctx.rect(left, top, innerWidth, innerHeight);
  ctx.fill("evenodd");
  ctx.strokeStyle = "rgba(98, 224, 255, 0.88)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(left + 0.5, top + 0.5, innerWidth, innerHeight);
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(fit.dx + 0.5, fit.dy + 0.5, fit.drawWidth, fit.drawHeight);
  ctx.setLineDash([]);
  const mx = fit.dx + fit.drawWidth / 2;
  const my = fit.dy + fit.drawHeight / 2;
  const outerHandles = [
    { x: fit.dx, y: fit.dy },
    { x: mx, y: fit.dy },
    { x: fit.dx + fit.drawWidth, y: fit.dy },
    { x: fit.dx + fit.drawWidth, y: my },
    { x: fit.dx + fit.drawWidth, y: fit.dy + fit.drawHeight },
    { x: mx, y: fit.dy + fit.drawHeight },
    { x: fit.dx, y: fit.dy + fit.drawHeight },
    { x: fit.dx, y: my }
  ];
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const pt of outerHandles) {
    ctx.fillRect(pt.x - 4, pt.y - 4, 8, 8);
  }
  drawLabel(`${effectiveOutputWidth}\xD7${effectiveOutputHeight}`, fit.dx + fit.drawWidth / 2, fit.dy + fit.drawHeight - 14);
  if (padTop > 0) drawLabel(`T ${padTop}`, fit.dx + fit.drawWidth / 2, fit.dy + Math.max(12, (top - fit.dy) / 2));
  if (padBottom > 0) drawLabel(`B ${padBottom}`, fit.dx + fit.drawWidth / 2, top + innerHeight + Math.max(12, (fit.dy + fit.drawHeight - (top + innerHeight)) / 2));
  if (padLeft > 0) drawLabel(`L ${padLeft}`, fit.dx + Math.max(18, (left - fit.dx) / 2), fit.dy + fit.drawHeight / 2);
  if (padRight > 0) drawLabel(`R ${padRight}`, left + innerWidth + Math.max(18, (fit.dx + fit.drawWidth - (left + innerWidth)) / 2), fit.dy + fit.drawHeight / 2);
  ctx.restore();
  return {
    sourceWidth,
    sourceHeight,
    outputWidth: effectiveOutputWidth,
    outputHeight: effectiveOutputHeight,
    padLeft,
    padTop,
    padRight,
    padBottom,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight
  };
}
function drawFrameNumberOverlay(ctx, canvasSize, frameIndex) {
  if (frameIndex == null || !Number.isFinite(frameIndex)) return;
  const label = `f ${Math.max(0, Math.round(frameIndex)).toString().padStart(4, "0")}`;
  ctx.save();
  ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
  ctx.textBaseline = "top";
  const metrics = ctx.measureText(label);
  const padX = 7;
  const padY = 4;
  const x = 8;
  const w = Math.ceil(metrics.width + padX * 2);
  const h = 20;
  const y = Math.max(8, canvasSize - h - 8);
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText(label, x + padX, y + padY);
  ctx.restore();
}
function blit(node, st, source, canvasSize, sourceWidth, sourceHeight) {
  if (!st.canvas) return;
  hideNativeMediaPreview(st);
  const ctx = st.canvas.getContext("2d");
  if (!ctx) return;
  if (st.canvas.width !== canvasSize) st.canvas.width = canvasSize;
  if (st.canvas.height !== canvasSize) st.canvas.height = canvasSize;
  const imgEl = source;
  const vidEl = source;
  const canvasEl = source;
  const resolvedWidth = Math.max(
    1,
    Math.round(
      sourceWidth ?? (imgEl.naturalWidth > 0 ? imgEl.naturalWidth : void 0) ?? (vidEl.videoWidth > 0 ? vidEl.videoWidth : void 0) ?? canvasEl.width ?? 1
    )
  );
  const resolvedHeight = Math.max(
    1,
    Math.round(
      sourceHeight ?? (imgEl.naturalHeight > 0 ? imgEl.naturalHeight : void 0) ?? (vidEl.videoHeight > 0 ? vidEl.videoHeight : void 0) ?? canvasEl.height ?? 1
    )
  );
  st.previewSourceWidth = resolvedWidth;
  st.previewSourceHeight = resolvedHeight;
  const isNewSource = source !== st.previewLastSource;
  st.previewLastSource = source;
  let padOutFit = null;
  let padOutPl = 0, padOutPt = 0, padOutPr = 0, padOutPb = 0;
  let padOutSw = 0, padOutSh = 0;
  if (isPadOutNode(node)) {
    const snap = Math.max(1, Math.round(widgetNumber(node, "snap_to_multiple", 1)));
    const snapPad = (value) => snap <= 1 ? Math.max(0, Math.round(value)) : Math.max(0, Math.round(Math.round(value) / snap) * snap);
    padOutPl = snapPad(widgetNumber(node, "pad_left", 0));
    padOutPt = snapPad(widgetNumber(node, "pad_top", 0));
    padOutPr = snapPad(widgetNumber(node, "pad_right", 0));
    padOutPb = snapPad(widgetNumber(node, "pad_bottom", 0));
    if (isNewSource) {
      const srcW = Math.max(1, resolvedWidth - padOutPl - padOutPr);
      const srcH = Math.max(1, resolvedHeight - padOutPt - padOutPb);
      const opsW = source.width || canvasSize;
      const opsH = source.height || canvasSize;
      const srcAreaW = Math.max(1, opsW - padOutPl - padOutPr);
      const srcAreaH = Math.max(1, opsH - padOutPt - padOutPb);
      const srcAreaFit = getFitPlacement(srcAreaW, srcAreaH, srcW, srcH);
      const vx = padOutPl + srcAreaFit.dx;
      const vy = padOutPt + srcAreaFit.dy;
      const vw = Math.max(1, srcAreaFit.drawWidth);
      const vh = Math.max(1, srcAreaFit.drawHeight);
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = vw;
      srcCanvas.height = vh;
      srcCanvas.getContext("2d")?.drawImage(source, vx, vy, vw, vh, 0, 0, vw, vh);
      st.padOutSourceCanvas = srcCanvas;
      st.padOutSourceWidth = srcW;
      st.padOutSourceHeight = srcH;
    }
    padOutSw = st.padOutSourceWidth ?? 0;
    padOutSh = st.padOutSourceHeight ?? 0;
    if (padOutSw > 0) {
      padOutFit = getFitPlacement(
        canvasSize,
        canvasSize,
        padOutSw + padOutPl + padOutPr,
        padOutSh + padOutPt + padOutPb
      );
    }
  }
  const fit = getFitPlacement(canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  const zoom = Math.max(0.35, st.previewZoom ?? 1);
  const panX = st.previewPanX ?? 0;
  const panY = st.previewPanY ?? 0;
  const hasTransform = zoom !== 1 || panX !== 0 || panY !== 0;
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  if (hasTransform) {
    ctx.save();
    ctx.translate(canvasSize / 2 + panX, canvasSize / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvasSize / 2, -canvasSize / 2);
  }
  ctx.imageSmoothingEnabled = true;
  if (padOutFit && st.padOutSourceCanvas && padOutSw > 0) {
    const ow = padOutSw + padOutPl + padOutPr;
    const oh = padOutSh + padOutPt + padOutPb;
    const scX = padOutFit.drawWidth / Math.max(1, ow);
    const scY = padOutFit.drawHeight / Math.max(1, oh);
    ctx.fillStyle = "#000000";
    ctx.fillRect(padOutFit.dx, padOutFit.dy, padOutFit.drawWidth, padOutFit.drawHeight);
    ctx.drawImage(
      st.padOutSourceCanvas,
      padOutFit.dx + padOutPl * scX,
      padOutFit.dy + padOutPt * scY,
      padOutSw * scX,
      padOutSh * scY
    );
  } else {
    ctx.drawImage(source, fit.dx, fit.dy, fit.drawWidth, fit.drawHeight);
  }
  if (isDrawNode(node)) {
    st.drawGeometry = {
      sourceWidth: resolvedWidth,
      sourceHeight: resolvedHeight,
      fitDx: fit.dx,
      fitDy: fit.dy,
      fitDrawWidth: fit.drawWidth,
      fitDrawHeight: fit.drawHeight
    };
  } else {
    st.drawGeometry = null;
  }
  st.cropGeometry = drawCropBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  st.rampGeometry = drawRampBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  st.cornerPinGeometry = drawCornerPinBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  const effOW = padOutSw > 0 ? padOutSw + padOutPl + padOutPr : resolvedWidth;
  const effOH = padOutSh > 0 ? padOutSh + padOutPt + padOutPb : resolvedHeight;
  st.padOutGeometry = drawPadOutBounds(node, ctx, canvasSize, canvasSize, effOW, effOH, padOutSw, padOutSh);
  drawTransformBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  drawCompBounds(node, ctx, canvasSize, canvasSize, st.compOutputWidth || resolvedWidth, st.compOutputHeight || resolvedHeight, st.compLayers);
  drawOutputFormatBox(ctx, padOutFit ?? fit);
  if (hasTransform) ctx.restore();
  drawFrameNumberOverlay(ctx, canvasSize, st.previewFrameIndex);
}
function tryRenderNativePreview(node, st, canvasSize) {
  if (isCropNode(node) || isCompNode(node) || isDrawNode(node) || isPadOutNode(node) || isCornerPinNode(node) || isRampNode(node)) return false;
  if (st.nativeDirty) return false;
  if (showNativeMediaPreview(node, st, canvasSize)) {
    setInfo(st, "Node preview (media)");
    return true;
  }
  const img = getNativePreviewImage(node);
  if (!img) return false;
  if (!img.complete) {
    img.decode?.().catch(() => {
    });
    return false;
  }
  const sourceWidth = img.naturalWidth || img.width || 1;
  const sourceHeight = img.naturalHeight || img.height || 1;
  blit(node, st, img, canvasSize, sourceWidth, sourceHeight);
  setInfo(st, st.nativeAnimated ? "Node preview (animated)" : "Node preview");
  return true;
}
export {
  blit,
  drawCompBounds,
  drawCornerPinBounds,
  drawCropBounds,
  drawPadOutBounds,
  drawRampBounds,
  drawTransformBounds,
  tryRenderNativePreview
};
