import { ops } from "./implementation.js";

export const maskOps = {
  imageOpsMask: ops.imageOpsMask,
  channelApply: ops.channelApply,
};


// Extracted with ts-morph

export function channelApply(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    const base = fitCanvas(inputs[0] ?? ctx.canvas, (inputs[0] ?? ctx.canvas).width || 1, (inputs[0] ?? ctx.canvas).height || 1);
    const mask = inputs[1] ? fitCanvas(inputs[1], base.width, base.height) : null;
    if (!mask) return base;

    const bctx = base.getContext("2d", { willReadFrequently: true })!;
    const image = bctx.getImageData(0, 0, base.width, base.height);
    const data = image.data;
    const matte = mask.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, base.width, base.height).data;
    const channel = strAny(node, ["channel"], "A").toLowerCase();
    const channelIndex = channel === "g" || channel === "green" ? 1 : channel === "b" || channel === "blue" ? 2 : channel === "a" || channel === "alpha" ? 3 : 0;

    for (let i = 0; i < data.length; i += 4) {
      const value = Math.round(clamp01((matte[i] / 255) * (matte[i + 3] / 255)) * 255);
      data[i + channelIndex] = value;
    }
    bctx.putImageData(image, 0, 0);
    return base;
  }

export function imageOpsMask(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, cls: string, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement | null {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const resolvedMask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);

    if (cls === "ImageOpsMaskConvert") {
      return boolAny(node, ["reverse"], false, frameIndex)
        ? imageToMaskPreviewCanvas(source, node, frameIndex)
        : buildMaskAlphaCanvas(source, source.width || 1, source.height || 1);
    }

    if (cls === "ImageOpsNoise") {
      return renderNoiseCanvas(node, true, frameIndex, W);
    }

    if (cls === "ImageOpsConstant") {
      return renderConstantCanvas(node, true);
    }

    if (cls === "ImageOpsRamp") {
      return renderRampCanvas(node, true);
    }

    if (cls === "ImageOpsDistort") {
      return renderDistortCanvas(node, inputs, frameIndex).mask;
    }

    if (cls === "ImageOpsBlur") {
      // Backend blur.py returns the *original* prepared mask as MASK output
      // (output_mask = output_mask_source) — the blur affects the image, not the
      // mask itself. Mirror that here so the Preview MASK matches what's
      // actually sent downstream. If no upstream mask, fall back to the
      // implicit alpha matte of the source.
      return resolvedMask ?? alphaMaskCanvas(source);
    }

    if (cls === "ImageOpsTransform") {
      return ops.transform(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
    }

    if (cls === "ImageOpsCrop") {
      return ops.crop(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
    }

    if (cls === "ImageOpsCropStitch") {
      return renderCropStitchCanvases(node, inputs, frameIndex).mask;
    }

    if (cls === "ImageOpsPadOut") {
      return renderPadOutCanvases(node, source, frameIndex).mask;
    }

    if (cls === "ImageOpsCornerPin") {
      return renderCornerPinCanvases(node, source, frameIndex).mask;
    }

    if (cls === "ImageOpsChannel") {
      const extracted = applyEffectToCanvas(source, (effectCtx, width, height) => {
        applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red", frameIndex));
      });
      return buildMaskAlphaCanvas(extracted, extracted.width || 1, extracted.height || 1);
    }

    if (cls === "ImageOpsClamp") {
      if (!resolvedMask) return alphaMaskCanvas(source);
      // Clamp only the alpha channel of the prepared mask (which encodes mask value in A,
      // RGB=255). Using applyClamp on the full canvas would turn RGB gray and cause
      // buildMaskAlphaCanvas to double-attenuate via luma*alpha.
      const lo = numAny(node, ["min_v", "min"], 0, frameIndex);
      const hi = numAny(node, ["max_v", "max"], 1, frameIndex);
      const mn = Math.round(clamp01(Math.min(lo, hi)) * 255);
      const mx = Math.round(clamp01(Math.max(lo, hi)) * 255);
      const clampMaskOut = makeCanvas(resolvedMask.width || 1, resolvedMask.height || 1);
      const clampMaskCtx = clampMaskOut.getContext("2d", { willReadFrequently: true })!;
      clampMaskCtx.drawImage(resolvedMask, 0, 0);
      const clampImg = clampMaskCtx.getImageData(0, 0, clampMaskOut.width, clampMaskOut.height);
      const clampData = clampImg.data;
      for (let ci = 0; ci < clampData.length; ci += 4) {
        clampData[ci] = 255; clampData[ci + 1] = 255; clampData[ci + 2] = 255;
        clampData[ci + 3] = Math.max(mn, Math.min(mx, clampData[ci + 3]));
      }
      clampMaskCtx.putImageData(clampImg, 0, 0);
      return markPreparedMaskCanvas(clampMaskOut);
    }

    if (cls === "ImageOpsKeyer") {
      return renderKeyerCanvases(node, source, rawMask, frameIndex).mask;
    }

    if (cls === "ImageOpsInvert") {
      const mask = resolvedMask ?? alphaMaskCanvas(source);
      return mask;
    }

    if (cls === "ImageOpsSpherize") {
      return renderSpherizeMaskCanvas(node, source, rawMask, frameIndex);
    }

    if (cls === "ImageOpsMerge") {
      // inputs = [A, B, mask?] — inputs[1] is foreground B, not the mask input
      const mergeMaskInput = inputs[2] ?? null;
      if (mergeMaskInput) {
        const mergeResolvedMask = resolvePreviewMaskCanvas(node, source, mergeMaskInput, frameIndex);
        if (mergeResolvedMask) return mergeResolvedMask;
      }
      const merged = ops.merge(ctx, W, node, inputs, undefined, frameIndex);
      return alphaMaskCanvas(merged);
    }

    if (cls === "ImageOpsComp") {
      const mask = alphaMaskCanvas(ops.comp(ctx, W, node, inputs));
      return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(mask) : mask;
    }

    if (cls === "ImageOpsColorAjust") {
      return resolvedMask ?? alphaMaskCanvas(source);
    }

    return resolvedMask ?? alphaMaskCanvas(source);
  }

