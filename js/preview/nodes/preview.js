import { createContextMenuSelect, styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsPreview";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createPreviewControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "6px";
  const targetRow = document.createElement("div");
  targetRow.style.display = "grid";
  targetRow.style.gridTemplateColumns = "auto auto auto minmax(0,1fr)";
  targetRow.style.gap = "6px";
  targetRow.style.alignItems = "center";
  for (const [value, label] of [["auto", "Auto"], ["image", "Image"], ["mask", "Mask"]]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.previewTarget = value;
    styleSoftButton(button, value === "auto");
    targetRow.appendChild(button);
  }
  const modeSelect = document.createElement("select");
  modeSelect.dataset.previewMode = "1";
  modeSelect.title = "Preview export mode";
  styleSoftField(modeSelect);
  modeSelect.style.width = "100%";
  for (const mode of ["images", "strip", "animated_webp", "animated_gif"]) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = mode.replace(/_/g, " ");
    modeSelect.appendChild(option);
  }
  targetRow.appendChild(createContextMenuSelect(modeSelect));
  controls.appendChild(targetRow);
  return { controls };
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
  createPreviewControlsUi,
  hidePreviewWidgets,
  isNode,
  syncPreviewWidgets
};
