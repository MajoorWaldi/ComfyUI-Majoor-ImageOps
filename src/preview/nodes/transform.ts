import type { ComfyNode } from "../../types.js";

export const NODE_CLASS = "ImageOpsTransform";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
