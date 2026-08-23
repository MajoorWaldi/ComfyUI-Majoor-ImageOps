import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { colorWheelPointToValues } from "../color.js";
import { colorWidgetNameForZone, isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, resetNodeWidgetsToDefaults, setWidgetValue } from "../shared/widgets.js";

function markDirty(node: ComfyNode, ctx: NodeInteractionContext): void {
  const st = node.__imageops_state ?? null;
  if (!st) return;
  st.nativeDirty = true;
  ctx.markCanvasDirty();
  ctx.schedule(node, () => {
    ctx.startLoopIfVideo(node);
    ctx.refreshDependents(node);
  }, 0);
}

function refreshDirty(node: ComfyNode, ctx: NodeInteractionContext): void {
  const st = node.__imageops_state ?? null;
  if (!st) return;
  st.nativeDirty = true;
  ctx.markCanvasDirty();
  ctx.refreshNode(node);
}

// Bind a slider input to a primary param. The widget name is resolved on every
// edit from `st.colorActiveZone`, so a single DOM input can drive Global,
// Shadows, Midtones or Highlights values without rewiring listeners.
function bindZoneRange(
  node: ComfyNode,
  ctx: NodeInteractionContext,
  input: HTMLInputElement | null,
  param: string,
  parser: (value: string) => number = (value) => Number(value),
): void {
  if (!input) return;
  const st = node.__imageops_state ?? null;
  const listenerOptions = st?._abortController?.signal ? { signal: st._abortController.signal } : undefined;
  input.addEventListener("input", () => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    let value = parser(input.value);
    // Per-zone wheel-amount widgets (`<zone>_amount`) are 0..100 in the backend
    // — clamp so dragging the Sat slider into the negative half on a zone tab
    // matches the actual stored value (and the label after re-sync).
    if (param === "saturation" && zone !== "global" && value < 0) value = 0;
    setWidgetValue(findWidget(node, colorWidgetNameForZone(param, zone)), value);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  }, listenerOptions);
}

function bindZoneWheel(
  node: ComfyNode,
  ctx: NodeInteractionContext,
  canvas: HTMLCanvasElement | null,
): void {
  if (!canvas) return;
  const st0 = node.__imageops_state ?? null;
  const listenerOptions = st0?._abortController?.signal ? { signal: st0._abortController.signal } : undefined;

  let activePointerId: number | null = null;
  let moveRafPending = false;

  const commitWheelPoint = (event: PointerEvent, notify: boolean): void => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("hue", zone)), values.hueDeg, { notify });
    setWidgetValue(findWidget(node, colorWidgetNameForZone("saturation", zone)), values.saturation, { notify });
    syncColorCorrectWidgets(node);
    if (notify) {
      markDirty(node, ctx);
    } else if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        refreshDirty(node, ctx);
      });
    }
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    commitWheelPoint(event, false);
  }, listenerOptions);

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    commitWheelPoint(event, false);
  }, listenerOptions);

  const release = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
    commitWheelPoint(event, true);
  };

  canvas.addEventListener("pointerup", release, listenerOptions);
  canvas.addEventListener("pointercancel", release, listenerOptions);
}

function bindZoneTab(
  node: ComfyNode,
  ctx: NodeInteractionContext,
  btn: HTMLButtonElement | null,
  zone: "global" | "shadows" | "midtones" | "highlights",
): void {
  if (!btn) return;
  const st0 = node.__imageops_state ?? null;
  const listenerOptions = st0?._abortController?.signal ? { signal: st0._abortController.signal } : undefined;
  btn.addEventListener("click", () => {
    const st = node.__imageops_state ?? null;
    if (!st) return;
    if (st.colorActiveZone === zone) return;
    st.colorActiveZone = zone;
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  }, listenerOptions);
}

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st || st.colorInteractiveHooked) return;
  st.colorInteractiveHooked = true;

  bindZoneRange(node, ctx, st.colorBrightnessInput, "brightness");
  bindZoneRange(node, ctx, st.colorTemperatureInput, "temperature");
  // The DOM input previously labelled "Tint" is reused as the Hue slider —
  // it edits the active zone's `hue` widget (or `<zone>_hue`).
  bindZoneRange(node, ctx, st.colorTintInput, "hue");
  bindZoneRange(node, ctx, st.colorContrastInput, "contrast");
  bindZoneRange(node, ctx, st.colorSaturationInput, "saturation");
  bindZoneRange(node, ctx, st.colorVibranceInput, "vibrance");
  bindZoneRange(node, ctx, st.colorGammaInput, "gamma");

  // The big colour wheel is now the only wheel and is zone-aware.
  bindZoneWheel(node, ctx, st.colorWheelCanvas);

  bindZoneTab(node, ctx, st.colorZoneTabGlobal, "global");
  bindZoneTab(node, ctx, st.colorZoneTabShadows, "shadows");
  bindZoneTab(node, ctx, st.colorZoneTabMidtones, "midtones");
  bindZoneTab(node, ctx, st.colorZoneTabHighlights, "highlights");

  const resetAll = (): void => {
    resetNodeWidgetsToDefaults(node);
    st.colorActiveZone = "global";
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };

  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : undefined;
  st.colorWheelCanvas?.addEventListener("dblclick", resetAll, listenerOptions);
  st.colorResetButton?.addEventListener("click", resetAll, listenerOptions);

  syncColorCorrectWidgets(node);
}
