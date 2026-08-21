import type { ComfyNode } from "../../types.js";
import { findWidget, hideWidgetForGood, widgetString } from "../shared/widgets.js";
import { styleSoftButton } from "../shared/dom-styles.js";

export const NODE_CLASS = "ImageOpsPreview";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function hidePreviewWidgets(node: ComfyNode): void {
  hideWidgetForGood(node, findWidget(node, "preview_target"));
  hideWidgetForGood(node, findWidget(node, "mode"));
}

export function syncPreviewWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.canvas?.parentElement;
  if (!root) return;
  const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();
  const mode = widgetString(node, "mode", "images").toLowerCase();
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-preview-target]"))) {
    styleSoftButton(button, button.dataset.previewTarget === previewTarget);
  }
  const modeSelect = root.querySelector<HTMLSelectElement>("select[data-preview-mode]");
  if (modeSelect) modeSelect.value = mode;
}
