import type { ComfyNode, CropInteractionContext } from "../../types.js";
import { computeCropRect, clampCropCenter, clampCropScale } from "../crop.js";
import {
  getCropControlState,
  setCropControlState,
  isFreeCropResizeEnabled,
  getCropInteractionMode,
  getCropCursor,
  canvasToSourcePoint,
  resolveCropAspectRatioValue,
  cropRectFromAnchor,
  freeCropRectFromAnchor,
} from "../nodes/crop.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import { resetNodeWidgetsToDefaults, widgetNumber } from "../shared/widgets.js";

export function attachInteractions(node: ComfyNode, ctx: CropInteractionContext): void {
  const st = (node as any).__imageops_state as any;
  if (!st?.canvas || st.cropInteractiveHooked) return;
  st.cropInteractiveHooked = true;
  let moveRafPending = false;

  const canvas: HTMLCanvasElement = st.canvas;
  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : undefined;

  // Convert a screen-space pointer event to world-space (pre-zoom/pan) canvas coordinates.
  // Geometry objects store world-space positions, so all pointer comparisons must use these.
  const worldPt = (event: PointerEvent) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };

  st.cropResetButton?.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    resetNodeWidgetsToDefaults(node);
    st.cropAspectRatio = null;
    st.cropDrag = null;
    canvas.style.cursor = "default";
    ctx.schedule(node, () => {
      ctx.startLoopIfVideo(node);
      ctx.refreshDependents(node);
    }, 0);
    ctx.refreshNode(node);
  }, listenerOptions);

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const geometry = st.cropGeometry;
    if (!geometry) return;
    const point = worldPt(event);
    const mode = getCropInteractionMode(geometry, point.x, point.y);
    if (!mode) return;

    event.preventDefault();
    event.stopPropagation();
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* ignore */ }
    const controls = getCropControlState(node, geometry.sourceWidth, geometry.sourceHeight);
    st.cropDrag = {
      pointerId: event.pointerId,
      mode,
      startCanvasX: point.x,
      startCanvasY: point.y,
      startCenterX: controls.centerX,
      startCenterY: controls.centerY,
      startScale: controls.scale,
      startCropX: geometry.cropX,
      startCropY: geometry.cropY,
      startCropWidth: geometry.cropWidth,
      startCropHeight: geometry.cropHeight,
      startOutputWidth: Math.max(1, Math.round(widgetNumber(node, "width", geometry.cropWidth))),
      startOutputHeight: Math.max(1, Math.round(widgetNumber(node, "height", geometry.cropHeight))),
    };
    canvas.style.cursor = getCropCursor(mode);
  }, listenerOptions);

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = worldPt(event);
    const drag = st.cropDrag;
    const geometry = st.cropGeometry;

    if (!drag || drag.pointerId !== event.pointerId || !geometry) {
      canvas.style.cursor = getCropCursor(getCropInteractionMode(geometry, point.x, point.y));
      return;
    }

    event.preventDefault();
    const targetRatio = resolveCropAspectRatioValue(node, geometry.sourceWidth, geometry.sourceHeight);
    const maxRect = computeCropRect(geometry.sourceWidth, geometry.sourceHeight, targetRatio, 0.5, 0.5, 1);
    let nextCenterX = drag.startCenterX;
    let nextCenterY = drag.startCenterY;
    let nextScale = drag.startScale;

    if (drag.mode === "move") {
      const deltaX = (point.x - drag.startCanvasX) * geometry.sourceWidth / Math.max(1, geometry.fitDrawWidth);
      const deltaY = (point.y - drag.startCanvasY) * geometry.sourceHeight / Math.max(1, geometry.fitDrawHeight);
      let centerPx = drag.startCenterX * geometry.sourceWidth + deltaX;
      let centerPy = drag.startCenterY * geometry.sourceHeight + deltaY;
      centerPx = Math.max(drag.startCropWidth / 2, Math.min(geometry.sourceWidth - drag.startCropWidth / 2, centerPx));
      centerPy = Math.max(drag.startCropHeight / 2, Math.min(geometry.sourceHeight - drag.startCropHeight / 2, centerPy));
      nextCenterX = clampCropCenter(centerPx / Math.max(1, geometry.sourceWidth));
      nextCenterY = clampCropCenter(centerPy / Math.max(1, geometry.sourceHeight));
    } else {
      const pointerSource = canvasToSourcePoint(geometry, point.x, point.y);
      const freeResize = isFreeCropResizeEnabled(node);
      const anchor = (() => {
        if (drag.mode === "n") return { x: drag.startCropX + drag.startCropWidth / 2, y: drag.startCropY + drag.startCropHeight };
        if (drag.mode === "e") return { x: drag.startCropX, y: drag.startCropY + drag.startCropHeight / 2 };
        if (drag.mode === "s") return { x: drag.startCropX + drag.startCropWidth / 2, y: drag.startCropY };
        if (drag.mode === "w") return { x: drag.startCropX + drag.startCropWidth, y: drag.startCropY + drag.startCropHeight / 2 };
        if (drag.mode === "nw") return { x: drag.startCropX + drag.startCropWidth, y: drag.startCropY + drag.startCropHeight };
        if (drag.mode === "ne") return { x: drag.startCropX, y: drag.startCropY + drag.startCropHeight };
        if (drag.mode === "sw") return { x: drag.startCropX + drag.startCropWidth, y: drag.startCropY };
        return { x: drag.startCropX, y: drag.startCropY };
      })();

      if (freeResize) {
        const nextRect = freeCropRectFromAnchor(
          anchor,
          drag.mode,
          pointerSource,
          { x: drag.startCropX, y: drag.startCropY, cropWidth: drag.startCropWidth, cropHeight: drag.startCropHeight },
          geometry.sourceWidth,
          geometry.sourceHeight,
        );
        const cropWidth = nextRect.cropWidth;
        const cropHeight = nextRect.cropHeight;
        const centerPx = nextRect.x + cropWidth / 2;
        const centerPy = nextRect.y + cropHeight / 2;
        const widthDensity = drag.startOutputWidth / Math.max(1, drag.startCropWidth);
        const heightDensity = drag.startOutputHeight / Math.max(1, drag.startCropHeight);
        const uniformDensity = Math.max(0.0001, Math.sqrt(Math.max(0.0001, widthDensity * heightDensity)));
        const outputWidth = Math.max(1, Math.round(cropWidth * uniformDensity));
        const outputHeight = Math.max(1, Math.round(cropHeight * uniformDensity));
        ctx.setCropOutputDimensions(node, outputWidth, outputHeight, false);
        const freeRatio = Math.max(0.0001, outputWidth / Math.max(1, outputHeight));
        const freeMaxRect = computeCropRect(geometry.sourceWidth, geometry.sourceHeight, freeRatio, 0.5, 0.5, 1);
        nextCenterX = clampCropCenter(centerPx / Math.max(1, geometry.sourceWidth));
        nextCenterY = clampCropCenter(centerPy / Math.max(1, geometry.sourceHeight));
        nextScale = clampCropScale(Math.min(
          cropWidth / Math.max(1, freeMaxRect.cropWidth),
          cropHeight / Math.max(1, freeMaxRect.cropHeight),
        ));
      } else {
        const next = cropRectFromAnchor(anchor, drag.mode, targetRatio, pointerSource, maxRect, geometry.sourceWidth, geometry.sourceHeight);
        nextCenterX = next.centerX;
        nextCenterY = next.centerY;
        nextScale = next.scale;
      }
    }

    setCropControlState(node, nextCenterX, nextCenterY, nextScale, false);
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => { moveRafPending = false; ctx.refreshNode(node); });
    }
  }, listenerOptions);

  const releaseDrag = (event: PointerEvent) => {
    if (!st.cropDrag || st.cropDrag.pointerId !== event.pointerId) return;
    st.cropDrag = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch { /* ignore */ }
    const point = worldPt(event);
    canvas.style.cursor = getCropCursor(getCropInteractionMode(st.cropGeometry, point.x, point.y));
    const controls = getCropControlState(node, 1, 1);
    setCropControlState(node, controls.centerX, controls.centerY, controls.scale, true);
    if (st.cropGeometry && isFreeCropResizeEnabled(node)) {
      ctx.setCropOutputDimensions(
        node,
        Math.max(1, Math.round(widgetNumber(node, "width", st.cropGeometry.cropWidth))),
        Math.max(1, Math.round(widgetNumber(node, "height", st.cropGeometry.cropHeight))),
        true,
      );
    }
    ctx.refreshNode(node);
  };

  canvas.addEventListener("pointerup", releaseDrag, listenerOptions);
  canvas.addEventListener("pointercancel", releaseDrag, listenerOptions);
  canvas.addEventListener("pointerleave", () => {
    if (!st.cropDrag) canvas.style.cursor = "default";
  }, listenerOptions);
}
