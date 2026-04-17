import {
  normalizeDrawColor,
  normalizeDrawEdge,
  normalizeDrawOverlayFormat,
  clampDrawOpacity,
  clampDrawSize,
  clampDrawDimension
} from "../draw.js";
import { canvasToDrawSourcePoint } from "../nodes/draw.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, widgetNumber, widgetBoolean, setWidgetValue, setWidgetStringValue, setWidgetBooleanValue } from "../shared/widgets.js";
function attachInteractions(node, ctx) {
  const st = node.__imageops_state;
  if (!st?.canvas || st.drawInteractiveHooked) return;
  st.drawInteractiveHooked = true;
  const canvas = st.canvas;
  if (!st.drawGeometry || !st.drawCanvas) {
    void ctx.renderDrawNode(node, 0);
  }
  st.drawBrushButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.setDrawTool(node, "brush");
  });
  st.drawEraserButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.setDrawTool(node, "eraser");
  });
  st.drawClearButton?.addEventListener("click", (event) => {
    event.preventDefault();
    ctx.ensureDrawCanvasSize(node, st.drawCanvas?.width ?? widgetNumber(node, "width", 1024), st.drawCanvas?.height ?? widgetNumber(node, "height", 1024), false);
    const drawCtx = st.drawCanvas?.getContext("2d");
    drawCtx?.clearRect(0, 0, st.drawCanvas?.width ?? 0, st.drawCanvas?.height ?? 0);
    st.drawUndoStack = [];
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  });
  st.drawColorInput?.addEventListener("input", () => {
    const color = normalizeDrawColor(st.drawColorInput?.value ?? "#FFFFFF", "#FFFFFF");
    setWidgetStringValue(findWidget(node, "brush_color"), color);
    if (st.drawColorInput) {
      st.drawColorInput.value = color;
      ctx.syncDarkColorInputUI(st.drawColorInput, color);
    }
    void ctx.renderDrawNode(node, 0);
  });
  st.drawEdgeSelect?.addEventListener("change", () => {
    const edge = normalizeDrawEdge(st.drawEdgeSelect?.value ?? "hard");
    setWidgetStringValue(findWidget(node, "brush_edge"), edge);
    if (st.drawEdgeSelect) st.drawEdgeSelect.value = edge;
    void ctx.renderDrawNode(node, 0);
  });
  st.drawOpacityInput?.addEventListener("input", () => {
    const opacity = clampDrawOpacity(Number(st.drawOpacityInput?.value ?? 100) / 100, 1);
    setWidgetValue(findWidget(node, "brush_opacity"), opacity);
    if (st.drawOpacityLabel) st.drawOpacityLabel.textContent = `${Math.round(opacity * 100)}%`;
    void ctx.renderDrawNode(node, 0);
  });
  st.drawSizeInput?.addEventListener("input", () => {
    const size = clampDrawSize(Number(st.drawSizeInput?.value ?? 10), 10);
    ctx.setDrawBrushSize(node, size);
    void ctx.renderDrawNode(node, 0);
  });
  st.drawWidthInput?.addEventListener("change", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const width = clampDrawDimension(Number(st.drawWidthInput?.value ?? widgetNumber(node, "width", 1024)), widgetNumber(node, "width", 1024));
    setWidgetValue(findWidget(node, "width"), width);
    ctx.syncDrawWidgets(node, "width");
    ctx.ensureDrawCanvasSize(node, widgetNumber(node, "width", width), widgetNumber(node, "height", 1024), true);
    ctx.refreshNode(node);
  });
  st.drawHeightInput?.addEventListener("change", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const height = clampDrawDimension(Number(st.drawHeightInput?.value ?? widgetNumber(node, "height", 1024)), widgetNumber(node, "height", 1024));
    setWidgetValue(findWidget(node, "height"), height);
    ctx.syncDrawWidgets(node, "height");
    ctx.ensureDrawCanvasSize(node, widgetNumber(node, "width", 1024), widgetNumber(node, "height", height), true);
    ctx.refreshNode(node);
  });
  st.drawLinkButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const linked = !widgetBoolean(node, "sync_dimensions", true);
    setWidgetBooleanValue(findWidget(node, "sync_dimensions"), linked);
    ctx.syncDrawWidgets(node, "sync_dimensions");
    ctx.refreshNode(node);
  });
  st.drawBgColorInput?.addEventListener("input", () => {
    if ((node.inputs?.[0]?.link ?? null) != null) return;
    const color = normalizeDrawColor(st.drawBgColorInput?.value ?? "#000000", "#000000");
    setWidgetStringValue(findWidget(node, "bg_color"), color);
    if (st.drawBgColorInput) {
      st.drawBgColorInput.value = color;
      ctx.syncDarkColorInputUI(st.drawBgColorInput, color);
    }
    ctx.refreshNode(node);
  });
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
  });
  const syncDrawDynamics = () => {
    setWidgetBooleanValue(findWidget(node, "brush_pressure_size"), !!st.drawPressureSizeInput?.checked);
    setWidgetBooleanValue(findWidget(node, "brush_pressure_opacity"), !!st.drawPressureOpacityInput?.checked);
    setWidgetBooleanValue(findWidget(node, "brush_tilt_size"), !!st.drawTiltSizeInput?.checked);
    void ctx.renderDrawNode(node, 0);
  };
  st.drawPressureSizeInput?.addEventListener("change", syncDrawDynamics);
  st.drawPressureOpacityInput?.addEventListener("change", syncDrawDynamics);
  st.drawTiltSizeInput?.addEventListener("change", syncDrawDynamics);
  canvas.addEventListener("wheel", (event) => {
    if (!st.drawGeometry) return;
    const point = getCanvasPointer(canvas, event);
    const hover = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
    if (!hover.inside) return;
    event.preventDefault();
    const current = widgetNumber(node, "brush_size", 10);
    const step = event.shiftKey ? 8 : 2;
    const direction = event.deltaY > 0 ? -step : step;
    ctx.setDrawBrushSize(node, current + direction);
    void ctx.renderDrawNode(node, 0);
  }, { passive: false });
  canvas.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
    event.preventDefault();
    const snapshot = ctx.popDrawUndoSnapshot(node);
    if (!snapshot) return;
    ctx.ensureDrawCanvasSize(node, snapshot.width, snapshot.height, false);
    ctx.restoreCanvas(st.drawCanvas, snapshot);
    ctx.updateDrawOverlayWidget(node);
    ctx.refreshNode(node);
  });
  canvas.addEventListener("pointerdown", async (event) => {
    if (st.drawGeometry) {
      const point0 = getCanvasPointer(canvas, event);
      if (!canvasToDrawSourcePoint(st.drawGeometry, point0.x, point0.y).inside) return;
    }
    event.preventDefault();
    canvas.focus();
    const ready = await ctx.ensureDrawInteractionReady(node);
    if (!ready || !st.drawGeometry) return;
    const point = getCanvasPointer(canvas, event);
    const mapped = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
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
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = getCanvasPointer(canvas, event);
    if (st.drawGeometry) {
      const hoverMapped = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
      st.drawHover = { canvasX: point.x, canvasY: point.y, inside: hoverMapped.inside };
    } else {
      st.drawHover = null;
    }
    const drag = st.drawStroke;
    if (!drag || drag.pointerId !== event.pointerId) {
      void ctx.renderDrawNode(node, 0);
      return;
    }
    if (!st.drawGeometry) return;
    const mapped = canvasToDrawSourcePoint(st.drawGeometry, point.x, point.y);
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
    ctx.markCanvasDirty();
    void ctx.renderDrawNode(node, 0);
  });
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
  canvas.addEventListener("pointerup", releaseStroke);
  canvas.addEventListener("pointercancel", releaseStroke);
  canvas.addEventListener("pointerleave", () => {
    if (!st.drawStroke) {
      st.drawHover = null;
      void ctx.renderDrawNode(node, 0);
    }
  });
  canvas.addEventListener("pointerenter", () => {
    canvas.focus();
  });
}
export {
  attachInteractions
};
