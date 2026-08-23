import { getOpsConstants } from "../constants.js";
import { boolAny, numAny, strAny } from "../graph.js";
import { applyEffectToCanvas, canvasFieldCache, makeCanvas } from "../renderer.js";
import { comp, merge } from "./blend.js";
import { clamp01, luma01, renderKeyerCanvases } from "./color.js";
import { crop, fitCanvas, renderCornerPinCanvases, renderCropStitchCanvases, renderDistortCanvas, renderPadOutCanvases, transform } from "./geometry.js";
import { renderConstantCanvas, renderNoiseCanvas, renderRampCanvas } from "./procedural.js";
import { applyChannel } from "./video.js";
function channelApply(ctx, W, node, inputs) {
  const base = fitCanvas(inputs[0] ?? ctx.canvas, (inputs[0] ?? ctx.canvas).width || 1, (inputs[0] ?? ctx.canvas).height || 1);
  const mask = inputs[1] ? fitCanvas(inputs[1], base.width, base.height) : null;
  if (!mask) return base;
  const bctx = base.getContext("2d", { willReadFrequently: true });
  const image = bctx.getImageData(0, 0, base.width, base.height);
  const data = image.data;
  const matte = mask.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, base.width, base.height).data;
  const channel = strAny(node, ["channel"], "A").toLowerCase();
  const channelIndex = channel === "g" || channel === "green" ? 1 : channel === "b" || channel === "blue" ? 2 : channel === "a" || channel === "alpha" ? 3 : 0;
  for (let i = 0; i < data.length; i += 4) {
    const value = Math.round(clamp01(matte[i] / 255 * (matte[i + 3] / 255)) * 255);
    data[i + channelIndex] = value;
  }
  bctx.putImageData(image, 0, 0);
  return base;
}
function imageOpsMask(ctx, W, node, cls, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const rawMask = inputs[1] ?? null;
  const resolvedMask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  if (cls === "ImageOpsMaskConvert") {
    return boolAny(node, ["reverse"], false, frameIndex) ? imageToMaskPreviewCanvas(source, node, frameIndex) : buildMaskAlphaCanvas(source, source.width || 1, source.height || 1);
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
    const lo = numAny(node, ["min_v", "min"], 0, frameIndex);
    const hi = numAny(node, ["max_v", "max"], 1, frameIndex);
    const mn = Math.round(clamp01(Math.min(lo, hi)) * 255);
    const mx = Math.round(clamp01(Math.max(lo, hi)) * 255);
    const clampMaskOut = makeCanvas(resolvedMask.width || 1, resolvedMask.height || 1);
    const clampMaskCtx = clampMaskOut.getContext("2d", { willReadFrequently: true });
    clampMaskCtx.drawImage(resolvedMask, 0, 0);
    const clampImg = clampMaskCtx.getImageData(0, 0, clampMaskOut.width, clampMaskOut.height);
    const clampData = clampImg.data;
    for (let ci = 0; ci < clampData.length; ci += 4) {
      clampData[ci] = 255;
      clampData[ci + 1] = 255;
      clampData[ci + 2] = 255;
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
    const mergeMaskInput = inputs[2] ?? null;
    if (mergeMaskInput) {
      const mergeResolvedMask = resolvePreviewMaskCanvas(node, source, mergeMaskInput, frameIndex);
      if (mergeResolvedMask) return mergeResolvedMask;
    }
    const merged = merge(ctx, W, node, inputs, void 0, frameIndex);
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
const maskOps = { imageOpsMask, channelApply };
function prepareMaskCanvasInPlace(canvas) {
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
function markPreparedMaskCanvas(canvas) {
  prepareMaskCanvasInPlace(canvas);
  canvas.__imageopsPreparedMask = true;
  return canvas;
}
function isPreparedMaskCanvas(canvas) {
  return !!canvas && canvas.__imageopsPreparedMask === true;
}
function computeMaskBounds(maskCanvas) {
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
      if (alpha * luma <= 1e-3) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
function buildMaskAlphaCanvas(maskCanvas, width, height) {
  if (isPreparedMaskCanvas(maskCanvas) && (maskCanvas.width || 1) === width && (maskCanvas.height || 1) === height) {
    return maskCanvas;
  }
  const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}`;
  const cachedPrepared = preparedMaskCache.get(maskCanvas)?.get(cacheKey);
  if (cachedPrepared) return cachedPrepared;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
  const cache = preparedMaskCache.get(maskCanvas) ?? /* @__PURE__ */ new Map();
  cache.set(cacheKey, prepared);
  preparedMaskCache.set(maskCanvas, cache);
  return prepared;
}
function maskCanvasToPreviewCanvas(maskCanvas, includeAlpha = false) {
  const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
function alphaMaskCanvas(source) {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
function canvasHasVisibleTransparency(source) {
  const ctx = source.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, source.width || 1, source.height || 1).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 255) return true;
  }
  return false;
}
function maskConvertSourceValue(data, index, sourceMode, useAlpha, lumaWeights) {
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
function applyMaskConvertLevels(value, blackPoint, whitePoint) {
  const black = clamp01(blackPoint);
  const white = Math.max(black + 1e-6, clamp01(whitePoint));
  return clamp01((value - black) / (white - black));
}
function imageToMaskPreviewCanvas(source, node, frameIndex = 0) {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
  const useAlpha = maxAlpha - minAlpha > 0 || minAlpha < 255;
  const lw = getOpsConstants().luma_weights;
  const sourceMode = strAny(node ?? {}, ["mask_source", "source", "channel"], "auto", frameIndex);
  for (let index = 0; index < data.length; index += 4) {
    const matte = Math.round(clamp01(maskConvertSourceValue(data, index, sourceMode, useAlpha, lw)) * 255);
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  const antialiasRadius = Math.max(0, numAny(node ?? {}, ["antialias_radius", "mask_antialias", "antialias"], 0, frameIndex));
  const levelsSource = antialiasRadius > 0 ? makeCanvas(output.width, output.height) : output;
  if (antialiasRadius > 0) {
    const blurCtx = levelsSource.getContext("2d", { willReadFrequently: true });
    blurCtx.filter = `blur(${antialiasRadius}px)`;
    blurCtx.drawImage(output, 0, 0);
    blurCtx.filter = "none";
  }
  const blackPoint = numAny(node ?? {}, ["black_point", "black"], 0, frameIndex);
  const whitePoint = numAny(node ?? {}, ["white_point", "white"], 1, frameIndex);
  const levelsCtx = levelsSource.getContext("2d", { willReadFrequently: true });
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
function resolvePreviewMaskCanvas(node, source, rawMask, frameIndex = 0) {
  if (!rawMask) return null;
  const matte = buildMaskAlphaCanvas(rawMask, source.width || 1, source.height || 1);
  return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(matte) : matte;
}
function compositeProcessedWithMask(baseCanvas, processedCanvas, maskCanvas) {
  if (!maskCanvas) return processedCanvas;
  const output = makeCanvas(processedCanvas.width || 1, processedCanvas.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(baseCanvas, 0, 0, output.width, output.height);
  octx.drawImage(
    premultLayerWithMask(processedCanvas, maskCanvas),
    0,
    0,
    output.width,
    output.height
  );
  return output;
}
function renderMaskedEffectPreview(node, source, rawMask, processImage, options = {}) {
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, options.frameIndex ?? 0);
  if (!mask) return processImage(source);
  const processed = processImage(options.premultBeforeProcess ? premultLayerWithMask(source, mask) : source);
  if (options.compositeWithBase === false) return processed;
  const processedMask = options.processMask ? options.processMask(mask) : fitCanvas(mask, processed.width || 1, processed.height || 1);
  return compositeProcessedWithMask(options.baseCanvas ?? source, processed, processedMask);
}
function premultLayerWithMask(imageCanvas, maskCanvas) {
  if (!maskCanvas) return imageCanvas;
  const output = makeCanvas(imageCanvas.width || 1, imageCanvas.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
  octx.clearRect(0, 0, output.width, output.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(imageCanvas, 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "destination-in";
  const preparedMask = isPreparedMaskCanvas(maskCanvas) && (maskCanvas.width || 1) === output.width && (maskCanvas.height || 1) === output.height ? maskCanvas : buildMaskAlphaCanvas(maskCanvas, output.width, output.height);
  octx.drawImage(preparedMask, 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "source-over";
  return output;
}
function invertMaskCanvas(maskCanvas) {
  const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
function invertMaskAlphaCanvas(maskCanvas) {
  return invertMaskCanvas(maskCanvas);
}
function normalizePreparedMaskCanvas(maskCanvas) {
  const prepared = isPreparedMaskCanvas(maskCanvas) ? maskCanvas : buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
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
function blurMaskAlphaCanvas(maskCanvas, radius) {
  const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const safeRadius = Math.max(0, radius);
  if (safeRadius <= 0) return prepared;
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
  octx.filter = `blur(${safeRadius}px)`;
  octx.drawImage(prepared, 0, 0, output.width, output.height);
  octx.filter = "none";
  return normalizePreparedMaskCanvas(output);
}
function emptyMaskCanvas(width, height) {
  return markPreparedMaskCanvas(makeCanvas(width, height));
}
function blurMaskCanvas(source, radius) {
  const normalizedRadius = Math.max(0, radius);
  if (normalizedRadius <= 1e-3) return source;
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true });
  octx.clearRect(0, 0, output.width, output.height);
  octx.filter = `blur(${normalizedRadius}px)`;
  octx.drawImage(source, 0, 0, output.width, output.height);
  octx.filter = "none";
  return output;
}
function renderSpherizeMaskCanvas(node, source, rawMask, frameIndex = 0) {
  let width = source.width || 1;
  let height = source.height || 1;
  if (strAny(node, ["size_mode"], "from_input", frameIndex).toLowerCase().trim() === "custom") {
    width = Math.max(64, Math.round(numAny(node, ["width"], width, frameIndex)));
    height = Math.max(64, Math.round(numAny(node, ["height"], height, frameIndex)));
  }
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true });
  const image = octx.createImageData(width, height);
  const data = image.data;
  const fittedMask = rawMask ? buildMaskAlphaCanvas(rawMask, width, height) : null;
  const maskData = fittedMask?.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data ?? null;
  for (let y = 0; y < height; y++) {
    const gy = height > 1 ? y / (height - 1) * 2 - 1 : 0;
    for (let x = 0; x < width; x++) {
      const gx = width > 1 ? x / (width - 1) * 2 - 1 : 0;
      const offset = (y * width + x) * 4;
      const circleMask = gx * gx + gy * gy <= 1 ? 255 : 0;
      const matte = maskData ? Math.round(circleMask / 255 * (maskData[offset + 3] / 255) * 255) : circleMask;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = matte;
    }
  }
  octx.putImageData(image, 0, 0);
  return markPreparedMaskCanvas(output);
}
const preparedMaskCache = /* @__PURE__ */ new WeakMap();
export {
  alphaMaskCanvas,
  applyMaskConvertLevels,
  blurMaskAlphaCanvas,
  blurMaskCanvas,
  buildMaskAlphaCanvas,
  canvasHasVisibleTransparency,
  channelApply,
  compositeProcessedWithMask,
  computeMaskBounds,
  emptyMaskCanvas,
  imageOpsMask,
  imageToMaskPreviewCanvas,
  invertMaskAlphaCanvas,
  invertMaskCanvas,
  isPreparedMaskCanvas,
  markPreparedMaskCanvas,
  maskCanvasToPreviewCanvas,
  maskConvertSourceValue,
  maskOps,
  normalizePreparedMaskCanvas,
  premultLayerWithMask,
  prepareMaskCanvasInPlace,
  preparedMaskCache,
  renderMaskedEffectPreview,
  renderSpherizeMaskCanvas,
  resolvePreviewMaskCanvas
};
