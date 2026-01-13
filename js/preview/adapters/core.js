// Core adapters (v6)
import { ops } from "../ops.js";

export function coreAdapters() {
  return [
    {
      name: "core:ImageInvert",
      match(node) { return String(node?.comfyClass ?? "") === "ImageInvert"; },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.invert(ctx, canvasSize, node); }
    },
    {
      name: "core:ImageSharpen",
      match(node) { return String(node?.comfyClass ?? "") === "ImageSharpen"; },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.sharpen(ctx, canvasSize, node); }
    },
    {
      name: "core:ImageBlend",
      match(node) { return String(node?.comfyClass ?? "") === "ImageBlend"; },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }) { ops.merge(ctx, canvasSize, node, inputs[1]); }
    },
  ];
}
