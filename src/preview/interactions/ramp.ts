import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { syncDarkColorInputUI } from "../shared/dom-styles.js";
import { getRampHit, isNode as isRampNode, rampCanvasToNormalized, setRampHandle, syncRampWidgets } from "../nodes/ramp.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import { findWidget, setWidgetBooleanValue, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue } from "../shared/widgets.js";

const RAMP_RATIO_PRESETS: Record<string, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
};

function clampInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isRampNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.previewRoot as HTMLElement | null;
  const canvas = st?.canvas as HTMLCanvasElement | null;
  if (!st || !root || !canvas || st.rampInteractiveHooked) return;
  st.rampInteractiveHooked = true;

  let moveRafPending = false;

  const worldPt = (event: PointerEvent) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };

  const refresh = (): void => {
    syncRampWidgets(node);
    ctx.refreshNode(node);
  };

  const ratioSelect = root.querySelector<HTMLSelectElement>('select[data-ramp-ratio="1"]');

  const applyRatioPreset = (changedField: "width" | "height"): void => {
    const preset = String(ratioSelect?.value ?? "custom");
    const ratio = RAMP_RATIO_PRESETS[preset];
    if (!ratio) return;

    const widthWidget = findWidget(node, "width");
    const heightWidget = findWidget(node, "height");
    const currentWidth = clampInt(Number(widthWidget?.value ?? 1024), 1024, 1, 8192);
    const currentHeight = clampInt(Number(heightWidget?.value ?? 1024), 1024, 1, 8192);

    if (changedField === "width") {
      setWidgetValue(heightWidget, clampInt(currentWidth / ratio, currentHeight, 1, 8192));
    } else {
      setWidgetValue(widthWidget, clampInt(currentHeight * ratio, currentWidth, 1, 8192));
    }
  };

  canvas.addEventListener("pointerdown", (event: PointerEvent) => {
    const geometry = st.rampGeometry;
    if (!geometry) return;
    const point = worldPt(event);
    const hit = getRampHit(node, geometry, point.x, point.y);
    if (!hit) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.focus();
    try { canvas.setPointerCapture?.(event.pointerId); } catch {}
    st.rampDrag = { pointerId: event.pointerId, handle: hit };
    canvas.style.cursor = "grabbing";
  });

  canvas.addEventListener("pointermove", (event: PointerEvent) => {
    const point = worldPt(event);
    const drag = st.rampDrag;
    const geometry = st.rampGeometry;

    if (!drag || drag.pointerId !== event.pointerId || !geometry) {
      canvas.style.cursor = getRampHit(node, geometry, point.x, point.y) ? "grab" : "default";
      return;
    }

    event.preventDefault();
    const mapped = rampCanvasToNormalized(geometry, point.x, point.y);
    setRampHandle(node, drag.handle, mapped.xNorm, mapped.yNorm, false);
    canvas.style.cursor = "grabbing";
    if (!moveRafPending) {
      moveRafPending = true;
      requestAnimationFrame(() => {
        moveRafPending = false;
        syncRampWidgets(node);
        ctx.refreshNode(node);
      });
    }
  });

  const releaseDrag = (event: PointerEvent) => {
    if (!st.rampDrag || st.rampDrag.pointerId !== event.pointerId) return;
    const drag = st.rampDrag;
    st.rampDrag = null;
    try { canvas.releasePointerCapture?.(event.pointerId); } catch {}
    const point = worldPt(event);
    canvas.style.cursor = getRampHit(node, st.rampGeometry, point.x, point.y) ? "grab" : "default";
    if (st.rampGeometry) {
      const mapped = rampCanvasToNormalized(st.rampGeometry, point.x, point.y);
      setRampHandle(node, drag.handle, mapped.xNorm, mapped.yNorm, true);
    }
    syncRampWidgets(node);
    ctx.refreshNode(node);
  };

  canvas.addEventListener("pointerup", releaseDrag);
  canvas.addEventListener("pointercancel", releaseDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!st.rampDrag) canvas.style.cursor = "default";
  });

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-ramp-field]'))) {
    const field = String(input.dataset.rampField ?? "");

    if (field === "alpha") {
      input.addEventListener("input", () => {
        const value = Math.max(0, Math.min(100, Number(input.value)));
        setWidgetValue(findWidget(node, "alpha"), value / 100);
        refresh();
      });
      continue;
    }

    input.addEventListener("change", () => {
      const numeric = Number(input.value);
      if (field === "width" || field === "height") {
        setWidgetValue(findWidget(node, field), clampInt(numeric, 1024, 1, 8192));
        applyRatioPreset(field);
      } else if (field === "frame_count" || field === "frame_length" || field === "batch_size") {
        setWidgetValue(findWidget(node, "frame_count") ?? findWidget(node, "frame_length") ?? findWidget(node, "batch_size"), clampInt(numeric, 1, 1, 4096));
      } else if (field === "start_x" || field === "start_y" || field === "end_x" || field === "end_y") {
        setWidgetValue(findWidget(node, field), clampFloat(numeric, field.endsWith("y") ? 0.5 : (field.startsWith("end") ? 1 : 0), -2, 3));
      }
      refresh();
    });
  }

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-ramp-color]'))) {
    input.addEventListener("input", () => {
      const channel = String(input.dataset.rampColor ?? "a");
      const widgetName = channel === "b" ? "color_b" : "color_a";
      const normalized = String(input.value || (channel === "b" ? "#000000" : "#ffffff"));
      setWidgetStringValuesByName(node, widgetName, normalized);
      syncDarkColorInputUI(input, normalized);
      refresh();
    });
  }

  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>('select[data-ramp-select]'))) {
    select.addEventListener("change", () => {
      const kind = String(select.dataset.rampSelect ?? "");
      const widgetName = kind === "shape" ? "ramp_shape" : "ramp_mode";
      setWidgetStringValue(findWidget(node, widgetName), select.value);
      refresh();
    });
  }

  const invertButton = root.querySelector<HTMLButtonElement>('button[data-ramp-toggle="invert"]');
  invertButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const next = !(Boolean(findWidget(node, "invert")?.value));
    setWidgetBooleanValue(findWidget(node, "invert"), next);
    refresh();
  });

  ratioSelect?.addEventListener("change", () => {
    const preset = String(ratioSelect.value ?? "custom");
    if (preset !== "custom") {
      applyRatioPreset("width");
    }
    refresh();
  });

  syncRampWidgets(node);
}
