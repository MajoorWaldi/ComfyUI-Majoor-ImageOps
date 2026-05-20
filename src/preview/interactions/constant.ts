import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { syncDarkColorInputUI } from "../shared/dom-styles.js";
import { isNode as isConstantNode, syncConstantWidgets } from "../nodes/constant.js";
import { findWidget, setWidgetStringValue, setWidgetStringValuesByName, setWidgetValue } from "../shared/widgets.js";

const CONSTANT_RATIO_PRESETS: Record<string, number> = {
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

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isConstantNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.previewRoot as HTMLElement | null;
  if (!st || !root || root.dataset.constantInteractiveHooked === "1") return;
  root.dataset.constantInteractiveHooked = "1";

  const refresh = (): void => {
    syncConstantWidgets(node);
    ctx.refreshNode(node);
  };

  const ratioSelect = root.querySelector<HTMLSelectElement>('select[data-constant-ratio="1"]');

  const applyRatioPreset = (changedField: "width" | "height"): void => {
    const preset = String(ratioSelect?.value ?? "custom");
    const ratio = CONSTANT_RATIO_PRESETS[preset];
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

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-constant-mode]'))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setWidgetStringValue(findWidget(node, "mode"), String(button.dataset.constantMode ?? "constant"));
      refresh();
    });
  }

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-constant-field]'))) {
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

  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input[data-constant-color]'))) {
    input.addEventListener("input", () => {
      const channel = String(input.dataset.constantColor ?? "a");
      const widgetName = channel === "b" ? "color_b" : "color";
      const normalized = String(input.value || (channel === "b" ? "#000000" : "#ffffff"));
      setWidgetStringValuesByName(node, widgetName, normalized);
      syncDarkColorInputUI(input, normalized);
      refresh();
    });
  }

  ratioSelect?.addEventListener("change", () => {
    const preset = String(ratioSelect.value ?? "custom");
    if (preset !== "custom") {
      applyRatioPreset("width");
    }
    refresh();
  });

  syncConstantWidgets(node);
}
