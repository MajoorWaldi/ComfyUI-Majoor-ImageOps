import type { ComfyNode } from "../../types.js";
import { getOpsConstants } from "../constants.js";
import { boolAny, numAny, strAny } from "../graph.js";
import { applyEffectToCanvas, canvasFieldCache, makeCanvas } from "../renderer.js";
import { comp, merge } from "./blend.js";
import { clamp01, luma01, renderKeyerCanvases } from "./color.js";
import { crop, fitCanvas, renderCornerPinCanvases, renderCropStitchCanvases, renderDistortCanvas, renderPadOutCanvases, transform } from "./geometry.js";
import { renderConstantCanvas, renderNoiseCanvas, renderRampCanvas } from "./procedural.js";
import { applyChannel } from "./video.js";
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
      return transform(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
    }

    if (cls === "ImageOpsCrop") {
      return crop(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
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
      const merged = merge(ctx, W, node, inputs, undefined, frameIndex);
      return alphaMaskCanvas(merged);
    }

    if (cls === "ImageOpsComp") {
      const mask = alphaMaskCanvas(comp(ctx, W, node, inputs));
      return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(mask) : mask;
    }

    if (cls === "ImageOpsColorAjust") {
      return resolvedMask ?? alphaMaskCanvas(source);
    }

    return resolvedMask ?? alphaMaskCanvas(source);
  }

export const maskOps = { imageOpsMask, channelApply };

export function prepareMaskCanvasInPlace(canvas: HTMLCanvasElement): HTMLCanvasElement {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return canvas;
    const width = canvas.width || 1;
    const height = canvas.height || 1;
    const image = ctx.getImageData(0, 0, width, height);
    const data = image.data;
    const weights = getOpsConstants().luma_weights;
    for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const luma = luma01(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255, weights);
    const matte = Math.round(clamp01(luma * alpha) * 255);
    const rgb = matte > 0 ? 255 : 0;
    data[index] = rgb;
    data[index + 1] = rgb;
    data[index + 2] = rgb;
    data[index + 3] = matte;
    }

    ctx.putImageData(image, 0, 0);
    preparedMaskCache.delete(canvas);
    canvasFieldCache.delete(canvas);
    return canvas;
}

export function markPreparedMaskCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
    prepareMaskCanvasInPlace(canvas);
    (canvas as MaskCanvas).__imageopsPreparedMask = true;
    return canvas;
}

export function isPreparedMaskCanvas(canvas: HTMLCanvasElement | null | undefined): canvas is MaskCanvas {
    return !!canvas && (canvas as MaskCanvas).__imageopsPreparedMask === true;
}

