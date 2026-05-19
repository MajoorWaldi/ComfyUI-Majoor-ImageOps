import { syncDarkColorInputUI } from "../shared/dom-styles.js";
import { isNode as isTextNode, syncTextWidgets } from "../nodes/text.js";
import { findWidget, setWidgetBooleanValue, setWidgetStringValue, setWidgetValue, widgetNumber } from "../shared/widgets.js";
function clampInt(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
function clampFloat(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
function attachInteractions(node, ctx) {
  if (!isTextNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.previewRoot;
  if (!st || !root || root.dataset.textInteractiveHooked === "1") return;
  root.dataset.textInteractiveHooked = "1";
  const refresh = () => {
    syncTextWidgets(node);
    ctx.refreshNode(node);
  };
  for (const input of Array.from(root.querySelectorAll("input[data-text-field]"))) {
    const field = String(input.dataset.textField ?? "");
    if (field === "opacity") {
      input.addEventListener("input", () => {
        const value = Math.max(0, Math.min(100, Number(input.value)));
        setWidgetValue(findWidget(node, "opacity"), value / 100);
        refresh();
      });
      continue;
    }
    if (field === "font_path") {
      input.addEventListener("change", () => {
        setWidgetStringValue(findWidget(node, "font_path"), String(input.value ?? ""));
        refresh();
      });
      continue;
    }
    input.addEventListener("change", () => {
      const numeric = Number(input.value);
      if (field === "font_size") {
        setWidgetValue(findWidget(node, field), clampInt(numeric, 64, 1, 512));
      } else if (field === "line_spacing") {
        setWidgetValue(findWidget(node, field), clampInt(numeric, 4, 0, 256));
      } else if (field === "stroke_width") {
        setWidgetValue(findWidget(node, field), clampInt(numeric, 0, 0, 64));
      } else if (field === "x" || field === "y") {
        setWidgetValue(findWidget(node, field), clampFloat(numeric, 0.5, -2, 3));
      }
      refresh();
    });
  }
  for (const input of Array.from(root.querySelectorAll("input[data-text-color]"))) {
    input.addEventListener("input", () => {
      const channel = String(input.dataset.textColor ?? "fill");
      const widgetName = channel === "stroke" ? "stroke_color" : "color";
      const fallback = channel === "stroke" ? "#000000" : "#ffffff";
      const normalized = String(input.value || fallback);
      setWidgetStringValue(findWidget(node, widgetName), normalized);
      syncDarkColorInputUI(input, normalized);
      refresh();
    });
  }
  const alignSelect = root.querySelector('select[data-text-select="align"]');
  alignSelect?.addEventListener("change", () => {
    setWidgetStringValue(findWidget(node, "align"), String(alignSelect.value || "center"));
    refresh();
  });
  for (const button of Array.from(root.querySelectorAll("button[data-text-toggle]"))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const field = String(button.dataset.textToggle ?? "");
      if (!field) return;
      const widget = findWidget(node, field);
      setWidgetBooleanValue(widget, !Boolean(widget?.value));
      refresh();
    });
  }
  const canvas = st.canvas;
  if (canvas) {
    canvas.style.cursor = "grab";
    let drag = null;
    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
      }
      drag = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startWX: widgetNumber(node, "x", 0.5),
        startWY: widgetNumber(node, "y", 0.5)
      };
      canvas.style.cursor = "grabbing";
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const dx = (event.clientX - drag.startClientX) / rect.width;
      const dy = (event.clientY - drag.startClientY) / rect.height;
      const newX = clampFloat(drag.startWX + dx, 0.5, -2, 3);
      const newY = clampFloat(drag.startWY + dy, 0.5, -2, 3);
      setWidgetValue(findWidget(node, "x"), Math.round(newX * 1e3) / 1e3);
      setWidgetValue(findWidget(node, "y"), Math.round(newY * 1e3) / 1e3);
      const xInput = root.querySelector('input[data-text-field="x"]');
      const yInput = root.querySelector('input[data-text-field="y"]');
      if (xInput) xInput.value = String(Math.round(newX * 1e3) / 1e3);
      if (yInput) yInput.value = String(Math.round(newY * 1e3) / 1e3);
      refresh();
    });
    const endDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      canvas.style.cursor = "grab";
      ctx.refreshDependents(node);
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 2;
      const delta = event.deltaY > 0 ? -step : step;
      const current = Math.max(1, Math.round(widgetNumber(node, "font_size", 64)));
      const next = Math.max(1, Math.min(512, current + delta));
      setWidgetValue(findWidget(node, "font_size"), next);
      const sizeInput = root.querySelector('input[data-text-field="font_size"]');
      if (sizeInput) sizeInput.value = String(next);
      refresh();
    }, { passive: false });
  }
  syncTextWidgets(node);
  const textWidget = findWidget(node, "text");
  if (textWidget && !textWidget.__imageopsTextCbHooked) {
    textWidget.__imageopsTextCbHooked = true;
    const origTextCb = typeof textWidget.callback === "function" ? textWidget.callback : null;
    textWidget.callback = function() {
      const r = origTextCb?.apply(this, arguments);
      refresh();
      return r;
    };
  }
}
export {
  attachInteractions
};
