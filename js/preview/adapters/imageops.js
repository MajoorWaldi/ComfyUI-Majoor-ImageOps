import { ops } from "../ops.js";
import { getCompSlots } from "../comp.js";
import { clampDrawDimension, makeSolidBackgroundCanvas } from "../draw.js";
function getConnectedCompInputIndexes(node) {
  const indexes = [];
  for (const slot of getCompSlots(node)) {
    if ((node.inputs?.[slot.inputIndex]?.link ?? null) == null) continue;
    indexes.push(slot.inputIndex);
    if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
      indexes.push(slot.maskInputIndex);
    }
  }
  return indexes;
}
function getConnectedPadOutStitchInputIndexes(node) {
  return [0, 1, 2, 3].filter((index) => (node.inputs?.[index]?.link ?? null) != null);
}
function mapPadOutStitchInputs(node, inputs) {
  const mapped = [];
  let cursor = 0;
  for (const index of getConnectedPadOutStitchInputIndexes(node)) {
    mapped[index] = inputs[cursor++];
  }
  return [
    mapped[1] ?? mapped[2],
    mapped[0],
    mapped[2],
    mapped[3]
  ];
}
function imageOpsAdapter() {
  return {
    match(node) {
      return String(node?.comfyClass ?? "").startsWith("ImageOps");
    },
    inputs: (node) => {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find((w) => w?.name === "bypass")?.value;
      const maskConnected = (node.inputs ?? []).some((input, index) => String(input?.name ?? "").toLowerCase() === "mask" && (node.inputs?.[index]?.link ?? null) != null);
      if (cls === "ImageOpsNoise") return 0;
      if (cls === "ImageOpsMaskConvert") {
        const reverse = !!(node?.widgets ?? []).find((widget) => widget?.name === "reverse")?.value;
        const imageConnected = (node.inputs?.[0]?.link ?? null) != null;
        const maskConnected2 = (node.inputs?.[1]?.link ?? null) != null;
        return reverse ? Number(imageConnected) : Number(maskConnected2);
      }
      if (cls === "ImageOpsDistort") {
        const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
        const effectMaskConnected = (node.inputs?.[2]?.link ?? null) != null;
        return 1 + Number(displacementConnected) + Number(effectMaskConnected);
      }
      if (cls === "ImageOpsMerge") return bypass ? 1 : maskConnected ? 3 : 2;
      if (cls === "ImageOpsComp") return getConnectedCompInputIndexes(node).length;
      if (cls === "ImageOpsDraw") return (node.inputs?.[0]?.link ?? null) != null ? 1 : 0;
      if (cls === "ImageOpsPadOutStitch") return getConnectedPadOutStitchInputIndexes(node).length;
      if (cls === "ImageOpsPreview") {
        const imageConnected = (node.inputs?.[0]?.link ?? null) != null;
        const maskConnected2 = (node.inputs?.[1]?.link ?? null) != null;
        return Number(imageConnected) + Number(maskConnected2);
      }
      return maskConnected ? 2 : 1;
    },
    inputIndexes: (node) => {
      const cls = String(node?.comfyClass ?? "");
      if (cls === "ImageOpsMaskConvert") {
        const reverse = !!(node?.widgets ?? []).find((widget) => widget?.name === "reverse")?.value;
        if (reverse) return (node.inputs?.[0]?.link ?? null) != null ? [0] : [];
        return (node.inputs?.[1]?.link ?? null) != null ? [1] : [];
      }
      if (cls === "ImageOpsComp") {
        return getConnectedCompInputIndexes(node);
      }
      if (cls === "ImageOpsDistort") {
        const indexes = [0];
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        if ((node.inputs?.[2]?.link ?? null) != null) indexes.push(2);
        return indexes;
      }
      if (cls === "ImageOpsPadOutStitch") {
        return getConnectedPadOutStitchInputIndexes(node);
      }
      if (cls === "ImageOpsPreview") {
        const indexes = [];
        if ((node.inputs?.[0]?.link ?? null) != null) indexes.push(0);
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        return indexes;
      }
      return [];
    },
    async apply({ node, ctx, canvasSize, inputs, outputSlot, tick }) {
      const cls = String(node?.comfyClass ?? "");
      const bypass = !!(node?.widgets ?? []).find((w) => w?.name === "bypass")?.value;
      if (cls === "ImageOpsMaskConvert") {
        return ops.imageOpsMask(ctx, canvasSize, node, cls, inputs, tick ?? 0) ?? inputs[0];
      }
      if (cls === "ImageOpsDraw" && outputSlot === 2) {
        return await ops.drawMask(ctx, canvasSize, node, inputs);
      }
      if (cls === "ImageOpsDraw" && outputSlot === 1) {
        const width = clampDrawDimension(Number((node?.widgets ?? []).find((widget) => widget?.name === "width")?.value ?? 1024), 1024);
        const height = clampDrawDimension(Number((node?.widgets ?? []).find((widget) => widget?.name === "height")?.value ?? 1024), 1024);
        const bgColor = String((node?.widgets ?? []).find((widget) => widget?.name === "bg_color")?.value ?? "#000000");
        return inputs[0] ?? makeSolidBackgroundCanvas(width, height, bgColor);
      }
      if (cls === "ImageOpsPadOut" && outputSlot === 2) {
        return ops.padOutStitcher(ctx, canvasSize, node, inputs, tick ?? 0);
      }
      if (cls === "ImageOpsPadOutStitch" && outputSlot === 1) {
        return ops.imageOpsMask(ctx, canvasSize, node, cls, mapPadOutStitchInputs(node, inputs), tick ?? 0) ?? inputs[0];
      }
      if (outputSlot === 1 && cls !== "ImageOpsPreview" && cls !== "ImageOpsDraw") {
        return ops.imageOpsMask(ctx, canvasSize, node, cls, inputs, tick ?? 0) ?? inputs[0];
      }
      if (bypass && cls !== "ImageOpsDraw") return;
      if (cls === "ImageOpsColorAjust") {
        return ops.colorAjust(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsChannel") {
        return ops.channel(ctx, canvasSize, node, outputSlot, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCrop") {
        return ops.crop(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsPadOut") {
        return ops.padOut(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsPadOutStitch") {
        return ops.padOutStitch(ctx, canvasSize, node, mapPadOutStitchInputs(node, inputs), tick ?? 0);
      } else if (cls === "ImageOpsCornerPin") {
        return ops.cornerPin(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsBlur") {
        return ops.blur(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsTransform") {
        return ops.transform(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsInvert") {
        return ops.invert(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsClamp") {
        return ops.clamp(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsMerge") {
        return ops.merge(ctx, canvasSize, node, inputs, void 0, tick ?? 0);
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
      }
    }
  };
}
export {
  imageOpsAdapter
};
