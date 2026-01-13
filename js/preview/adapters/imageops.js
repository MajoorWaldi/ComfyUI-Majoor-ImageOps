// ImageOps adapters (exact match) (v6)
import { ops } from "../ops.js";

export function imageOpsAdapter() {
  return {
    match(node) {
      return String(node?.comfyClass ?? "").startsWith("ImageOps");
    },
    inputs: (node) => {
      const cls = String(node?.comfyClass ?? "");
      if (cls === "ImageOpsMerge") return 2;
      return 1;
    },
    async apply({ node, ctx, canvasSize, inputs }) {
      const cls = String(node?.comfyClass ?? "");
      if (cls === "ImageOpsColorCorrect") {
        ops.colorCorrect(ctx, canvasSize, node);
      } else if (cls === "ImageOpsBlur") {
        ops.blur(ctx, canvasSize, node);
      } else if (cls === "ImageOpsTransform") {
        ops.transform(ctx, canvasSize, node);
      } else if (cls === "ImageOpsGradeLevels") {
        ops.levels(ctx, canvasSize, node);
      } else if (cls === "ImageOpsHueSat") {
        ops.hueSat(ctx, canvasSize, node);
      } else if (cls === "ImageOpsInvert") {
        ops.invert(ctx, canvasSize, node);
      } else if (cls === "ImageOpsClamp") {
        ops.clamp(ctx, canvasSize, node);
      } else if (cls === "ImageOpsSharpen") {
        ops.sharpen(ctx, canvasSize, node);
      } else if (cls === "ImageOpsEdgeDetect") {
        ops.edgeDetect(ctx, canvasSize, node);
      } else if (cls === "ImageOpsGlow") {
        ops.glow(ctx, canvasSize, node);
      } else if (cls === "ImageOpsCropReformat") {
        ops.cropReformat(ctx, canvasSize, node);
      } else if (cls === "ImageOpsLumaKey") {
        ops.lumaKey(ctx, canvasSize, node);
      } else if (cls === "ImageOpsMerge") {
        ops.merge(ctx, canvasSize, node, inputs[1]);
      } else {
        // Preview / Load / Roto mask pass-through
      }
    }
  };
}
