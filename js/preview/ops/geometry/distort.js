import { getOpsConstants } from "../../constants.js";
import { boolAny, numAny, strAny } from "../../graph.js";
import { canvasFieldCache, makeCanvas } from "../../renderer.js";
import { clamp01, luma01 } from "../color.js";
import { alphaMaskCanvas, buildMaskAlphaCanvas, compositeProcessedWithMask, invertMaskCanvas, isPreparedMaskCanvas, resolvePreviewMaskCanvas } from "../masks.js";
import { fitCanvas } from "./canvas-basics.js";
import { bilinearSample, sampleChannel } from "./sampling.js";
function distortConnectedInputs(node, inputs) {
  const source = inputs[0];
  const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
  const maskConnected = (node.inputs?.[2]?.link ?? null) != null;
  let cursor = 1;
  const displacement = displacementConnected ? inputs[cursor++] ?? null : null;
  const mask = maskConnected ? inputs[cursor] ?? null : null;
  return { source, displacement, mask };
}
function renderDistortCanvas(node, inputs, frameIndex = 0) {
  const { source, displacement, mask: rawMask } = distortConnectedInputs(node, inputs);
  const width = source.width || 1;
  const height = source.height || 1;
  const mapSource = strAny(node, ["map_source"], "source_channel", frameIndex).toLowerCase();
  const centeredMap = boolAny(node, ["centered_map"], true, frameIndex);
  const invertMap = boolAny(node, ["invert_map"], false, frameIndex);
  const effectMask = mapSource === "mask" ? null : resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  let previewMask = null;
  let xField;
  let yField;
  if (mapSource === "mask") {
    if (rawMask) {
      const maskCanvas = buildMaskAlphaCanvas(rawMask, width, height);
      previewMask = invertMap ? invertMaskCanvas(maskCanvas) : maskCanvas;
      xField = extractCanvasField(previewMask, width, height, "red");
      yField = xField;
    } else {
      xField = neutralField(width, height, centeredMap);
      yField = xField;
    }
  } else {
    const driver = mapSource === "displacement_channel" && displacement ? displacement : source;
    const xChannel = strAny(node, ["x_channel"], "Red", frameIndex);
    const yChannel = strAny(node, ["y_channel"], "Green", frameIndex);
    xField = extractCanvasField(driver, width, height, xChannel);
    yField = String(xChannel).toLowerCase() === String(yChannel).toLowerCase() ? xField : extractCanvasField(driver, width, height, yChannel);
  }
  const blurRadius = Math.max(0, Math.round(numAny(node, ["blur_map"], 0, frameIndex)));
  if (blurRadius > 0) {
    xField = blurField(xField, width, height, blurRadius);
    yField = xField === yField ? xField : blurField(yField, width, height, blurRadius);
  }
  const sourceCanvas = source;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const output = makeCanvas(width, height);
  const outCtx = output.getContext("2d", { willReadFrequently: true });
  const outImage = outCtx.createImageData(width, height);
  const outData = outImage.data;
  const strengthX = numAny(node, ["strength_x"], 40, frameIndex);
  const strengthY = numAny(node, ["strength_y"], 40, frameIndex);
  const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
  const edgeMode = strAny(node, ["edge_mode"], "border", frameIndex).toLowerCase();
  const useNearest = filter === "nearest";
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let fx = xField[index];
      let fy = yField[index];
      if (invertMap && mapSource !== "mask") {
        fx = 1 - fx;
        fy = 1 - fy;
      }
      if (centeredMap) {
        fx = fx * 2 - 1;
        fy = fy * 2 - 1;
      }
      const sampleX = x - fx * strengthX;
      const sampleY = y - fy * strengthY;
      const rgba = useNearest ? sampleChannel(sourceData.data, width, height, Math.round(sampleX), Math.round(sampleY), edgeMode) : bilinearSample(sourceData.data, width, height, sampleX, sampleY, edgeMode);
      const offset = index * 4;
      outData[offset] = Math.round(clamp01(rgba[0] / 255) * 255);
      outData[offset + 1] = Math.round(clamp01(rgba[1] / 255) * 255);
      outData[offset + 2] = Math.round(clamp01(rgba[2] / 255) * 255);
      outData[offset + 3] = Math.round(clamp01(rgba[3] / 255) * 255);
    }
  }
  outCtx.putImageData(outImage, 0, 0);
  const finalImage = effectMask ? compositeProcessedWithMask(sourceCanvas, output, effectMask) : output;
  if (effectMask) return { image: finalImage, mask: effectMask };
  if (previewMask) return { image: finalImage, mask: previewMask };
  return { image: finalImage, mask: alphaMaskCanvas(finalImage) };
}
function extractCanvasField(canvas, width, height, channel) {
  const normalized = String(channel || "red").toLowerCase();
  const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}:${normalized}`;
  const cachedField = canvasFieldCache.get(canvas)?.get(cacheKey);
  if (cachedField) return cachedField;
  const fitted = (canvas.width || 1) === width && (canvas.height || 1) === height ? canvas : fitCanvas(canvas, width, height);
  const data = fitted.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const field = new Float32Array(width * height);
  const weights = getOpsConstants().luma_weights;
  const preparedMask = isPreparedMaskCanvas(fitted);
  for (let index = 0; index < field.length; index++) {
    const offset = index * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const a = data[offset + 3] / 255;
    if (preparedMask) {
      field[index] = a;
      continue;
    }
    if (normalized === "green") field[index] = g;
    else if (normalized === "blue") field[index] = b;
    else if (normalized === "alpha") field[index] = a;
    else if (normalized === "luma") field[index] = clamp01(luma01(r, g, b, weights));
    else field[index] = r;
  }
  const cache = canvasFieldCache.get(canvas) ?? /* @__PURE__ */ new Map();
  cache.set(cacheKey, field);
  canvasFieldCache.set(canvas, cache);
  return field;
}
function neutralField(width, height, centered) {
  const field = new Float32Array(width * height);
  field.fill(centered ? 0.5 : 0);
  return field;
}
function blurField(field, width, height, radiusPx) {
  const r = Math.max(0, Math.round(radiusPx));
  if (r <= 0 || width < 2 || height < 2) return field;
  const passes = 3;
  let src = new Float32Array(field);
  let dst = new Float32Array(field.length);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const xi = i < 0 ? -i : i;
        sum += src[row + Math.min(width - 1, xi)];
      }
      dst[row] = sum / win;
      for (let x = 1; x < width; x++) {
        const addX = x + r;
        const remX = x - r - 1;
        const addCoord = addX >= width ? 2 * (width - 1) - addX : addX;
        const remCoord = remX < 0 ? -remX : remX;
        sum += src[row + Math.max(0, Math.min(width - 1, addCoord))];
        sum -= src[row + Math.max(0, Math.min(width - 1, remCoord))];
        dst[row + x] = sum / win;
      }
    }
    [src, dst] = [dst, src];
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const yi = i < 0 ? -i : i;
        sum += src[Math.min(height - 1, yi) * width + x];
      }
      dst[x] = sum / win;
      for (let y = 1; y < height; y++) {
        const addY = y + r;
        const remY = y - r - 1;
        const addCoord = addY >= height ? 2 * (height - 1) - addY : addY;
        const remCoord = remY < 0 ? -remY : remY;
        sum += src[Math.max(0, Math.min(height - 1, addCoord)) * width + x];
        sum -= src[Math.max(0, Math.min(height - 1, remCoord)) * width + x];
        dst[y * width + x] = sum / win;
      }
    }
    [src, dst] = [dst, src];
  }
  return src;
}
function distort(ctx, W, node, inputs, frameIndex = 0) {
  return renderDistortCanvas(node, inputs, frameIndex).image;
}
export {
  blurField,
  distort,
  distortConnectedInputs,
  extractCanvasField,
  neutralField,
  renderDistortCanvas
};
