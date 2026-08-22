import { findWidget, hideWidgetForGood } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsTransform";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function hideTransformWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "expand"));
}
export {
  NODE_CLASS,
  hideTransformWidgets,
  isNode
};
