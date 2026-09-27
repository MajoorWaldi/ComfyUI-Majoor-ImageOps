import { createContextMenuSelect, styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsPreview";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
const COMPARE_MODES = [
  ["live", "Live"],
  ["backend", "Backend"],
  ["wipe", "Wipe"],
  ["diff", "Diff"]
];
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
  const compareRow = document.createElement("div");
  compareRow.style.display = "grid";
  compareRow.style.gridTemplateColumns = `repeat(${COMPARE_MODES.length}, 1fr)`;
  compareRow.style.gap = "6px";
  for (const [value, label] of COMPARE_MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = value === "live" ? "Interactive canvas proxy (default)" : value === "backend" ? "Show the last real queued result for this frame" : value === "wipe" ? "Drag the divider to wipe between live proxy and backend result" : "Highlight per-pixel differences between live proxy and backend result";
    button.dataset.compareMode = value;
    styleSoftButton(button, value === "live");
    compareRow.appendChild(button);
  }
  controls.appendChild(compareRow);
  const wipeTrack = document.createElement("div");
  wipeTrack.dataset.wipeTrack = "1";
  wipeTrack.style.position = "relative";
  wipeTrack.style.height = "14px";
  wipeTrack.style.background = "rgba(255,255,255,0.09)";
  wipeTrack.style.borderRadius = "4px";
  wipeTrack.style.cursor = "ew-resize";
  wipeTrack.style.userSelect = "none";
  wipeTrack.style.display = "none";
  wipeTrack.title = "Live \u2194 Backend wipe position";
  const wipeHandle = document.createElement("div");
  wipeHandle.style.position = "absolute";
  wipeHandle.style.top = "0";
  wipeHandle.style.width = "4px";
  wipeHandle.style.height = "100%";
  wipeHandle.style.background = "#3b82f6";
  wipeHandle.style.transform = "translateX(-50%)";
  wipeHandle.style.left = "50%";
  wipeHandle.style.borderRadius = "2px";
  wipeHandle.style.pointerEvents = "none";
  wipeTrack.appendChild(wipeHandle);
  controls.appendChild(wipeTrack);
  return { controls };
}
function hidePreviewWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "preview_target"));
  hideWidgetForGood(node, findWidget(node, "mode"));
}
function isImageBConnected(node) {
  return (node.inputs ?? []).some((input) => String(input?.name ?? "").toLowerCase() === "image_b" && (input?.link ?? null) != null);
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
  const compareMode = st?.previewCompareMode ?? "live";
  const hasImageB = isImageBConnected(node);
  for (const button of Array.from(root.querySelectorAll("button[data-compare-mode]"))) {
    styleSoftButton(button, button.dataset.compareMode === compareMode);
    if (button.dataset.compareMode === "backend") {
      button.textContent = hasImageB ? "B" : "Backend";
      button.title = hasImageB ? "Show the B input alone" : "Show the last real queued result for this frame";
    } else if (button.dataset.compareMode === "wipe") {
      button.title = hasImageB ? "Drag the divider to wipe between A and B" : "Drag the divider to wipe between live proxy and backend result";
    } else if (button.dataset.compareMode === "diff") {
      button.title = hasImageB ? "Highlight per-pixel differences between A and B" : "Highlight per-pixel differences between live proxy and backend result";
    } else if (button.dataset.compareMode === "live") {
      button.title = hasImageB ? "Show the A input alone (interactive canvas proxy)" : "Interactive canvas proxy (default)";
    }
  }
  const wipeTrack = root.querySelector("div[data-wipe-track]");
  if (wipeTrack) {
    wipeTrack.style.display = compareMode === "wipe" ? "block" : "none";
    wipeTrack.title = hasImageB ? "A \u2194 B wipe position" : "Live \u2194 Backend wipe position";
    const handle = wipeTrack.firstElementChild;
    if (handle) handle.style.left = `${Math.max(0, Math.min(1, st?.previewWipeFraction ?? 0.5)) * 100}%`;
  }
}
export {
  NODE_CLASS,
  createPreviewControlsUi,
  hidePreviewWidgets,
  isNode,
  syncPreviewWidgets
};
