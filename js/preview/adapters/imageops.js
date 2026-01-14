// ImageOps adapters (exact match) (v6)
import { ops } from "../ops.js";

export function imageOpsAdapter() {
  return {
    match(node) {
      return String(node?.comfyClass ?? "").startsWith("ImageOps");
    },
    inputs: (node) => {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find(w => w?.name === "bypass")?.value;
      if (cls === "ImageOpsMerge") return bypass ? 1 : 2;
      return 1;
    },
    async apply({ node, ctx, canvasSize, inputs }) {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find(w => w?.name === "bypass")?.value;
      if (bypass) return;
      if (cls === "ImageOpsColorAjust") {
        ops.colorAjust(ctx, canvasSize, node);
      } else if (cls === "ImageOpsBlur") {
        ops.blur(ctx, canvasSize, node);
      } else if (cls === "ImageOpsTransform") {
        ops.transform(ctx, canvasSize, node);
      } else if (cls === "ImageOpsInvert") {
        ops.invert(ctx, canvasSize, node);
      } else if (cls === "ImageOpsClamp") {
        ops.clamp(ctx, canvasSize, node);
      } else if (cls === "ImageOpsMerge") {
        ops.merge(ctx, canvasSize, node, inputs[1]);
      } else {
        // Preview / Load pass-through
      }
    }
  };
}
