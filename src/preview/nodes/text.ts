import type { ComfyNode } from "../../types.js";
import { setWidgetStringValuesByName, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsText";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export type TextControlsUi = {
  controls: HTMLDivElement | null;
};

export function createTextControlsUi(): TextControlsUi {
  return { controls: null };
}

const TEXT_ALIGN_OPTIONS = new Set(["left", "center", "right"]);

export function hideTextWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
}

export function getTextInfoText(node: ComfyNode): string {
  const text = String(widgetString(node, "text", "ImageOps Text") || "");
  const lineCount = Math.max(1, text.split(/\r?\n/).length);
  const fontSize = Math.max(1, Math.round(widgetNumber(node, "font_size", 64)));
  const align = widgetString(node, "align", "center");
  const opacity = Math.round(Math.max(0, Math.min(1, widgetNumber(node, "opacity", 1))) * 100);
  const bypass = widgetBoolean(node, "bypass", false) ? ", bypass" : "";
  return `Text preview (${lineCount} line${lineCount === 1 ? "" : "s"}, ${fontSize}px, ${align}, ${opacity}%${bypass})`;
}

export function syncTextWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  hideTextWidgets(node);

  const color = widgetString(node, "color", "#ffffff");
  const strokeColor = widgetString(node, "stroke_color", "#000000");
  setWidgetStringValuesByName(node, "color", color, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "stroke_color", strokeColor, { notify: false, dirty: false });
}

