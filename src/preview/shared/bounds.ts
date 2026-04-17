import type { ComfyNode, NodeState, CropPreviewGeometry, CompLayerPreviewGeometry, CornerPinPreviewGeometry, CornerPinHandle, PadOutPreviewGeometry } from "../../types.js";
import { ensureState, setInfo } from "./state.js";
import { getFitPlacement, drawFitSource, drawOutputFormatBox } from "./geometry.js";
import { widgetNumber } from "./widgets.js";
import { hideNativeMediaPreview, showNativeMediaPreview, getNativePreviewImage } from "./media.js";
import { isNode as isCropNode, getCropControlState, getCropCanvasMetrics } from "../nodes/crop.js";
import { computeCropRect } from "../crop.js";
import type { CropRect } from "../crop.js";
import { isNode as isCompNode, getCompCanvasMetrics } from "../nodes/comp.js";
import { isNode as isCornerPinNode, cornerPinControlPoints } from "../nodes/corner-pin.js";
import { isNode as isPadOutNode } from "../nodes/pad-out.js";
import { isNode as isDrawNode } from "../nodes/draw.js";

export function drawTransformBounds(
  node: ComfyNode,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): void {
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
    { x: 0, y: sourceHeight },
  ].map((point) => {
    const localX = (point.x - cx) * scale;
    const localY = (point.y - cy) * scale;
    return {
      x: localX * cos - localY * sin + cx + tx,
      y: localX * sin + localY * cos + cy + ty,
    };
  });

  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const scaleX = fit.drawWidth / Math.max(1, sourceWidth);
  const scaleY = fit.drawHeight / Math.max(1, sourceHeight);
  const mapped = corners.map((point) => ({
    x: fit.dx + point.x * scaleX,
    y: fit.dy + point.y * scaleY,
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

export function drawCropBounds(
  node: ComfyNode,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): CropPreviewGeometry | null {
  if (!isCropNode(node)) return null;

  const state = getCropControlState(node, sourceWidth, sourceHeight);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    state.aspectRatio,
    state.centerX,
    state.centerY,
    state.scale,
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
  const drawCorner = (x: number, y: number, sx: number, sy: number): void => {
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
      coordinateSpace: "source",
    },
  };
}

export function drawCompBounds(
  node: ComfyNode,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  layers: CompLayerPreviewGeometry[],
): void {
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

export function drawCornerPinBounds(
  node: ComfyNode,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
): CornerPinPreviewGeometry | null {
  if (!isCornerPinNode(node)) return null;
  const fit = getFitPlacement(width, height, sourceWidth, sourceHeight);
  const geometry: CornerPinPreviewGeometry = {
    sourceWidth,
    sourceHeight,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight,
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

  const labels: Record<CornerPinHandle, string> = { tl: "TL", tr: "TR", bl: "BL", br: "BR" };
  for (const key of ["tl", "tr", "bl", "br"] as CornerPinHandle[]) {
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

export function drawPadOutBounds(
  node: ComfyNode,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  outputWidth: number,
  outputHeight: number,
): PadOutPreviewGeometry | null {
  if (!isPadOutNode(node)) return null;
  const padLeft = Math.max(0, Math.round(widgetNumber(node, "pad_left", 0)));
  const padTop = Math.max(0, Math.round(widgetNumber(node, "pad_top", 0)));
  const padRight = Math.max(0, Math.round(widgetNumber(node, "pad_right", 0)));
  const padBottom = Math.max(0, Math.round(widgetNumber(node, "pad_bottom", 0)));
  const sourceWidth = Math.max(1, outputWidth - padLeft - padRight);
  const sourceHeight = Math.max(1, outputHeight - padTop - padBottom);
  const fit = getFitPlacement(width, height, outputWidth, outputHeight);
  const scaleX = fit.drawWidth / Math.max(1, outputWidth);
  const scaleY = fit.drawHeight / Math.max(1, outputHeight);
  const left = fit.dx + padLeft * scaleX;
  const top = fit.dy + padTop * scaleY;
  const innerWidth = sourceWidth * scaleX;
  const innerHeight = sourceHeight * scaleY;

  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath();
  ctx.rect(fit.dx, fit.dy, fit.drawWidth, fit.drawHeight);
  ctx.rect(left, top, innerWidth, innerHeight);
  ctx.fill("evenodd");

  ctx.strokeStyle = "rgba(98, 224, 255, 0.96)";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(left + 0.5, top + 0.5, innerWidth, innerHeight);

  const points = [
    { x: left, y: top },
    { x: left + innerWidth, y: top },
    { x: left, y: top + innerHeight },
    { x: left + innerWidth, y: top + innerHeight },
  ];
  ctx.fillStyle = "rgba(98, 224, 255, 0.95)";
  for (const point of points) {
    ctx.fillRect(point.x - 3, point.y - 3, 6, 6);
  }
  ctx.restore();

  return {
    sourceWidth,
    sourceHeight,
    outputWidth,
    outputHeight,
    padLeft,
    padTop,
    padRight,
    padBottom,
    fitDx: fit.dx,
    fitDy: fit.dy,
    fitDrawWidth: fit.drawWidth,
    fitDrawHeight: fit.drawHeight,
  };
}

export function blit(
  node: ComfyNode,
  st: NodeState,
  source: CanvasImageSource,
  canvasSize: number,
  sourceWidth?: number,
  sourceHeight?: number,
): void {
  if (!st.canvas) return;
  hideNativeMediaPreview(st);
  const ctx = st.canvas.getContext("2d");
  if (!ctx) return;
  if (st.canvas.width !== canvasSize) st.canvas.width = canvasSize;
  if (st.canvas.height !== canvasSize) st.canvas.height = canvasSize;
  const resolvedWidth = Math.max(
    1,
    Math.round(
      sourceWidth
      ?? (source as HTMLImageElement).naturalWidth
      ?? (source as HTMLVideoElement).videoWidth
      ?? (source as HTMLCanvasElement).width
      ?? 1,
    ),
  );
  const resolvedHeight = Math.max(
    1,
    Math.round(
      sourceHeight
      ?? (source as HTMLImageElement).naturalHeight
      ?? (source as HTMLVideoElement).videoHeight
      ?? (source as HTMLCanvasElement).height
      ?? 1,
    ),
  );

  st.previewLastSource = source;
  const fit = getFitPlacement(canvasSize, canvasSize, resolvedWidth, resolvedHeight);

  // Draw manages its own wheel event (brush size) — zoom/pan is disabled for it only.
  const noZoomPan = isDrawNode(node);
  const zoom = noZoomPan ? 1 : Math.max(0.35, st.previewZoom ?? 1);
  const panX = noZoomPan ? 0 : (st.previewPanX ?? 0);
  const panY = noZoomPan ? 0 : (st.previewPanY ?? 0);
  const hasTransform = zoom !== 1 || panX !== 0 || panY !== 0;

  ctx.clearRect(0, 0, canvasSize, canvasSize);
  if (hasTransform) {
    ctx.save();
    ctx.translate(canvasSize / 2 + panX, canvasSize / 2 + panY);
    ctx.scale(zoom, zoom);
    ctx.translate(-canvasSize / 2, -canvasSize / 2);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, fit.dx, fit.dy, fit.drawWidth, fit.drawHeight);

  if (isDrawNode(node)) {
    st.drawGeometry = {
      sourceWidth: resolvedWidth,
      sourceHeight: resolvedHeight,
      fitDx: fit.dx,
      fitDy: fit.dy,
      fitDrawWidth: fit.drawWidth,
      fitDrawHeight: fit.drawHeight,
    };
  } else {
    st.drawGeometry = null;
  }
  st.cropGeometry = drawCropBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  st.cornerPinGeometry = drawCornerPinBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  st.padOutGeometry = drawPadOutBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  drawTransformBounds(node, ctx, canvasSize, canvasSize, resolvedWidth, resolvedHeight);
  drawCompBounds(node, ctx, canvasSize, canvasSize, st.compOutputWidth || resolvedWidth, st.compOutputHeight || resolvedHeight, st.compLayers);
  drawOutputFormatBox(ctx, fit);

  if (hasTransform) ctx.restore();
}

export function tryRenderNativePreview(node: ComfyNode, st: NodeState, canvasSize: number): boolean {
  if (isCropNode(node) || isCompNode(node) || isDrawNode(node) || isPadOutNode(node) || isCornerPinNode(node)) return false;
  if (st.nativeDirty) return false;
  if (showNativeMediaPreview(node, st, canvasSize)) {
    setInfo(st, "Node preview (media)");
    return true;
  }
  const img = getNativePreviewImage(node);
  if (!img) return false;
  if (!img.complete) {
    img.decode?.().catch(() => {});
    return false;
  }

  const sourceWidth = img.naturalWidth || img.width || 1;
  const sourceHeight = img.naturalHeight || img.height || 1;
  blit(node, st, img, canvasSize, sourceWidth, sourceHeight);
  setInfo(st, st.nativeAnimated ? "Node preview (animated)" : "Node preview");
  return true;
}
