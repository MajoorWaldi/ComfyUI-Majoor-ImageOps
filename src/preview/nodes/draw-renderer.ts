import type { ComfyNode, DrawRenderSession } from "../../types.js";
import {
    clampDrawDimension,
    clampDrawOpacity,
    clampDrawSize,
    clampDrawSoftness,
    createOffscreenCanvas,
    normalizeDrawColor,
    normalizeDrawEdge,
    normalizeDrawTool,
    renderDrawPreview,
    resizeCanvasPreserve,
    resolveDrawOverlayCanvas,
} from "../draw.js";
import { getInputOriginSlot, getUpstreamNode } from "../graph.js";
import { resolveNodeStreamPreview } from "../nodestream.js";
import { blit } from "../shared/bounds.js";
import { ensurePreviewWidget } from "../shared/preview-widget.js";
import { ensureState, getRenderCanvasSize, setInfo } from "../shared/state.js";
import {
    findWidget,
    setWidgetStringValue,
    setWidgetValue,
    widgetBoolean,
    widgetNumber,
    widgetString,
} from "../shared/widgets.js";
import { resolveNodeIntrinsicMediaSize } from "../source.js";
import {
    getDrawInfoText,
    isNode as isDrawNode,
    syncDrawWidgets,
    updateDrawOverlayWidget,
    updateDrawToolButtons,
} from "./draw.js";

