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
      const maskConnected = (node.inputs ?? []).some((input, index) => String(input?.name ?? "").toLowerCase() === "mask" && (node.inputs?.[index]?.link ?? null) != null);
      if (cls === "ImageOpsNoise") return 0;
      if (cls === "ImageOpsDistort") {
        const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
        const effectMaskConnected = (node.inputs?.[2]?.link ?? null) != null;
        return 1 + Number(displacementConnected) + Number(effectMaskConnected);
      }
      if (cls === "ImageOpsMerge") return bypass ? 1 : (maskConnected ? 3 : 2);
      if (cls === "ImageOpsComp") return getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null).length;
      if (cls === "ImageOpsDraw") return (node.inputs?.[0]?.link ?? null) != null ? 1 : 0;
      if (cls === "ImageOpsPreview") {
        const imageConnected = (node.inputs?.[0]?.link ?? null) != null;
        const maskConnected = (node.inputs?.[1]?.link ?? null) != null;
        return Number(imageConnected) + Number(maskConnected);
      }
      return maskConnected ? 2 : 1;
    },
    inputIndexes: (node: ComfyNode): number[] => {
      const cls = String(node?.comfyClass ?? "");
      if (cls === "ImageOpsComp") {
        return getCompSlots(node)
          .filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null)
          .map((slot) => slot.inputIndex);
      }
      if (cls === "ImageOpsDistort") {
        const indexes = [0];
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        if ((node.inputs?.[2]?.link ?? null) != null) indexes.push(2);
        return indexes;
      }
      if (cls === "ImageOpsPreview") {
        const indexes: number[] = [];
        if ((node.inputs?.[0]?.link ?? null) != null) indexes.push(0);
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        return indexes;
      }
      return [];
    },
    async apply({ node, ctx, canvasSize, inputs, outputSlot, tick }: AdapterApplyContext): Promise<HTMLCanvasElement | void> {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find(w => w?.name === "bypass")?.value;
      if (outputSlot === 1 && cls !== "ImageOpsPreview") {
        if (cls === "ImageOpsDraw") {
          return await ops.drawMask(ctx, canvasSize, node, inputs);
        }
        return ops.imageOpsMask(ctx, canvasSize, node, cls, inputs, tick ?? 0) ?? inputs[0];
      }
      if (bypass && cls !== "ImageOpsDraw") return;
      if (cls === "ImageOpsColorAjust") {
        return ops.colorAjust(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsChannel") {
        return ops.channel(ctx, canvasSize, node, outputSlot, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCrop") {
        return ops.crop(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsBlur") {
        return ops.blur(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsTransform") {
        return ops.transform(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsInvert") {
        return ops.invert(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsClamp") {
        return ops.clamp(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsMerge") {
        return ops.merge(ctx, canvasSize, node, inputs, undefined, tick ?? 0);
      } else if (cls === "ImageOpsComp") {
        return ops.comp(ctx, canvasSize, node, inputs);
      } else if (cls === "ImageOpsDistort") {
        return ops.distort(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsNoise") {
        return ops.noise(ctx, canvasSize, node, tick ?? 0);
      } else if (cls === "ImageOpsDraw") {
        return await ops.draw(ctx, canvasSize, node, inputs);
      } else if (cls === "ImageOpsPreview") {
        const previewTarget = String((node?.widgets ?? []).find((widget) => widget?.name === "preview_target")?.value ?? "auto").toLowerCase();
        if (outputSlot === 1) return inputs[1] ?? inputs[0];
        if (outputSlot === 0) return inputs[0] ?? inputs[1];
        if (previewTarget === "mask") return inputs[1] ?? inputs[0];
        if (previewTarget === "image") return inputs[0] ?? inputs[1];
        return inputs[0] ?? inputs[1];
      } else {
        // Preview / Load pass-through
      }
    }
  };
}
