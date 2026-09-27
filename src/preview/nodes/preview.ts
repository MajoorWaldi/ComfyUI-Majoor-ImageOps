import type { ComfyNode } from "../../types.js";
import { createContextMenuSelect, styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetString } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsPreview";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export type PreviewControlsUi = {
  controls: HTMLDivElement;
};

const COMPARE_MODES = [
  ["live", "Live"],
  ["backend", "Backend"],
  ["wipe", "Wipe"],
  ["diff", "Diff"],
] as const;

export function createPreviewControlsUi(): PreviewControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "6px";

  const targetRow = document.createElement("div");
  targetRow.style.display = "grid";
  targetRow.style.gridTemplateColumns = "auto auto auto minmax(0,1fr)";
  targetRow.style.gap = "6px";
  targetRow.style.alignItems = "center";

  for (const [value, label] of [["auto", "Auto"], ["image", "Image"], ["mask", "Mask"]] as const) {
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

  // Compare the interactive canvas proxy against the last real queued result,
  // at the same frame. Only meaningful once the queue has actually run.
  const compareRow = document.createElement("div");
  compareRow.style.display = "grid";
  compareRow.style.gridTemplateColumns = `repeat(${COMPARE_MODES.length}, 1fr)`;
  compareRow.style.gap = "6px";
  for (const [value, label] of COMPARE_MODES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = value === "live"
      ? "Interactive canvas proxy (default)"
      : value === "backend"
        ? "Show the last real queued result for this frame"
        : value === "wipe"
          ? "Drag the divider to wipe between live proxy and backend result"
          : "Highlight per-pixel differences between live proxy and backend result";
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
  wipeTrack.title = "Live ↔ Backend wipe position";
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

export function hidePreviewWidgets(node: ComfyNode): void {
  hideWidgetForGood(node, findWidget(node, "preview_target"));
  hideWidgetForGood(node, findWidget(node, "mode"));
}

function isImageBConnected(node: ComfyNode): boolean {
  return (node.inputs ?? []).some((input) => String(input?.name ?? "").toLowerCase() === "image_b" && (input?.link ?? null) != null);
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

  const compareMode = st?.previewCompareMode ?? "live";
  const hasImageB = isImageBConnected(node);
  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-compare-mode]"))) {
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
  const wipeTrack = root.querySelector<HTMLDivElement>("div[data-wipe-track]");
  if (wipeTrack) {
    wipeTrack.style.display = compareMode === "wipe" ? "block" : "none";
    wipeTrack.title = hasImageB ? "A ↔ B wipe position" : "Live ↔ Backend wipe position";
    const handle = wipeTrack.firstElementChild as HTMLDivElement | null;
    if (handle) handle.style.left = `${Math.max(0, Math.min(1, st?.previewWipeFraction ?? 0.5)) * 100}%`;
  }
}
