import { isNode as isGrainNode, syncGrainWidgets } from "../nodes/grain.js";
import { findWidget, setWidgetBooleanValue, setWidgetStringValue, setWidgetValue } from "../shared/widgets.js";
function clampFloat(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
function attachInteractions(node, ctx) {
  if (!isGrainNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.previewRoot;
  if (!st || !root || root.dataset.grainInteractiveHooked === "1") return;
  root.dataset.grainInteractiveHooked = "1";
  const refresh = () => {
    syncGrainWidgets(node);
    ctx.refreshNode(node);
  };
  const blendSelect = root.querySelector('select[data-grain-select="blend_mode"]');
  blendSelect?.addEventListener("change", () => {
    setWidgetStringValue(findWidget(node, "blend_mode"), String(blendSelect.value || "add"));
    refresh();
  });
  const amountInput = root.querySelector('input[data-grain-field="amount"]');
  amountInput?.addEventListener("input", () => {
    const value = clampFloat(Number(amountInput.value) / 100, 0.08, 0, 1);
    setWidgetValue(findWidget(node, "amount"), value);
    refresh();
  });
  for (const button of Array.from(root.querySelectorAll("button[data-grain-toggle]"))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const field = String(button.dataset.grainToggle ?? "");
      if (!field) return;
      const widget = findWidget(node, field);
      setWidgetBooleanValue(widget, !Boolean(widget?.value));
      refresh();
    });
  }
  syncGrainWidgets(node);
}
export {
  attachInteractions
};
