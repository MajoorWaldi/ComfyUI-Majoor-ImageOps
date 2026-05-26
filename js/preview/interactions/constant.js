import { syncDarkColorInputUI } from "../shared/dom-styles.js";
import { isNode as isConstantNode, syncConstantWidgets } from "../nodes/constant.js";
import { findWidget, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue } from "../shared/widgets.js";
const CONSTANT_RATIO_PRESETS = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
  "9:16": 9 / 16
};
function clampInt(value, fallback, min, max) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}
function attachInteractions(node, ctx) {
  if (!isConstantNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.previewRoot;
  if (!st || !root || root.dataset.constantInteractiveHooked === "1") return;
  root.dataset.constantInteractiveHooked = "1";
  const refresh = () => {
    syncConstantWidgets(node);
    ctx.refreshNode(node);
  };
  for (const button of Array.from(root.querySelectorAll("button[data-constant-mode]"))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setWidgetStringValue(findWidget(node, "mode"), String(button.dataset.constantMode ?? "constant"));
      refresh();
    });
  }
  for (const input of Array.from(root.querySelectorAll("input[data-constant-field]"))) {
    const field = String(input.dataset.constantField ?? "");
    if (field === "alpha") {
      input.addEventListener("input", () => {
        const value = Math.max(0, Math.min(100, Number(input.value)));
        setWidgetValue(findWidget(node, "alpha"), value / 100);
        refresh();
      });
      continue;
    }
  }
  for (const input of Array.from(root.querySelectorAll("input[data-constant-color]"))) {
    input.addEventListener("input", () => {
      const channel = String(input.dataset.constantColor ?? "a");
      const widgetName = channel === "b" ? "color_b" : "color";
      const normalized = String(input.value || (channel === "b" ? "#000000" : "#ffffff"));
      setWidgetStringValuesByName(node, widgetName, normalized);
      syncDarkColorInputUI(input, normalized);
      refresh();
    });
  }
  syncConstantWidgets(node);
}
export {
  attachInteractions
};
