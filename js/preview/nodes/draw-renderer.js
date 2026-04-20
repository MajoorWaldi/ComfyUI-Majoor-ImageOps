import { ensureState, setInfo, getRenderCanvasSize } from "../shared/state.js";
import { isNode as isDrawNode } from "./draw.js";
import { blit } from "../shared/bounds.js";
import { ensurePreviewWidget } from "../shared/preview-widget.js";
import { getInputOriginSlot, getUpstreamNode } from "../graph.js";
import { resolveNodeStreamPreview } from "../nodestream.js";
import {
  normalizeDrawColor,
  normalizeDrawEdge,
  normalizeDrawTool,
  clampDrawDimension,
  clampDrawOpacity,
  clampDrawSize,
  resizeCanvasPreserve,
  renderDrawPreview,
  resolveDrawOverlayCanvas
} from "../draw.js";
import { findWidget, widgetNumber, widgetString, widgetBoolean, setWidgetValue, setWidgetStringValue } from "../shared/widgets.js";
import { updateDrawToolButtons, updateDrawOverlayWidget, syncDrawWidgets, getDrawInfoText } from "./draw.js";
function strokeStyle(color, opacity) {
  const normalized = normalizeDrawColor(color, "#FFFFFF");
  const hex = normalized.startsWith("#") ? normalized.slice(1) : normalized;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clampDrawOpacity(opacity)})`;
}
function drawPointerDynamics(node, event) {
  const isPen = event?.pointerType === "pen";
  const pressure = isPen && Number.isFinite(event?.pressure ?? NaN) && (event?.pressure ?? 0) > 0 ? Math.max(0.05, Math.min(1, event?.pressure ?? 1)) : 1;
  const size = widgetBoolean(node, "brush_pressure_size", true) ? 0.2 + pressure * 0.8 : 1;
  const opacity = widgetBoolean(node, "brush_pressure_opacity", true) ? 0.15 + pressure * 0.85 : 1;
  const tiltX = Number(event?.tiltX ?? 0);
  const tiltY = Number(event?.tiltY ?? 0);
  const tilt = isPen && widgetBoolean(node, "brush_tilt_size", false) ? Math.min(1, Math.hypot(tiltX, tiltY) / 90) : 0;
  return { size: size * (1 + tilt * 0.65), opacity };
}
function paintDrawSegment(node, fromX, fromY, toX, toY, dynamics = { size: 1, opacity: 1 }) {
  const st = ensureState(node);
  const canvas = st.drawCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const tool = normalizeDrawTool(widgetString(node, "tool", "brush"));
  const edge = normalizeDrawEdge(widgetString(node, "brush_edge", "hard"));
  const brushSize = Math.max(1, clampDrawSize(widgetNumber(node, "brush_size", 10)) * Math.max(0.05, dynamics.size));
  const brushOpacity = clampDrawOpacity(widgetNumber(node, "brush_opacity", 1) * Math.max(0.05, dynamics.opacity), 1);
  const brushColor = widgetString(node, "brush_color", "#FFFFFF");
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = brushSize;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  if (tool === "eraser") {
    ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = `rgba(0,0,0,${brushOpacity})`;
  } else {
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = strokeStyle(brushColor, brushOpacity);
  }
  if (edge === "soft") {
    ctx.shadowColor = tool === "eraser" ? `rgba(0,0,0,${clampDrawOpacity(brushOpacity * 0.75)})` : strokeStyle(brushColor, clampDrawOpacity(brushOpacity * 0.75));
    ctx.shadowBlur = Math.max(2, brushSize * 0.4);
  }
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();
  if (edge === "soft" && tool !== "eraser") {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(1, brushSize * 0.55);
    ctx.strokeStyle = strokeStyle(brushColor, clampDrawOpacity(brushOpacity * 0.45));
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.stroke();
  }
  ctx.restore();
}
function drawBrushCursorOverlay(node, ctx) {
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
    ctx.shadowColor = tool === "eraser" ? "rgba(255,120,120,0.35)" : strokeStyle(color, Math.max(0.4, opacity * 0.85));
    ctx.shadowBlur = Math.max(4, radius * 0.45);
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
function cloneCanvas(source) {
  if (!source) return null;
  const copy = document.createElement("canvas");
  copy.width = Math.max(1, source.width || 1);
  copy.height = Math.max(1, source.height || 1);
  const ctx = copy.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, copy.width, copy.height);
  ctx.drawImage(source, 0, 0, copy.width, copy.height);
  return copy;
}
function restoreCanvas(target, snapshot) {
  if (!target || !snapshot) return;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(snapshot, 0, 0, target.width, target.height);
}
function pushDrawUndoSnapshot(node, snapshot) {
  if (!snapshot) return;
  const st = ensureState(node);
  st.drawUndoStack.push(snapshot);
  if (st.drawUndoStack.length > 20) {
    st.drawUndoStack.splice(0, st.drawUndoStack.length - 20);
  }
}
function popDrawUndoSnapshot(node) {
  const st = ensureState(node);
  return st.drawUndoStack.pop() ?? null;
}
function setDrawBrushSize(node, size) {
  const nextSize = clampDrawSize(size, widgetNumber(node, "brush_size", 10));
  setWidgetValue(findWidget(node, "brush_size"), nextSize);
  const st = ensureState(node);
  if (st.drawSizeInput) st.drawSizeInput.value = String(nextSize);
  if (st.drawSizeLabel) st.drawSizeLabel.textContent = String(nextSize);
  st.drawSizeHintUntil = performance.now() + 900;
}
function ensureDrawCanvasSize(node, width, height, persist = false) {
  const st = ensureState(node);
  st.drawCanvas = resizeCanvasPreserve(st.drawCanvas, width, height);
  if (persist) {
    updateDrawOverlayWidget(node);
  }
}
function deriveMaskCanvasFromCanvas(source) {
  const output = document.createElement("canvas");
  output.width = Math.max(1, source.width || 1);
  output.height = Math.max(1, source.height || 1);
  const octx = output.getContext("2d");
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
function maskToOpaqueDisplayCanvas(source) {
  const output = document.createElement("canvas");
  output.width = Math.max(1, source.width || 1);
  output.height = Math.max(1, source.height || 1);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  const image = octx.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const fromAlpha = data[index + 3];
    const lumaRaw = 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
    const fromLuma = Math.round(lumaRaw * (fromAlpha / 255));
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
async function renderDrawNode(node, tick, session) {
  const st = ensurePreviewWidget(node, session.progress, session.canvasSize);
  if (!st) return;
  const renderCanvasSize = session.canvasSize;
  const upstream = getUpstreamNode(node, 0);
  let baseCanvas = null;
  if (upstream) {
    const rendered = await session.renderer.render(upstream, tick, getInputOriginSlot(node, 0), renderCanvasSize);
    baseCanvas = rendered.canvas;
  }
  const previewCanvas = await renderDrawPreview(node, baseCanvas);
  st.drawBaseCanvas = baseCanvas;
  blit(node, st, previewCanvas, renderCanvasSize);
  const previewCtx = st.canvas?.getContext("2d");
  if (previewCtx) {
    drawBrushCursorOverlay(node, previewCtx);
  }
  syncDrawWidgets(node);
  setInfo(st, getDrawInfoText(node, previewCanvas.width || 1, previewCanvas.height || 1));
}
function setDrawTool(node, tool, session) {
  setWidgetStringValue(findWidget(node, "tool"), tool);
  updateDrawToolButtons(node);
  void renderDrawNode(node, 0, session);
}
async function ensureDrawInteractionReady(node, session) {
  const st = ensureState(node);
  if (!st.drawGeometry || !st.drawCanvas) {
    await renderDrawNode(node, 0, session);
  }
  const next = ensureState(node);
  return !!next.drawGeometry && !!next.drawCanvas;
}
async function renderDrawMaskCanvas(node, tick, session) {
  const upstream = getUpstreamNode(node, 0);
  let width = clampDrawDimension(widgetNumber(node, "width", 1024));
  let height = clampDrawDimension(widgetNumber(node, "height", 1024));
  if (upstream) {
    const rendered = await session.renderer.render(upstream, tick, getInputOriginSlot(node, 0), getRenderCanvasSize(ensureState(node)));
    if (rendered.canvas) {
      width = Math.max(1, rendered.canvas.width || width);
      height = Math.max(1, rendered.canvas.height || height);
    }
  }
  const overlay = await resolveDrawOverlayCanvas(node, width, height);
  const output = document.createElement("canvas");
  output.width = overlay.width || 1;
  output.height = overlay.height || 1;
  const octx = output.getContext("2d");
  const overlayCtx = overlay.getContext("2d");
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
async function renderMaskCanvasFromNode(upstream, tick, session, outputSlot = 1) {
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
async function renderMaskInputForComp(node, inputIndex, tick, session) {
  const upstream = getUpstreamNode(node, inputIndex);
  if (!upstream) return null;
  const outputSlot = getInputOriginSlot(node, inputIndex, 1);
  return await renderMaskCanvasFromNode(upstream, tick, session, outputSlot);
}
export {
  cloneCanvas,
  deriveMaskCanvasFromCanvas,
  drawBrushCursorOverlay,
  drawPointerDynamics,
  ensureDrawCanvasSize,
  ensureDrawInteractionReady,
  maskToOpaqueDisplayCanvas,
  paintDrawSegment,
  popDrawUndoSnapshot,
  pushDrawUndoSnapshot,
  renderDrawMaskCanvas,
  renderDrawNode,
  renderMaskCanvasFromNode,
  renderMaskInputForComp,
  restoreCanvas,
  setDrawBrushSize,
  setDrawTool,
  strokeStyle
};
