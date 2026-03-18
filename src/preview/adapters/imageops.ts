// ImageOps adapters (exact match) (v6)
import type { Adapter, AdapterApplyContext, ComfyNode } from "../../types.js";
import { ops } from "../ops.js";
import { getCompSlots } from "../comp.js";

export function imageOpsAdapter(): Adapter {
  return {
    match(node: ComfyNode): boolean {
      return String(node?.comfyClass ?? "").startsWith("ImageOps");
    },
    inputs: (node: ComfyNode): number => {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find(w => w?.name === "bypass")?.value;
      if (cls === "ImageOpsMerge") return bypass ? 1 : 2;
      if (cls === "ImageOpsComp") return getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null).length;
      if (cls === "ImageOpsDraw") return (node.inputs?.[0]?.link ?? null) != null ? 1 : 0;
      return 1;
    },
    inputIndexes: (node: ComfyNode): number[] => {
      const cls = String(node?.comfyClass ?? "");
      if (cls === "ImageOpsComp") {
        return getCompSlots(node)
          .filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null)
          .map((slot) => slot.inputIndex);
      }
      return [];
    },
    async apply({ node, ctx, canvasSize, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement | void> {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find(w => w?.name === "bypass")?.value;
      if (bypass && cls !== "ImageOpsDraw") return;
      if (cls === "ImageOpsColorAjust") {
        ops.colorAjust(ctx, canvasSize, node);
      } else if (cls === "ImageOpsChannel") {
        ops.channel(ctx, canvasSize, node);
      } else if (cls === "ImageOpsCrop") {
        return ops.crop(ctx, canvasSize, node);
      } else if (cls === "ImageOpsBlur") {
        ops.blur(ctx, canvasSize, node);
      } else if (cls === "ImageOpsTransform") {
        return ops.transform(ctx, canvasSize, node);
      } else if (cls === "ImageOpsInvert") {
        ops.invert(ctx, canvasSize, node);
      } else if (cls === "ImageOpsClamp") {
        ops.clamp(ctx, canvasSize, node);
      } else if (cls === "ImageOpsMerge") {
        ops.merge(ctx, canvasSize, node, inputs[1]);
      } else if (cls === "ImageOpsComp") {
        return ops.comp(ctx, canvasSize, node, inputs);
      } else if (cls === "ImageOpsDraw") {
        return await ops.draw(ctx, canvasSize, node, inputs);
      } else {
        // Preview / Load pass-through
      }
    }
  };
}
