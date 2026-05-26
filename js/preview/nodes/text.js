import { setWidgetStringValuesByName, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsText";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createTextControlsUi() {
  return { controls: null };
}
const TEXT_ALIGN_OPTIONS = /* @__PURE__ */ new Set(["left", "center", "right"]);
function hideTextWidgets(node) {
  if (!isNode(node)) return;
}
function getTextInfoText(node) {
  const text = String(widgetString(node, "text", "ImageOps Text") || "");
  const lineCount = Math.max(1, text.split(/\r?\n/).length);
  const fontSize = Math.max(1, Math.round(widgetNumber(node, "font_size", 64)));
  const align = widgetString(node, "align", "center");
  const opacity = Math.round(Math.max(0, Math.min(1, widgetNumber(node, "opacity", 1))) * 100);
  const bypass = widgetBoolean(node, "bypass", false) ? ", bypass" : "";
  return `Text preview (${lineCount} line${lineCount === 1 ? "" : "s"}, ${fontSize}px, ${align}, ${opacity}%${bypass})`;
}
function syncTextWidgets(node) {
  if (!isNode(node)) return;
  hideTextWidgets(node);
  const color = widgetString(node, "color", "#ffffff");
  const strokeColor = widgetString(node, "stroke_color", "#000000");
  setWidgetStringValuesByName(node, "color", color, { notify: false, dirty: false });
  setWidgetStringValuesByName(node, "stroke_color", strokeColor, { notify: false, dirty: false });
}
export {
  NODE_CLASS,
  createTextControlsUi,
  getTextInfoText,
  hideTextWidgets,
  isNode,
  syncTextWidgets
};