export function computeMaskBounds(maskCanvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number } | null {
    const ctx = maskCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const image = ctx.getImageData(0, 0, maskCanvas.width || 1, maskCanvas.height || 1);
    const data = image.data;
    let minX = maskCanvas.width;
    let minY = maskCanvas.height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < maskCanvas.height; y++) {
    for (let x = 0; x < maskCanvas.width; x++) {
      const offset = (y * maskCanvas.width + x) * 4;
      const alpha = data[offset + 3] / 255;
      const luma = luma01(data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, getOpsConstants().luma_weights);
      if (alpha * luma <= 0.001) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    }

    if (maxX < minX || maxY < minY) return null;
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function buildMaskAlphaCanvas(maskCanvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
    if (isPreparedMaskCanvas(maskCanvas) && (maskCanvas.width || 1) === width && (maskCanvas.height || 1) === height) {
    return maskCanvas;
    }

    const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}`;
    const cachedPrepared = preparedMaskCache.get(maskCanvas)?.get(cacheKey);
    if (cachedPrepared) return cachedPrepared;
    const output = makeCanvas(width, height);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, width, height);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(maskCanvas, 0, 0, width, height);
    const image = octx.getImageData(0, 0, width, height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const luma = luma01(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255, getOpsConstants().luma_weights);
    const matte = Math.round(clamp01(luma * alpha) * 255);
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = matte;
    }

    octx.putImageData(image, 0, 0);
    const prepared = markPreparedMaskCanvas(output);
    const cache = preparedMaskCache.get(maskCanvas) ?? new Map<string, HTMLCanvasElement>();
    cache.set(cacheKey, prepared);
    preparedMaskCache.set(maskCanvas, cache);
    return prepared;
}

export function maskCanvasToPreviewCanvas(maskCanvas: HTMLCanvasElement, includeAlpha: boolean = false): HTMLCanvasElement {
    const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
    const output = makeCanvas(prepared.width || 1, prepared.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.drawImage(prepared, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
    const matte = data[index + 3];
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = includeAlpha ? matte : 255;
    }

    octx.putImageData(image, 0, 0);
    return output;
}

export function alphaMaskCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
    const output = makeCanvas(source.width || 1, source.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, output.width, output.height);
    octx.drawImage(source, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
    const matte = data[index + 3];
    const rgb = matte > 0 ? 255 : 0;
    data[index] = rgb;
    data[index + 1] = rgb;
    data[index + 2] = rgb;
    data[index + 3] = matte;
    }

    octx.putImageData(image, 0, 0);
    return markPreparedMaskCanvas(output);
}

export function canvasHasVisibleTransparency(source: HTMLCanvasElement): boolean {
    const ctx = source.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, source.width || 1, source.height || 1).data;
    for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
    }

    return false;
}

export function maskConvertSourceValue(data: Uint8ClampedArray, index: number, sourceMode: string, useAlpha: boolean, lumaWeights: number[]): number {
    const normalized = String(sourceMode || "auto").toLowerCase().replace(/[-\s]+/g, "_");
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const a = data[index + 3] / 255;
    if (normalized === "auto" && useAlpha) return a;
    if (normalized === "alpha") return a;
    if (normalized === "red" || normalized === "r") return r;
    if (normalized === "green" || normalized === "g") return g;
    if (normalized === "blue" || normalized === "b") return b;
    if (normalized === "max_rgb" || normalized === "max" || normalized === "value" || normalized === "v") return Math.max(r, g, b);
    if (normalized === "saturation" || normalized === "sat" || normalized === "chroma") {
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    return hi > 1e-6 ? (hi - lo) / hi : 0;
    }

    return luma01(r, g, b, lumaWeights);
}

export function applyMaskConvertLevels(value: number, blackPoint: number, whitePoint: number): number {
    const black = clamp01(blackPoint);
    const white = Math.max(black + 1e-6, clamp01(whitePoint));
    return clamp01((value - black) / (white - black));
}

export function imageToMaskPreviewCanvas(source: HTMLCanvasElement, node?: ComfyNode, frameIndex: number = 0): HTMLCanvasElement {
    const output = makeCanvas(source.width || 1, source.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.drawImage(source, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    let minAlpha = 255;
    let maxAlpha = 255;
    for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3];
    if (alpha < minAlpha) minAlpha = alpha;
    if (alpha > maxAlpha) maxAlpha = alpha;
    }

    const useAlpha = (maxAlpha - minAlpha) > 0 || minAlpha < 255;
    const lw = getOpsConstants().luma_weights;
    const sourceMode = strAny(node ?? ({} as ComfyNode), ["mask_source", "source", "channel"], "auto", frameIndex);
    for (let index = 0; index < data.length; index += 4) {
    const matte = Math.round(clamp01(maskConvertSourceValue(data, index, sourceMode, useAlpha, lw)) * 255);
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = 255;
    }

    octx.putImageData(image, 0, 0);
    const antialiasRadius = Math.max(0, numAny(node ?? ({} as ComfyNode), ["antialias_radius", "mask_antialias", "antialias"], 0, frameIndex));
    const levelsSource = antialiasRadius > 0 ? makeCanvas(output.width, output.height) : output;
    if (antialiasRadius > 0) {
    const blurCtx = levelsSource.getContext("2d", { willReadFrequently: true })!;
    blurCtx.filter = `blur(${antialiasRadius}px)`;
    blurCtx.drawImage(output, 0, 0);
    blurCtx.filter = "none";
    }

    const blackPoint = numAny(node ?? ({} as ComfyNode), ["black_point", "black"], 0, frameIndex);
    const whitePoint = numAny(node ?? ({} as ComfyNode), ["white_point", "white"], 1, frameIndex);
    const levelsCtx = levelsSource.getContext("2d", { willReadFrequently: true })!;
    const levelsImage = levelsCtx.getImageData(0, 0, levelsSource.width, levelsSource.height);
    const levelsData = levelsImage.data;
    for (let index = 0; index < levelsData.length; index += 4) {
    const matte = Math.round(applyMaskConvertLevels(levelsData[index] / 255, blackPoint, whitePoint) * 255);
    const rgb = matte > 0 ? 255 : 0;
    levelsData[index] = rgb;
    levelsData[index + 1] = rgb;
    levelsData[index + 2] = rgb;
    levelsData[index + 3] = matte;
    }

    levelsCtx.putImageData(levelsImage, 0, 0);
    return markPreparedMaskCanvas(levelsSource);
}

export function resolvePreviewMaskCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number = 0): HTMLCanvasElement | null {
    if (!rawMask) return null;
    const matte = buildMaskAlphaCanvas(rawMask, source.width || 1, source.height || 1);
    return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(matte) : matte;
}

export function compositeProcessedWithMask(baseCanvas: HTMLCanvasElement, processedCanvas: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null): HTMLCanvasElement {
    if (!maskCanvas) return processedCanvas;
    const output = makeCanvas(processedCanvas.width || 1, processedCanvas.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.clearRect(0, 0, output.width, output.height);
    octx.drawImage(baseCanvas, 0, 0, output.width, output.height);
    octx.drawImage(
    premultLayerWithMask(processedCanvas, maskCanvas),
    0,
    0,
    output.width,
    output.height,
    );
    return output;
}

export function renderMaskedEffectPreview(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, processImage: (input: HTMLCanvasElement) => HTMLCanvasElement, options: {
    premultBeforeProcess?: boolean;
    processMask?: ((mask: HTMLCanvasElement) => HTMLCanvasElement) | null;
    baseCanvas?: HTMLCanvasElement | null;
    compositeWithBase?: boolean;
    frameIndex?: number;
    } = {}): HTMLCanvasElement {
    const mask = resolvePreviewMaskCanvas(node, source, rawMask, options.frameIndex ?? 0);
    if (!mask) return processImage(source);
    const processed = processImage(options.premultBeforeProcess ? premultLayerWithMask(source, mask) : source);
    if (options.compositeWithBase === false) return processed;
    const processedMask = options.processMask
            ? options.processMask(mask)
            : fitCanvas(mask, processed.width || 1, processed.height || 1);
    return compositeProcessedWithMask(options.baseCanvas ?? source, processed, processedMask);
}

export function premultLayerWithMask(imageCanvas: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null): HTMLCanvasElement {
    if (!maskCanvas) return imageCanvas;
    const output = makeCanvas(imageCanvas.width || 1, imageCanvas.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, output.width, output.height);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(imageCanvas, 0, 0, output.width, output.height);
    octx.globalCompositeOperation = "destination-in";
    const preparedMask = isPreparedMaskCanvas(maskCanvas) && (maskCanvas.width || 1) === output.width && (maskCanvas.height || 1) === output.height
            ? maskCanvas
            : buildMaskAlphaCanvas(maskCanvas, output.width, output.height);
    octx.drawImage(preparedMask, 0, 0, output.width, output.height);
    octx.globalCompositeOperation = "source-over";
    return output;
}

export function invertMaskCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
    const output = makeCanvas(prepared.width || 1, prepared.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.drawImage(prepared, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    data[i + 3] = 255 - data[i + 3];
    }

    octx.putImageData(image, 0, 0);
    return markPreparedMaskCanvas(output);
}

export function invertMaskAlphaCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
    return invertMaskCanvas(maskCanvas);
}

export function normalizePreparedMaskCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
    const prepared = isPreparedMaskCanvas(maskCanvas)
            ? maskCanvas
            : buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
    const output = makeCanvas(prepared.width || 1, prepared.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.drawImage(prepared, 0, 0, output.width, output.height);
    const image = octx.getImageData(0, 0, output.width, output.height);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      continue;
    }
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
    }

    octx.putImageData(image, 0, 0);
    return markPreparedMaskCanvas(output);
}

export function blurMaskAlphaCanvas(maskCanvas: HTMLCanvasElement, radius: number): HTMLCanvasElement {
    const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
    const safeRadius = Math.max(0, radius);
    if (safeRadius <= 0) return prepared;
    const output = makeCanvas(prepared.width || 1, prepared.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.filter = `blur(${safeRadius}px)`;
    octx.drawImage(prepared, 0, 0, output.width, output.height);
    octx.filter = "none";
    return normalizePreparedMaskCanvas(output);
}

export function emptyMaskCanvas(width: number, height: number): HTMLCanvasElement {
    return markPreparedMaskCanvas(makeCanvas(width, height));
}

export function blurMaskCanvas(source: HTMLCanvasElement, radius: number): HTMLCanvasElement {
    const normalizedRadius = Math.max(0, radius);
    if (normalizedRadius <= 0.001) return source;
    const output = makeCanvas(source.width || 1, source.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, output.width, output.height);
    octx.filter = `blur(${normalizedRadius}px)`;
    octx.drawImage(source, 0, 0, output.width, output.height);
    octx.filter = "none";
    return output;
}

export function renderSpherizeMaskCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number = 0): HTMLCanvasElement {
    let width = source.width || 1;
    let height = source.height || 1;
    if (strAny(node, ["size_mode"], "from_input", frameIndex).toLowerCase().trim() === "custom") {
    width = Math.max(64, Math.round(numAny(node, ["width"], width, frameIndex)));
    height = Math.max(64, Math.round(numAny(node, ["height"], height, frameIndex)));
    }

    const output = makeCanvas(width, height);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    const image = octx.createImageData(width, height);
    const data = image.data;
    const fittedMask = rawMask ? buildMaskAlphaCanvas(rawMask, width, height) : null;
    const maskData = fittedMask?.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data ?? null;
    for (let y = 0; y < height; y++) {
    const gy = height > 1 ? (y / (height - 1)) * 2 - 1 : 0;
    for (let x = 0; x < width; x++) {
      const gx = width > 1 ? (x / (width - 1)) * 2 - 1 : 0;
      const offset = (y * width + x) * 4;
      const circleMask = gx * gx + gy * gy <= 1 ? 255 : 0;
      const matte = maskData ? Math.round((circleMask / 255) * (maskData[offset + 3] / 255) * 255) : circleMask;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = matte;
    }
    }

    octx.putImageData(image, 0, 0);
    return markPreparedMaskCanvas(output);
}

export type MaskCanvas = HTMLCanvasElement & { __imageopsPreparedMask?: boolean };

export const preparedMaskCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
