// Core adapters (v6)
import type { Adapter, AdapterApplyContext, ComfyNode } from "../../types.js";
import { ops } from "../ops.js";

export function coreAdapters(): Adapter[] {
  return [
    {
      name: "core:ImageInvert",
      match(node: ComfyNode): boolean { return String(node?.comfyClass ?? "") === "ImageInvert"; },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.invert(ctx, canvasSize, node); }
    },
    {
      name: "core:ImageSharpen",
      match(node: ComfyNode): boolean { return String(node?.comfyClass ?? "") === "ImageSharpen"; },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.sharpen(ctx, canvasSize, node); }
    },
    {
      name: "core:ImageBlend",
      match(node: ComfyNode): boolean { return String(node?.comfyClass ?? "") === "ImageBlend"; },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<void> { ops.merge(ctx, canvasSize, node, inputs[1]); }
    },
  ];
}
