import type { ComfyNode } from "../../types.js";

export const NODE_CLASS = "ImageOpsCameraShake";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