export function strokeStyle(color: string, opacity: number): string {
  const normalized = normalizeDrawColor(color, "#FFFFFF");
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampDrawOpacity(opacity)})`;
}

export function drawPointerDynamics(node: ComfyNode, event?: PointerEvent): { size: number; opacity: number } {
  const isPen = event?.pointerType === "pen";
  const pressure = isPen && Number.isFinite(event?.pressure ?? NaN) && (event?.pressure ?? 0) > 0
    ? Math.max(0.05, Math.min(1, event?.pressure ?? 1))
    : 1;
  const size = widgetBoolean(node, "brush_pressure_size", true)
    ? 0.2 + pressure * 0.8
    : 1;
  const opacity = widgetBoolean(node, "brush_pressure_opacity", true)
    ? 0.15 + pressure * 0.85
    : 1;
  const tiltX = Number(event?.tiltX ?? 0);
  const tiltY = Number(event?.tiltY ?? 0);
  const tilt = isPen && widgetBoolean(node, "brush_tilt_size", false)
    ? Math.min(1, Math.hypot(tiltX, tiltY) / 90)
    : 0;
  return { size: size * (1 + tilt * 0.65), opacity };
}

export function paintDrawSegment(node: ComfyNode, fromX: number, fromY: number, toX: number, toY: number, dynamics = { size: 1, opacity: 1 }): void {
  const st = ensureState(node);
  const canvas = st.drawCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  const edge = normalizeDrawEdge(widgetString(node, "brush_edge", "hard"));
  const softness = clampDrawSoftness(widgetNumber(node, "brush_softness", 0.5), 0.5);
  const brushSize = Math.max(1, clampDrawSize(widgetNumber(node, "brush_size", 10)) * Math.max(0.05, dynamics.size));
  const brushOpacity = clampDrawOpacity(widgetNumber(node, "brush_opacity", 1) * Math.max(0.05, dynamics.opacity), 1);
  const brushColor = widgetString(node, "brush_color", "#FFFFFF");
  ctx.save();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  if (edge === "soft" && softness > 0.01) {
    // Stamp a precomputed radial-gradient brush along the segment. This gives
    // a true Gaussian-like falloff whose softness is fully user-controlled,
    // unlike the previous shadowBlur trick which capped at ~40% of the brush.
    const stamp = buildSoftBrushStamp(brushSize, softness, brushColor, brushOpacity, tool);
    ctx.globalCompositeOperation = tool === "eraser" ? "destination-out" : "source-over";
    const stampSize = stamp.width;
    const half = stampSize / 2;
    // Stamp spacing: 12% of brush size keeps strokes continuous without
    // melting opacity to 100% on every overlap.
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const step = Math.max(0.5, brushSize * 0.12);
    const count = Math.max(1, Math.ceil(dist / step));
    for (let i = 0; i <= count; i++) {
      const t = count === 0 ? 0 : i / count;
      const x = fromX + dx * t;
      const y = fromY + dy * t;
      ctx.drawImage(stamp, x - half, y - half);
    }
  } else {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = `rgba(0,0,0,${brushOpacity})`;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = strokeStyle(brushColor, brushOpacity);
    }
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  }
  ctx.restore();
}

// Cache the latest soft-brush stamp so a continuous stroke at fixed settings
// doesn't allocate a new canvas on every segment.
let _softStampCache: {
  size: number;
  softness: number;
  color: string;
  opacity: number;
  tool: "brush" | "eraser";
  canvas: any;
} | null = null;

function buildSoftBrushStamp(
  brushSize: number,
  softness: number,
  color: string,
  opacity: number,
  tool: "brush" | "eraser",
): any {
  const sizePx = Math.max(2, Math.ceil(brushSize));
  // Quantise size/opacity to keep the cache hit-rate high during a stroke.
  const sizeKey = sizePx;
  const softKey = Math.round(softness * 100) / 100;
  const opacityKey = Math.round(opacity * 100) / 100;
  if (
    _softStampCache
    && _softStampCache.size === sizeKey
    && _softStampCache.softness === softKey
    && _softStampCache.color === color
    && _softStampCache.opacity === opacityKey
    && _softStampCache.tool === tool
  ) {
    return _softStampCache.canvas;
  }
  const stamp = createOffscreenCanvas(sizePx, sizePx);
  stamp.width = stamp.height = sizePx;
  const sctx = stamp.getContext("2d", { willReadFrequently: true })!;
  const r = sizePx / 2;
  // innerR = 0 means fully feathered (gradient starts at the centre), innerR = r
  // means perfectly hard. softness=0 -> innerR very close to r (almost hard),
  // softness=1 -> innerR=0 (full falloff from centre).
  const innerR = Math.max(0, r * (1 - softness));
  // For the eraser, stamp colour is irrelevant — only alpha drives destination-out.
  const stampColor = tool === "eraser" ? "#FFFFFF" : color;
  const grad = sctx.createRadialGradient(r, r, innerR, r, r, r);
  grad.addColorStop(0, strokeStyle(stampColor, opacity));
  // Quadratic falloff (smoother than linear) for a Photoshop-style soft edge.
  if (innerR < r) {
    grad.addColorStop(0.5, strokeStyle(stampColor, opacity * 0.55));
    grad.addColorStop(0.85, strokeStyle(stampColor, opacity * 0.12));
  }
  grad.addColorStop(1, strokeStyle(stampColor, 0));
  sctx.fillStyle = grad;
  sctx.beginPath();
  sctx.arc(r, r, r, 0, Math.PI * 2);
  sctx.fill();
  _softStampCache = {
    size: sizeKey,
    softness: softKey,
    color,
    opacity: opacityKey,
    tool,
    canvas: stamp,
  };
  return stamp;
}

export function drawBrushCursorOverlay(node: ComfyNode, ctx: CanvasRenderingContext2D): void {
  const st = ensureState(node);
  const hover = st.drawHover;
  const geometry = st.drawGeometry;
  if (!isDrawNode(node) || !hover?.inside || !geometry) return;
  const sourceRadius = clampDrawSize(widgetNumber(node, "brush_size", 10)) / 2;
  const zoom = Math.max(0.35, st.previewZoom ?? 1);
  const radius = Math.max(2, sourceRadius * zoom * geometry.fitDrawWidth / Math.max(1, geometry.sourceWidth));
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  const edge = normalizeDrawEdge(widgetString(node, "brush_edge", "hard"));
  const color = normalizeDrawColor(widgetString(node, "brush_color", "#FFFFFF"), "#FFFFFF");
  const opacity = clampDrawOpacity(widgetNumber(node, "brush_opacity", 1), 1);
  ctx.save();
  ctx.setLineDash(tool === "eraser" ? [5, 3] : []);
  if (edge === "soft") {
    const softness = clampDrawSoftness(widgetNumber(node, "brush_softness", 0.5), 0.5);
    ctx.shadowColor = tool === "eraser" ? "rgba(255,120,120,0.35)" : strokeStyle(color, Math.max(0.4, opacity * 0.85));
    // Cursor blur scales with softness so the user sees what their brush will do.
    ctx.shadowBlur = Math.max(0, radius * 0.9 * softness);
  }
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = tool === "eraser" ? "rgba(255,120,120,0.95)" : strokeStyle(color, Math.max(0.45, opacity));
  ctx.fillStyle = tool === "eraser" ? "rgba(255,80,80,0.16)" : strokeStyle(color, Math.max(0.16, opacity * 0.4));
  ctx.beginPath();
  ctx.arc(hover.canvasX, hover.canvasY, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = tool === "eraser" ? "rgba(255,120,120,0.9)" : strokeStyle(color, Math.max(0.7, opacity));
  ctx.fillRect(hover.canvasX - 1.5, hover.canvasY - 1.5, 3, 3);

  if (st.drawSizeHintUntil > performance.now()) {
    const size = clampDrawSize(widgetNumber(node, "brush_size", 10));
    const text = `Size ${size}`;
    ctx.font = "11px sans-serif";
    const metrics = ctx.measureText(text);
    const paddingX = 6;
    const bubbleWidth = Math.ceil(metrics.width) + paddingX * 2;
    const bubbleHeight = 20;
    const bubbleX = hover.canvasX + radius + 10;
    const bubbleY = hover.canvasY - bubbleHeight - 10;
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fillText(text, bubbleX + paddingX, bubbleY + bubbleHeight - 7);
  }
  ctx.restore();
}

export function cloneCanvas(source: HTMLCanvasElement | null): any {
  if (!source) return null;
  const copy = createOffscreenCanvas(Math.max(1, source.width || 1), Math.max(1, source.height || 1));
  const ctx = copy.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.clearRect(0, 0, copy.width, copy.height);
  ctx.drawImage(source, 0, 0, copy.width, copy.height);
  return copy;
}

export function restoreCanvas(target: HTMLCanvasElement | null, snapshot: HTMLCanvasElement | null): void {
  if (!target || !snapshot) return;
  const ctx = target.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(snapshot, 0, 0, target.width, target.height);
}

export function pushDrawUndoSnapshot(node: ComfyNode, snapshot: HTMLCanvasElement | null): void {
  if (!snapshot) return;
  const st = ensureState(node);
  st.drawUndoStack.push(snapshot);
  if (st.drawUndoStack.length > 20) {
    st.drawUndoStack.splice(0, st.drawUndoStack.length - 20);
  }
}

export function popDrawUndoSnapshot(node: ComfyNode): HTMLCanvasElement | null {
  const st = ensureState(node);
  return st.drawUndoStack.pop() ?? null;
}

export function setDrawBrushSize(node: ComfyNode, size: number): void {
  const nextSize = clampDrawSize(size, widgetNumber(node, "brush_size", 10));
  setWidgetValue(findWidget(node, "brush_size"), nextSize);
  const st = ensureState(node);
  if (st.drawSizeInput) st.drawSizeInput.value = String(nextSize);
  if (st.drawSizeLabel) st.drawSizeLabel.textContent = String(nextSize);
  st.drawSizeHintUntil = performance.now() + 900;
}

export function ensureDrawCanvasSize(node: ComfyNode, width: number, height: number, persist: boolean = false): void {
  const st = ensureState(node);
  st.drawCanvas = resizeCanvasPreserve(st.drawCanvas, width, height);
  if (persist) {
    updateDrawOverlayWidget(node);
  }
}

export function deriveMaskCanvasFromCanvas(source: HTMLCanvasElement): any {
  const output = createOffscreenCanvas(Math.max(1, source.width || 1), Math.max(1, source.height || 1));
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  const image = octx.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const luma = Math.max(0, Math.min(1, 0.2126 * (data[index] / 255) + 0.7152 * (data[index + 1] / 255) + 0.0722 * (data[index + 2] / 255)));
    const matte = Math.round(Math.max(0, Math.min(1, luma * alpha)) * 255);
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  return output;
}

/**
 * Convert any mask canvas (prepared or display format) to an opaque white-on-black
 * display canvas: any pixel with matte > 0 → RGB=255, A=255; otherwise RGB=0, A=255.
 * Used exclusively for the Preview bridge display — not for the compositing pipeline.
 */
export function maskToOpaqueDisplayCanvas(source: HTMLCanvasElement): any {
  const output = createOffscreenCanvas(Math.max(1, source.width || 1), Math.max(1, source.height || 1));
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  const image = octx.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    // Prepared mask: R=G=B=255, A=matte → use A as matte value
    // Display/RGB mask: R=G=B=matte, A=255 → use luma as matte value
    const fromAlpha = data[index + 3]; // matte if prepared
    const lumaRaw = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    const fromLuma = Math.round(lumaRaw * (fromAlpha / 255)); // matte if display-format
    const matte = Math.max(fromAlpha, fromLuma);
    const v = matte > 0 ? 255 : 0;
    data[index] = v;
    data[index + 1] = v;
    data[index + 2] = v;
    data[index + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  return output;
}

// ── Render functions (need renderer via session) ──

export async function renderDrawNode(node: ComfyNode, tick: number, session: DrawRenderSession): Promise<void> {
  const st = ensurePreviewWidget(node, session.progress, session.canvasSize);
  if (!st) return;
  // Draw nodes must always render at the session's full canvasSize.
  // getRenderCanvasSize() returns a smaller interactionCanvasSize (320px) during active
  // strokes, which would shift the zoom centre (half = canvasSize/2) relative to the
  // values stored in st.previewZoom/panX/panY — causing a systematic offset between
  // the brush cursor and the painted pixel.  Use the fixed session size instead.
  const renderCanvasSize = session.canvasSize;
  const upstream = getUpstreamNode(node, 0);
  let baseCanvas: HTMLCanvasElement | null = null;
  let inputSize: { width: number; height: number } | null = null;
  if (upstream) {
    const rendered = await session.renderer.render(upstream, tick, getInputOriginSlot(node, 0), renderCanvasSize);
    baseCanvas = rendered.canvas;
    inputSize = resolveNodeIntrinsicMediaSize(upstream, baseCanvas);
  }
  const previewCanvas = await renderDrawPreview(node, baseCanvas, inputSize);
  st.drawBaseCanvas = baseCanvas;
  blit(node, st, previewCanvas, renderCanvasSize);
  const previewCtx = st.canvas?.getContext("2d", { willReadFrequently: true });
  if (previewCtx) {
    drawBrushCursorOverlay(node, previewCtx);
  }
  syncDrawWidgets(node);
  setInfo(st, getDrawInfoText(node, previewCanvas.width || 1, previewCanvas.height || 1));
}

export function setDrawTool(node: ComfyNode, tool: "brush" | "eraser", session: DrawRenderSession): void {
  setWidgetStringValue(findWidget(node, "tool"), tool);
  updateDrawToolButtons(node);
  void renderDrawNode(node, 0, session);
}

export async function ensureDrawInteractionReady(node: ComfyNode, session: DrawRenderSession): Promise<boolean> {
  const st = ensureState(node);
  if (!st.drawGeometry || !st.drawCanvas) {
    await renderDrawNode(node, 0, session);
  }
  const next = ensureState(node);
  return !!next.drawGeometry && !!next.drawCanvas;
}

export async function renderDrawMaskCanvas(node: ComfyNode, tick: number, session: DrawRenderSession): Promise<any> {
  const upstream = getUpstreamNode(node, 0);
  let width = clampDrawDimension(widgetNumber(node, "width", 1024));
  let height = clampDrawDimension(widgetNumber(node, "height", 1024));
  if (upstream) {
    const rendered = await session.renderer.render(upstream, tick, getInputOriginSlot(node, 0), getRenderCanvasSize(ensureState(node)));
    if (rendered.canvas) {
      const sourceSize = resolveNodeIntrinsicMediaSize(upstream, rendered.canvas);
      width = Math.max(1, sourceSize.width || rendered.canvas.width || width);
      height = Math.max(1, sourceSize.height || rendered.canvas.height || height);
    }
  }
  const overlay = await resolveDrawOverlayCanvas(node, width, height);
  const output = createOffscreenCanvas(overlay.width || 1, overlay.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  const overlayCtx = overlay.getContext("2d", { willReadFrequently: true });
  if (!overlayCtx) return output;
  const image = overlayCtx.getImageData(0, 0, overlay.width || 1, overlay.height || 1);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const matte = data[index + 3];
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  return output;
}

export async function renderMaskCanvasFromNode(upstream: ComfyNode, tick: number, session: DrawRenderSession, outputSlot: number | null = 1): Promise<HTMLCanvasElement | null> {
  if (isDrawNode(upstream) && outputSlot === 2) {
    return await renderDrawMaskCanvas(upstream, tick, session);
  }
  const renderCanvasSize = getRenderCanvasSize(ensureState(upstream));
  const rendered = await session.renderer.render(upstream, tick, outputSlot, renderCanvasSize);
  if (rendered.canvas) {
    return rendered.canvas;
  }
  const nodeStream = await resolveNodeStreamPreview(upstream, renderCanvasSize);
  if (!nodeStream?.canvas) return null;
  return deriveMaskCanvasFromCanvas(nodeStream.canvas);
}

export async function renderMaskInputForComp(node: ComfyNode, inputIndex: number, tick: number, session: DrawRenderSession): Promise<HTMLCanvasElement | null> {
  const upstream = getUpstreamNode(node, inputIndex);
  if (!upstream) return null;
  const outputSlot = getInputOriginSlot(node, inputIndex, 1);
  return await renderMaskCanvasFromNode(upstream, tick, session, outputSlot);
}
