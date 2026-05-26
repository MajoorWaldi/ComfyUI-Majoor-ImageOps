import { clampCompScale, clampCompRotation, getCompSlots, getCompLayerOutputCorners } from "../comp.js";
import { findWidget, resetNodeWidgetsToDefaults, setWidgetValue, widgetBoolean, widgetNumber } from "../shared/widgets.js";
import {
  cloneCompCorners,
  compDragHandleToCorner,
  ensureCompInputs,
  getCompCursor,
  removeSelectedCompLayer
} from "../nodes/comp.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
function safeSetPointerCapture(el, pointerId) {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
  }
}
function safeReleasePointerCapture(el, pointerId) {
  try {
    el.releasePointerCapture?.(pointerId);
  } catch {
  }
}
function rotatePoint(x, y, angleRad) {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}
function aspectRatioValue(value) {
  switch (String(value || "custom").trim().toLowerCase()) {
    case "1/1":
    case "1:1":
      return 1;
    case "3/4":
    case "3:4":
      return 3 / 4;
    case "4/3":
    case "4:3":
      return 4 / 3;
    case "16/9":
    case "16:9":
      return 16 / 9;
    case "9/16":
    case "9:16":
      return 9 / 16;
    default:
      return null;
  }
}
function applyCompAspectRatio(node, ratioName) {
  const ratio = aspectRatioValue(ratioName);
  if (!ratio) return;
  if (widgetBoolean(node, "use_first_layer_size", true) || widgetBoolean(node, "auto_layering", false)) return;
  const width = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
  setWidgetValue(findWidget(node, "height"), Math.max(1, Math.round(width / ratio)));
}
function attachInteractions(node, ctx) {
  const st = node.__imageops_state;
  if (!st?.canvas || st.compInteractiveHooked) return;
  st.compInteractiveHooked = true;
  let moveRafPending = false;
  const canvas = st.canvas;
  const worldPt = (event) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };
  if (st.compAddButton && !st.compAddButton.dataset.compAddHooked) {
    st.compAddButton.dataset.compAddHooked = "1";
    st.compAddButton.addEventListener("click", (event) => {
      event.preventDefault();
      ensureCompInputs(node, Math.max(1, getCompSlots(node).length + 1));
      const layers = ctx.ensureCompState(node);
      st.compSelectedSlot = layers[layers.length - 1]?.slot ?? st.compSelectedSlot;
      ctx.updateCompControls(node);
      ctx.markPreviewInteraction(node);
      ctx.markCanvasDirty();
      ctx.schedule(node, () => {
        ctx.startLoopIfVideo(node);
        ctx.refreshDependents(node);
      }, 0);
    });
  }
  if (st.compRemoveButton && !st.compRemoveButton.dataset.compRemoveHooked) {
    st.compRemoveButton.dataset.compRemoveHooked = "1";
    st.compRemoveButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (!removeSelectedCompLayer(node)) return;
      ctx.updateCompControls(node);
      ctx.markPreviewInteraction(node);
      ctx.markCanvasDirty();
      ctx.schedule(node, () => {
        ctx.startLoopIfVideo(node);
        ctx.refreshDependents(node);
      }, 0);
    });
  }
  st.compResetButton?.addEventListener("click", (event) => {
    event.preventDefault();
    resetNodeWidgetsToDefaults(node);
    st.compSelectedSlot = null;
    ctx.updateCompControls(node);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  });
  st.compResizeButton?.addEventListener("click", (event) => {
    event.preventDefault();
    st.compEditMode = "resize";
    ctx.updateCompControls(node);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
  });
  st.compCornerPinButton?.addEventListener("click", (event) => {
    event.preventDefault();
    st.compEditMode = "cornerpin";
    ctx.updateCompControls(node);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
  });
  st.compModeSelect?.addEventListener("change", () => {
    ctx.updateSelectedCompLayer(node, (layer) => {
      layer.mode = st.compModeSelect?.value ?? "over";
    }, false);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  });
  st.compOpacityInput?.addEventListener("input", () => {
    ctx.updateSelectedCompLayer(node, (layer) => {
      layer.opacity = Math.max(0, Math.min(1, Number(st.compOpacityInput?.value ?? 100) / 100));
    });
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  });
  canvas.addEventListener("pointerdown", (event) => {
    const point = worldPt(event);
    const hit = ctx.getCompHit(node, canvas.width, canvas.height, point.x, point.y);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    safeSetPointerCapture(canvas, event.pointerId);
    st.compSelectedSlot = hit.layer.slot;
    ctx.updateCompControls(node);
    const layers = ctx.ensureCompState(node);
    const layer = layers.find((entry) => entry.slot === hit.layer.slot);
    if (!layer) return;
    st.compDrag = {
      pointerId: event.pointerId,
      slot: hit.layer.slot,
      mode: hit.mode,
      startCanvasX: point.x,
      startCanvasY: point.y,
      startCenterX: layer.centerX,
      startCenterY: layer.centerY,
      startScale: layer.scale,
      startRotationDeg: layer.rotationDeg,
      startPointerAngle: Math.atan2(
        point.y - hit.layer.centerY * canvas.height / Math.max(1, st.compOutputHeight || canvas.height),
        point.x - hit.layer.centerX * canvas.width / Math.max(1, st.compOutputWidth || canvas.width)
      ),
      startLeft: hit.layer.left,
      startTop: hit.layer.top,
      startWidth: hit.layer.width,
      startHeight: hit.layer.height,
      startOutputCenterX: hit.layer.centerX,
      startOutputCenterY: hit.layer.centerY,
      startDrawWidth: hit.layer.drawWidth,
      startDrawHeight: hit.layer.drawHeight,
      sourceWidth: hit.layer.sourceWidth,
      sourceHeight: hit.layer.sourceHeight,
      startCorners: cloneCompCorners(hit.layer.corners)
    };
    canvas.style.cursor = getCompCursor(hit.mode);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = worldPt(event);
    const drag = st.compDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      canvas.style.cursor = getCompCursor(ctx.getCompHit(node, canvas.width, canvas.height, point.x, point.y)?.mode ?? null);
      return;
    }
    event.preventDefault();
    const outputPoint = ctx.compCanvasToOutputPoint(node, canvas.width, canvas.height, point.x, point.y);
    const startOutputPoint = ctx.compCanvasToOutputPoint(node, canvas.width, canvas.height, drag.startCanvasX, drag.startCanvasY);
    ctx.updateSelectedCompLayer(node, (layer) => {
      const corners = cloneCompCorners(drag.startCorners) ?? getCompLayerOutputCorners(
        st.compOutputWidth || 1,
        st.compOutputHeight || 1,
        drag.sourceWidth,
        drag.sourceHeight,
        layer
      );
      const center = {
        x: (corners.tl.x + corners.tr.x + corners.bl.x + corners.br.x) / 4,
        y: (corners.tl.y + corners.tr.y + corners.bl.y + corners.br.y) / 4
      };
      if (drag.mode === "rotate") {
        const currentAngle = Math.atan2(outputPoint.y - center.y, outputPoint.x - center.x);
        const startAngle = Math.atan2(startOutputPoint.y - center.y, startOutputPoint.x - center.x);
        const delta = currentAngle - startAngle;
        for (const key of ["tl", "tr", "bl", "br"]) {
          const start = corners[key];
          const rotated = rotatePoint(start.x - center.x, start.y - center.y, delta);
          corners[key] = { x: center.x + rotated.x, y: center.y + rotated.y };
        }
        ctx.writeCompLayerCorners(node, layer, corners);
        layer.rotationDeg = clampCompRotation(drag.startRotationDeg + delta * 180 / Math.PI);
        return;
      }
      if (drag.mode === "move") {
        const deltaX = outputPoint.x - startOutputPoint.x;
        const deltaY = outputPoint.y - startOutputPoint.y;
        for (const key of ["tl", "tr", "bl", "br"]) {
          const start = (drag.startCorners ?? corners)[key];
          corners[key] = { x: start.x + deltaX, y: start.y + deltaY };
        }
        ctx.writeCompLayerCorners(node, layer, corners);
        return;
      }
      const handle = compDragHandleToCorner(drag.mode);
      if (!handle) return;
      if (st.compEditMode === "cornerpin") {
        corners[handle] = { x: outputPoint.x, y: outputPoint.y };
        ctx.writeCompLayerCorners(node, layer, corners);
        return;
      }
      const startCorners = drag.startCorners ?? corners;
      const startCenter = {
        x: (startCorners.tl.x + startCorners.tr.x + startCorners.bl.x + startCorners.br.x) / 4,
        y: (startCorners.tl.y + startCorners.tr.y + startCorners.bl.y + startCorners.br.y) / 4
      };
      const startHandle = startCorners[handle];
      const startDistance = Math.max(1e-3, Math.hypot(startHandle.x - startCenter.x, startHandle.y - startCenter.y));
      const currentDistance = Math.max(1e-3, Math.hypot(outputPoint.x - startCenter.x, outputPoint.y - startCenter.y));
      const scaleRatio = currentDistance / startDistance;
      for (const key of ["tl", "tr", "bl", "br"]) {
        const start = startCorners[key];
        corners[key] = {
          x: startCenter.x + (start.x - startCenter.x) * scaleRatio,
          y: startCenter.y + (start.y - startCenter.y) * scaleRatio
        };
      }
      ctx.writeCompLayerCorners(node, layer, corners);
      layer.scale = clampCompScale(drag.startScale * scaleRatio);
    });
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        ctx.schedule(node, () => {
          ctx.startLoopIfVideo(node);
          ctx.refreshDependents(node);
        }, 0);
      });
    }
  });
  const releaseDrag = (event) => {
    if (!st.compDrag || st.compDrag.pointerId !== event.pointerId) return;
    st.compDrag = null;
    safeReleasePointerCapture(canvas, event.pointerId);
    const point = worldPt(event);
    canvas.style.cursor = getCompCursor(ctx.getCompHit(node, canvas.width, canvas.height, point.x, point.y)?.mode ?? null);
    ctx.updateSelectedCompLayer(node, (_layer) => {
    }, true);
    ctx.markPreviewInteraction(node);
    ctx.markCanvasDirty();
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
  };
  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!st.compDrag) canvas.style.cursor = "default";
  });
  if (!st.compKeyboardHooked) {
    st.compKeyboardHooked = true;
    let pointerOverCanvas = false;
    const signal = st?._abortController?.signal;
    canvas.addEventListener("pointerenter", () => {
      pointerOverCanvas = true;
    }, signal ? { signal } : void 0);
    canvas.addEventListener("pointerleave", () => {
      pointerOverCanvas = false;
    }, signal ? { signal } : void 0);
    const isEditableTarget = (target) => {
      const el = target;
      if (!el) return false;
      const tag = (el.tagName || "").toUpperCase();
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable === true;
    };
    window.addEventListener("keydown", (event) => {
      if (!pointerOverCanvas && document.activeElement !== canvas) return;
      if (isEditableTarget(event.target)) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        if (!removeSelectedCompLayer(node)) return;
        ctx.updateCompControls(node);
        ctx.markPreviewInteraction(node);
        ctx.markCanvasDirty();
        ctx.schedule(node, () => {
          ctx.startLoopIfVideo(node);
          ctx.refreshDependents(node);
        }, 0);
        return;
      }
      const digit = event.key.charCodeAt(0);
      if (digit >= 49 && digit <= 57 && event.key.length === 1) {
        const idx = digit - 49;
        const layers = ctx.ensureCompState(node);
        const target = layers[idx];
        if (target) {
          event.preventDefault();
          st.compSelectedSlot = target.slot;
          ctx.updateCompControls(node);
          ctx.markPreviewInteraction(node);
          ctx.markCanvasDirty();
        }
      }
    }, signal ? { signal } : void 0);
  }
}
export {
  attachInteractions
};
