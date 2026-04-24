import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { colorWheelPointToValues } from "../color.js";
import { getCanvasPointer } from "../shared/geometry.js";
import { findWidget, setWidgetValue } from "../shared/widgets.js";
import { colorWidgetDefaultFor, colorWidgetNameForZone, isNode, syncColorCorrectWidgets } from "../nodes/color-correct.js";

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
  if (!input || input.dataset.bound === "1") return;
  input.dataset.bound = "1";
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
  });
}

function bindZoneWheel(
  node: ComfyNode,
  ctx: NodeInteractionContext,
  canvas: HTMLCanvasElement | null,
): void {
  if (!canvas || canvas.dataset.bound === "1") return;
  canvas.dataset.bound = "1";

  let activePointerId: number | null = null;

  const commitWheelPoint = (event: PointerEvent): void => {
    const st = node.__imageops_state ?? null;
    const zone = st?.colorActiveZone ?? "global";
    const point = getCanvasPointer(canvas, event);
    const values = colorWheelPointToValues(point.x, point.y, canvas);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("hue", zone)), values.hueDeg);
    setWidgetValue(findWidget(node, colorWidgetNameForZone("saturation", zone)), values.saturation);
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    activePointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    commitWheelPoint(event);
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    commitWheelPoint(event);
  });

  const release = (event: PointerEvent): void => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };

  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
}

function bindZoneTab(
  node: ComfyNode,
  ctx: NodeInteractionContext,
  btn: HTMLButtonElement | null,
  zone: "global" | "shadows" | "midtones" | "highlights",
): void {
  if (!btn || btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  btn.addEventListener("click", () => {
    const st = node.__imageops_state ?? null;
    if (!st) return;
    if (st.colorActiveZone === zone) return;
    st.colorActiveZone = zone;
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  });
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
    // Reset every primary across every zone (global + 3 zones). The wheel
    // amount lives at `<zone>_amount` for the per-zone tabs and `saturation`
    // for the global one — both already covered by `colorWidgetNameForZone`.
    for (const zone of ["global", "shadows", "midtones", "highlights"]) {
      for (const param of ["temperature", "hue", "contrast", "saturation", "vibrance", "gamma", "brightness"]) {
        setWidgetValue(findWidget(node, colorWidgetNameForZone(param, zone)), colorWidgetDefaultFor(param));
      }
    }
    syncColorCorrectWidgets(node);
    markDirty(node, ctx);
  };

  st.colorWheelCanvas?.addEventListener("dblclick", resetAll);
  st.colorResetButton?.addEventListener("click", resetAll);

  syncColorCorrectWidgets(node);
}
