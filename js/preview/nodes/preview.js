import { findWidget, hideWidgetForGood, widgetString } from "../shared/widgets.js";
import { styleSoftButton } from "../shared/dom-styles.js";
const NODE_CLASS = "ImageOpsPreview";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function hidePreviewWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "preview_target"));
  hideWidgetForGood(node, findWidget(node, "mode"));
}
function syncPreviewWidgets(node) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.canvas?.parentElement;
  if (!root) return;
  const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();
  const mode = widgetString(node, "mode", "images").toLowerCase();
  for (const button of Array.from(root.querySelectorAll("button[data-preview-target]"))) {
    styleSoftButton(button, button.dataset.previewTarget === previewTarget);
  }
  const modeSelect = root.querySelector("select[data-preview-mode]");
  if (modeSelect) modeSelect.value = mode;
}
export {
  NODE_CLASS,
  hidePreviewWidgets,
  isNode,
  syncPreviewWidgets
};
