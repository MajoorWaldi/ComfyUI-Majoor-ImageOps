import type { ComfyNode } from "../../types.js";
import { findWidget, hideWidgetForGood } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsTransform";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function hideTransformWidgets(node: ComfyNode): void {
  hideWidgetForGood(node, findWidget(node, "expand"));
}
