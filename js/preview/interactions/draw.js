import {
  clampDrawDimension,
  clampDrawOpacity,
  clampDrawSize,
  clampDrawSoftness,
  normalizeDrawColor,
  normalizeDrawEdge,
  normalizeDrawOverlayFormat
} from "../draw.js";
import { canvasToDrawSourcePoint } from "../nodes/draw.js";
import { clampPreviewZoom, getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import { findWidget, setWidgetBooleanValue, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue, widgetBoolean, widgetNumber } from "../shared/widgets.js";
function attachInteractions(node, ctx) {
  const st = node.__imageops_state;
  if (!st?.canvas || st.drawInteractiveHooked) return;
  st.drawInteractiveHooked = true;
  const canvas = st.canvas;
  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : void 0;
  const worldPointer = (x, y) => {
    const zoom = st.previewZoom ?? 1;
    const panX = st.previewPanX ?? 0;
    const panY = st.previewPanY ?? 0;
    if (zoom === 1 && panX === 0 && panY === 0) return { x, y };
    return screenToWorld(x, y, zoom, panX, panY, canvas.width);
  };
  const canvasToSource = (x, y) => {
    const w = worldPointer(x, y);
    return canvasToDrawSourcePoint(st.drawGeometry, w.x, w.y);
  };
  let hoverRafPending = false;
  let panRafPending = false;
  const startPreviewPan = (event) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    st.previewPanDrag = {
      pointerId: event.pointerId,
      startCanvasX: (event.clientX - rect.left) * sx,
      startCanvasY: (event.clientY - rect.top) * sy,
      startPanX: st.previewPanX ?? 0,
      startPanY: st.previewPanY ?? 0
    };
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
    }
    canvas.style.cursor = "grabbing";
    return true;
  };
  const updatePreviewPan = (event) => {
    const drag = st.previewPanDrag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return true;
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    const cx = (event.clientX - rect.left) * sx;
    const cy = (event.clientY - rect.top) * sy;
    st.previewPanX = drag.startPanX + (cx - drag.startCanvasX);
    st.previewPanY = drag.startPanY + (cy - drag.startCanvasY);
    ctx.markPreviewInteraction(node);
    if (!panRafPending) {
      panRafPending = true;
      requestAnimationFrame(() => {
        panRafPending = false;
        void ctx.renderDrawNode(node, 0);
      });
    }
    return true;
  };
  const releasePreviewPan = (event) => {
    if (!st.previewPanDrag || st.previewPanDrag.pointerId !== event.pointerId) return false;
    st.previewPanDrag = null;
    canvas.style.cursor = event.ctrlKey || event.metaKey ? "grab" : "";
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
    }
    return true;
  };
  if (!st.drawGeometry || !st.drawCanvas) {
    void ctx.renderDrawNode(node, 0);
  }
  st.drawBrushButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.setDrawTool(node, "brush");
  }, listenerOptions);
  st.drawEraserButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.setDrawTool(node, "eraser");
  }, listenerOptions);
  st.drawClearButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.ensureDrawCanvasSize(node, st.drawCanvas?.width ?? widgetNumber(node, "width", 1024), st.drawCanvas?.height ?? widgetNumber(node, "height", 1024), false);
    const drawCtx = st.drawCanvas?.getContext("2d", { willReadFrequently: true });
    drawCtx?.clearRect(0, 0, st.drawCanvas?.width ?? 0, st.drawCanvas?.height ?? 0);
    st.drawUndoStack = [];
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  }, listenerOptions);
  st.drawColorInput?.addEventListener("input", () => {
    const color = normalizeDrawColor(st.drawColorInput?.value ?? "#FFFFFF", "#FFFFFF");
    setWidgetStringValuesByName(node, "brush_color", color);
    if (st.drawColorInput) {
      st.drawColorInput.value = color;
      ctx.syncDarkColorInputUI(st.drawColorInput, color);
    }
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  st.drawEdgeSelect?.addEventListener("change", () => {
    const edge = normalizeDrawEdge(st.drawEdgeSelect?.value ?? "hard");
    setWidgetStringValue(findWidget(node, "brush_edge"), edge);
    if (st.drawEdgeSelect) st.drawEdgeSelect.value = edge;
    ctx.syncDrawWidgets(node);
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  st.drawSoftnessInput?.addEventListener("input", () => {
    const softness = clampDrawSoftness(Number(st.drawSoftnessInput?.value ?? 50) / 100, 0.5);
    setWidgetValue(findWidget(node, "brush_softness"), softness);
    if (st.drawSoftnessLabel) st.drawSoftnessLabel.textContent = `${Math.round(softness * 100)}%`;
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  st.drawOpacityInput?.addEventListener("input", () => {
    const opacity = clampDrawOpacity(Number(st.drawOpacityInput?.value ?? 100) / 100, 1);
    setWidgetValue(findWidget(node, "brush_opacity"), opacity);
    if (st.drawOpacityLabel) st.drawOpacityLabel.textContent = `${Math.round(opacity * 100)}%`;
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  st.drawSizeInput?.addEventListener("input", () => {
    const size = clampDrawSize(Number(st.drawSizeInput?.value ?? 10), 10);
    ctx.setDrawBrushSize(node, size);
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  st.drawWidthInput?.addEventListener("change", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const width = clampDrawDimension(Number(st.drawWidthInput?.value ?? widgetNumber(node, "width", 1024)), widgetNumber(node, "width", 1024));
    setWidgetValue(findWidget(node, "width"), width);
    ctx.syncDrawWidgets(node, "width");
    ctx.ensureDrawCanvasSize(node, widgetNumber(node, "width", width), widgetNumber(node, "height", 1024), true);
    ctx.refreshNode(node);
  }, listenerOptions);
  st.drawHeightInput?.addEventListener("change", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const height = clampDrawDimension(Number(st.drawHeightInput?.value ?? widgetNumber(node, "height", 1024)), widgetNumber(node, "height", 1024));
    setWidgetValue(findWidget(node, "height"), height);
    ctx.syncDrawWidgets(node, "height");
    ctx.ensureDrawCanvasSize(node, widgetNumber(node, "width", 1024), widgetNumber(node, "height", height), true);
    ctx.refreshNode(node);
  }, listenerOptions);
  st.drawLinkButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const linked = !widgetBoolean(node, "sync_dimensions", true);
    setWidgetBooleanValue(findWidget(node, "sync_dimensions"), linked);
    ctx.syncDrawWidgets(node, "sync_dimensions");
    ctx.refreshNode(node);
  }, listenerOptions);
  st.drawBgColorInput?.addEventListener("input", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const color = normalizeDrawColor(st.drawBgColorInput?.value ?? "#000000", "#000000");
    setWidgetStringValuesByName(node, "bg_color", color);
    if (st.drawBgColorInput) {
      st.drawBgColorInput.value = color;
      ctx.syncDarkColorInputUI(st.drawBgColorInput, color);
    }
    ctx.refreshNode(node);
  }, listenerOptions);
  st.drawOverlayFormatSelect?.addEventListener("change", () => {
    const format = normalizeDrawOverlayFormat(st.drawOverlayFormatSelect?.value ?? "png");
    setWidgetStringValue(findWidget(node, "overlay_format"), format);
    if (st.drawOverlayFormatSelect) st.drawOverlayFormatSelect.value = format;
    if (!st.drawCanvas) {
      void ctx.renderDrawNode(node, 0).then(() => {
        ctx.updateDrawOverlayWidget(node);
        ctx.refreshNode(node);
      });
      return;
    }
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  }, listenerOptions);
  const syncDrawDynamics = () => {
    setWidgetBooleanValue(findWidget(node, "brush_pressure_size"), !!st.drawPressureSizeInput?.checked);
    setWidgetBooleanValue(findWidget(node, "brush_pressure_opacity"), !!st.drawPressureOpacityInput?.checked);
    setWidgetBooleanValue(findWidget(node, "brush_tilt_size"), !!st.drawTiltSizeInput?.checked);
    void ctx.renderDrawNode(node, 0);
  };
  st.drawPressureSizeInput?.addEventListener("change", syncDrawDynamics, listenerOptions);
  st.drawPressureOpacityInput?.addEventListener("change", syncDrawDynamics, listenerOptions);
  st.drawTiltSizeInput?.addEventListener("change", syncDrawDynamics, listenerOptions);
  const handleDrawWheel = (event) => {
    const target = event.target;
    if (target !== canvas && !canvas.contains(target)) return;
    if (!st.drawGeometry) return;
    if (event.ctrlKey || event.metaKey) {
      event.stopImmediatePropagation();
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const mx = (event.clientX - rect.left) * sx - canvas.width / 2;
      const my = (event.clientY - rect.top) * sy - canvas.height / 2;
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
      const prevZoom = st.previewZoom ?? 1;
      const newZoom = clampPreviewZoom(prevZoom * factor);
      const ratio = newZoom / Math.max(1e-3, prevZoom);
      st.previewPanX = mx - (mx - (st.previewPanX ?? 0)) * ratio;
      st.previewPanY = my - (my - (st.previewPanY ?? 0)) * ratio;
      st.previewZoom = newZoom;
      void ctx.renderDrawNode(node, 0);
      return;
    }
    const point = getCanvasPointer(canvas, event);
    const hover = canvasToSource(point.x, point.y);
    if (!hover.inside) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const current = widgetNumber(node, "brush_size", 10);
    const step = event.shiftKey ? 8 : 2;
    const direction = event.deltaY > 0 ? -step : step;
    ctx.setDrawBrushSize(node, current + direction);
    void ctx.renderDrawNode(node, 0);
  };
  const signal = st?._abortController?.signal;
  document.addEventListener("wheel", handleDrawWheel, { capture: true, passive: false, signal });
  let _drawWheelRemoved = false;
  st._drawWheelCleanup = () => {
    if (_drawWheelRemoved) return;
    _drawWheelRemoved = true;
    try {
      document.removeEventListener("wheel", handleDrawWheel, { capture: true });
    } catch {
    }
  };
  canvas.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    const snapshot = ctx.popDrawUndoSnapshot(node);
    if (!snapshot) return;
    ctx.ensureDrawCanvasSize(node, snapshot.width, snapshot.height, false);
    ctx.restoreCanvas(st.drawCanvas, snapshot);
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  }, listenerOptions);
  canvas.addEventListener("dblclick", () => {
    if ((st.previewZoom ?? 1) === 1 && (st.previewPanX ?? 0) === 0 && (st.previewPanY ?? 0) === 0) return;
    st.previewZoom = 1;
    st.previewPanX = 0;
    st.previewPanY = 0;
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  canvas.addEventListener("pointerdown", async (event) => {
    if ((event.ctrlKey || event.metaKey) && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      canvas.focus();
      startPreviewPan(event);
      return;
    }
    if (st.drawGeometry) {
      const point0 = getCanvasPointer(canvas, event);
      if (!canvasToSource(point0.x, point0.y).inside) return;
    }
    event.preventDefault();
    event.stopPropagation();
    canvas.focus();
    const ready = await ctx.ensureDrawInteractionReady(node);
    if (!ready || !st.drawGeometry) return;
    const point = getCanvasPointer(canvas, event);
    const mapped = canvasToSource(point.x, point.y);
    if (!mapped.inside) return;
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
    }
    if (!st.drawCanvas) {
      await ctx.renderDrawNode(node, 0);
    }
    const snapshot = ctx.cloneCanvas(st.drawCanvas);
    ctx.pushDrawUndoSnapshot(node, snapshot);
    st.drawStroke = {
      pointerId: event.pointerId,
      startX: mapped.x,
      startY: mapped.y,
      lastX: mapped.x,
      lastY: mapped.y,
      snapshot
    };
    st.drawHover = { canvasX: point.x, canvasY: point.y, inside: true };
    ctx.paintDrawSegment(node, mapped.x, mapped.y, mapped.x, mapped.y, ctx.drawPointerDynamics(node, event));
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  canvas.addEventListener("pointermove", (event) => {
    if (updatePreviewPan(event)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    canvas.style.cursor = event.ctrlKey || event.metaKey ? "grab" : "";
    const point = getCanvasPointer(canvas, event);
    if (st.drawGeometry) {
      const hoverMapped = canvasToSource(point.x, point.y);
      st.drawHover = { canvasX: point.x, canvasY: point.y, inside: hoverMapped.inside };
    } else {
      st.drawHover = null;
    }
    const drag = st.drawStroke;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (!hoverRafPending) {
        hoverRafPending = true;
        requestAnimationFrame(() => {
          hoverRafPending = false;
          void ctx.renderDrawNode(node, 0);
        });
      }
      return;
    }
    if (!st.drawGeometry) return;
    const mapped = canvasToSource(point.x, point.y);
    if (!mapped.inside) return;
    event.preventDefault();
    if (event.shiftKey) {
      ctx.restoreCanvas(st.drawCanvas, drag.snapshot);
      ctx.paintDrawSegment(node, drag.startX, drag.startY, mapped.x, mapped.y, ctx.drawPointerDynamics(node, event));
    } else {
      ctx.paintDrawSegment(node, drag.lastX, drag.lastY, mapped.x, mapped.y, ctx.drawPointerDynamics(node, event));
    }
    drag.lastX = mapped.x;
    drag.lastY = mapped.y;
    ctx.markPreviewInteraction(node);
    void ctx.renderDrawNode(node, 0);
  }, listenerOptions);
  const releaseStroke = (event) => {
    if (!st.drawStroke || st.drawStroke.pointerId !== event.pointerId) return;
    st.drawStroke = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
    }
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  };
  canvas.addEventListener("pointerup", (event) => {
    if (releasePreviewPan(event)) return;
    releaseStroke(event);
  }, listenerOptions);
  canvas.addEventListener("pointercancel", (event) => {
    if (releasePreviewPan(event)) return;
    releaseStroke(event);
  }, listenerOptions);
  canvas.addEventListener("lostpointercapture", (event) => {
    if (releasePreviewPan(event)) return;
    releaseStroke(event);
  }, listenerOptions);
  canvas.addEventListener("pointerleave", () => {
    if (!st.drawStroke && !st.previewPanDrag) {
      st.drawHover = null;
      canvas.style.cursor = "";
      void ctx.renderDrawNode(node, 0);
    }
  }, listenerOptions);
  canvas.addEventListener("pointerenter", () => {
    canvas.focus();
  }, listenerOptions);
}
export {
  attachInteractions
};
