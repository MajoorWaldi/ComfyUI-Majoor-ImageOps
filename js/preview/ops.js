import { getOpsConstants, initOpsConstants } from "./constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "./crop.js";
import { computeCompRect, getCompSlots, syncCompLayers } from "./comp.js";
import { renderDrawPreview, resolveDrawOverlayCanvas } from "./draw.js";
initOpsConstants();
function w(node, name) {
  return node?.widgets?.find((x) => x?.name === name) ?? null;
}
function widgetScalarValue(value, index = 0) {
  let current = value;
  while (Array.isArray(current) && current.length > 0) {
    const resolvedIndex = Math.max(0, Math.min(current.length - 1, index));
    current = current[resolvedIndex];
  }
  return current;
}
function num(node, name, fallback = 0, index = 0) {
  const v = widgetScalarValue(w(node, name)?.value, index);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(node, name, fallback = "", index = 0) {
  const v = widgetScalarValue(w(node, name)?.value, index);
  return typeof v === "string" ? v : fallback;
}
function bool(node, name, fallback = false, index = 0) {
  const v = widgetScalarValue(w(node, name)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function wAny(node, names) {
  for (const name of names) {
    const found = w(node, name);
    if (found) return found;
  }
  return null;
}
function numAny(node, names, fallback = 0, index = 0) {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function strAny(node, names, fallback = "", index = 0) {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  return typeof v === "string" ? v : fallback;
}
function boolAny(node, names, fallback = false, index = 0) {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function luma01(r, g, b, lw) {
  return lw[0] * r + lw[1] * g + lw[2] * b;
}
function getImageData(ctx, W, H) {
  return ctx.getImageData(0, 0, W, H);
}
function putImageData(ctx, img) {
  ctx.putImageData(img, 0, 0);
}
function getCanvasDimensions(ctx) {
  return {
    width: Math.max(1, ctx.canvas.width || 1),
    height: Math.max(1, ctx.canvas.height || 1)
  };
}
function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
const preparedMaskCache = /* @__PURE__ */ new WeakMap();
const canvasFieldCache = /* @__PURE__ */ new WeakMap();
function markPreparedMaskCanvas(canvas) {
  canvas.__imageopsPreparedMask = true;
  return canvas;
}
function isPreparedMaskCanvas(canvas) {
  return !!canvas && canvas.__imageopsPreparedMask === true;
}
function markPadOutStitcherCanvas(canvas, mask) {
  const stitcherCanvas = canvas;
  stitcherCanvas.__imageopsPadOutMask = mask;
  return stitcherCanvas;
}
function getPadOutStitcherMask(canvas) {
  return canvas?.__imageopsPadOutMask ?? null;
}
function normalizeFilterName(filter) {
  const value = String(filter || "bilinear").toLowerCase();
  if (value === "nearest") return "nearest-exact";
  if (value === "linear") return "bilinear";
  if (value === "cubic") return "bicubic";
  return value;
}
function parseHexColor(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const chars = raw.slice(1).split("");
    return `#${chars.map((ch) => `${ch}${ch}`).join("")}`;
  }
  const rgb = raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (rgb) {
    const channels = rgb.slice(1, 4).map((part) => {
      const channel = Math.max(0, Math.min(255, parseInt(part, 10) || 0));
      return channel.toString(16).padStart(2, "0");
    });
    return `#${channels.join("")}`;
  }
  if (raw.toLowerCase() === "white") return "#ffffff";
  if (raw.toLowerCase() === "red") return "#ff0000";
  if (raw.toLowerCase() === "green") return "#00ff00";
  if (raw.toLowerCase() === "blue") return "#0000ff";
  return "#000000";
}
function imageLikeInputName(name) {
  return /image|images|source|destination|background|foreground|layer|red|green|blue|channel|input/i.test(name);
}
function getPreferredInputIndexes(node) {
  const indexes = [];
  for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const slot = node.inputs?.[index];
    const name = String(slot?.name ?? "");
    const type = String(slot?.type ?? "");
    if (/mask|bbox|box|region/i.test(name) || /mask|bbox|box/i.test(type)) continue;
    if (slot?.link == null && !node.getInputLink?.(index)) continue;
    if (imageLikeInputName(name) || /image|video/i.test(type)) indexes.push(index);
  }
  if (indexes.length > 0) return indexes;
  return [0];
}
function resizeWithMode(source, width, height, filter, mode, fillColor = "#000000", cropPosition = "center") {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const output = makeCanvas(targetWidth, targetHeight);
  const octx = output.getContext("2d");
  const normalizedMode = String(mode || "stretch").toLowerCase();
  const srcW = Math.max(1, source.width || 1);
  const srcH = Math.max(1, source.height || 1);
  setResampleMode(octx, filter);
  if (normalizedMode.includes("pad") || normalizedMode.includes("pillarbox")) {
    octx.fillStyle = parseHexColor(fillColor);
    octx.fillRect(0, 0, targetWidth, targetHeight);
  } else {
    octx.clearRect(0, 0, targetWidth, targetHeight);
  }
  if (normalizedMode === "stretch" || normalizedMode === "disabled" || normalizedMode === "scale dimensions") {
    octx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return output;
  }
  const fitScale = Math.min(targetWidth / srcW, targetHeight / srcH);
  const fillScale = Math.max(targetWidth / srcW, targetHeight / srcH);
  const useFill = normalizedMode.includes("fill") || normalizedMode.includes("crop") || normalizedMode === "center";
  const scale = useFill ? fillScale : fitScale;
  const drawWidth = Math.max(1, Math.round(srcW * scale));
  const drawHeight = Math.max(1, Math.round(srcH * scale));
  let dx = Math.round((targetWidth - drawWidth) / 2);
  let dy = Math.round((targetHeight - drawHeight) / 2);
  if (cropPosition === "top") dy = 0;
  if (cropPosition === "bottom") dy = targetHeight - drawHeight;
  if (cropPosition === "left") dx = 0;
  if (cropPosition === "right") dx = targetWidth - drawWidth;
  octx.drawImage(source, dx, dy, drawWidth, drawHeight);
  return output;
}
function fitCanvas(source, width, height) {
  if ((source.width || 1) === Math.max(1, Math.round(width)) && (source.height || 1) === Math.max(1, Math.round(height))) {
    return source;
  }
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d");
  setResampleMode(octx, "bicubic");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  if (isPreparedMaskCanvas(source)) {
    markPreparedMaskCanvas(output);
  }
  return output;
}
function flipCanvas(source, horizontal, vertical) {
  if (!horizontal && !vertical) return source;
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d");
  octx.save();
  octx.translate(horizontal ? output.width : 0, vertical ? output.height : 0);
  octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  octx.drawImage(source, 0, 0, output.width, output.height);
  octx.restore();
  return output;
}
function rotateDiscrete(source, quarterTurns) {
  const turns = (quarterTurns % 4 + 4) % 4;
  if (turns === 0) return source;
  const swap = turns % 2 === 1;
  const output = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const octx = output.getContext("2d");
  octx.translate(output.width / 2, output.height / 2);
  octx.rotate(turns * Math.PI / 2);
  octx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}
function computeMaskBounds(maskCanvas) {
  const ctx = maskCanvas.getContext("2d");
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
function compositeAt(base, top, mode, opacity, x, y, width, height) {
  const output = makeCanvas(base.width || 1, base.height || 1);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(base, 0, 0, output.width, output.height);
  octx.save();
  octx.globalAlpha = clamp01(opacity);
  octx.globalCompositeOperation = compModeToCanvasOp(mode);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(top, x, y, width, height);
  octx.restore();
  return output;
}
function compModeToCanvasOp(mode) {
  const normalized = String(mode || "over").toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "add") return "lighter";
  if (normalized === "multiply") return "multiply";
  if (normalized === "screen") return "screen";
  if (normalized === "overlay") return "overlay";
  if (normalized === "soft_light") return "soft-light";
  if (normalized === "difference") return "difference";
  if (normalized === "lighten") return "lighten";
  if (normalized === "darken") return "darken";
  if (normalized === "color_dodge") return "color-dodge";
  if (normalized === "color_burn") return "color-burn";
  if (normalized === "exclusion") return "exclusion";
  return "source-over";
}
function hexToRgb01(value) {
  const hex = parseHexColor(value);
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}
function noiseFade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function noiseLerp(a, b, t) {
  return a + (b - a) * t;
}
function noiseHash3D(x, y, z, seed) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2246822519) + Math.imul(seed | 0, 1442695041) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function wrapNoiseIndex(value, period) {
  if (period <= 0) return value;
  return (value % period + period) % period;
}
function sampleWhiteNoise(x, y, z, seed, periodX = 0, periodY = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const z1 = z0 + 1;
  const tz = z - z0;
  const ix = wrapNoiseIndex(x0, periodX);
  const iy = wrapNoiseIndex(y0, periodY);
  const n0 = noiseHash3D(ix, iy, z0, seed) * 2 - 1;
  const n1 = noiseHash3D(ix, iy, z1, seed) * 2 - 1;
  return noiseLerp(n0, n1, noiseFade(tz));
}
function sampleValueNoise(x, y, z, seed, periodX = 0, periodY = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const u = noiseFade(tx);
  const v = noiseFade(ty);
  const w2 = noiseFade(tz);
  const ix0 = wrapNoiseIndex(x0, periodX);
  const ix1 = wrapNoiseIndex(x1, periodX);
  const iy0 = wrapNoiseIndex(y0, periodY);
  const iy1 = wrapNoiseIndex(y1, periodY);
  const v000 = noiseHash3D(ix0, iy0, z0, seed) * 2 - 1;
  const v100 = noiseHash3D(ix1, iy0, z0, seed) * 2 - 1;
  const v010 = noiseHash3D(ix0, iy1, z0, seed) * 2 - 1;
  const v110 = noiseHash3D(ix1, iy1, z0, seed) * 2 - 1;
  const v001 = noiseHash3D(ix0, iy0, z1, seed) * 2 - 1;
  const v101 = noiseHash3D(ix1, iy0, z1, seed) * 2 - 1;
  const v011 = noiseHash3D(ix0, iy1, z1, seed) * 2 - 1;
  const v111 = noiseHash3D(ix1, iy1, z1, seed) * 2 - 1;
  const x00 = noiseLerp(v000, v100, u);
  const x10 = noiseLerp(v010, v110, u);
  const x01 = noiseLerp(v001, v101, u);
  const x11 = noiseLerp(v011, v111, u);
  return noiseLerp(noiseLerp(x00, x10, v), noiseLerp(x01, x11, v), w2);
}
function gradientDot3(ix, iy, iz, x, y, z, seed, periodX = 0, periodY = 0) {
  const hashX = wrapNoiseIndex(ix, periodX);
  const hashY = wrapNoiseIndex(iy, periodY);
  const h0 = noiseHash3D(hashX, hashY, iz, seed);
  const h1 = noiseHash3D(hashX + 19, hashY - 31, iz + 47, seed + 1009);
  const angle = h0 * Math.PI * 2;
  const gz = h1 * 2 - 1;
  const radial = Math.sqrt(Math.max(0, 1 - gz * gz));
  const gx = radial * Math.cos(angle);
  const gy = radial * Math.sin(angle);
  return gx * (x - ix) + gy * (y - iy) + gz * (z - iz);
}
function samplePerlinNoise(x, y, z, seed, periodX = 0, periodY = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;
  const u = noiseFade(tx);
  const v = noiseFade(ty);
  const w2 = noiseFade(tz);
  const n000 = gradientDot3(x0, y0, z0, x, y, z, seed, periodX, periodY);
  const n100 = gradientDot3(x1, y0, z0, x, y, z, seed, periodX, periodY);
  const n010 = gradientDot3(x0, y1, z0, x, y, z, seed, periodX, periodY);
  const n110 = gradientDot3(x1, y1, z0, x, y, z, seed, periodX, periodY);
  const n001 = gradientDot3(x0, y0, z1, x, y, z, seed, periodX, periodY);
  const n101 = gradientDot3(x1, y0, z1, x, y, z, seed, periodX, periodY);
  const n011 = gradientDot3(x0, y1, z1, x, y, z, seed, periodX, periodY);
  const n111 = gradientDot3(x1, y1, z1, x, y, z, seed, periodX, periodY);
  const x00 = noiseLerp(n000, n100, u);
  const x10 = noiseLerp(n010, n110, u);
  const x01 = noiseLerp(n001, n101, u);
  const x11 = noiseLerp(n011, n111, u);
  return Math.max(-1, Math.min(1, noiseLerp(noiseLerp(x00, x10, v), noiseLerp(x01, x11, v), w2) * 1.15470053838));
}
function sampleNoiseBasis(basis, sampleX, sampleY, sampleZ, rawX, rawY, rawZ, seed, periodX = 0, periodY = 0) {
  const normalized = String(basis || "perlin").toLowerCase();
  if (normalized === "value") return sampleValueNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
  if (normalized === "white") return sampleWhiteNoise(rawX, rawY, rawZ, seed, periodX > 0 ? Math.max(1, Math.round(periodX)) : 0, periodY > 0 ? Math.max(1, Math.round(periodY)) : 0);
  return samplePerlinNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
}
function buildNoiseField(width, height, options) {
  const basis = options.basis;
  const fractalMode = options.fractalMode.toLowerCase();
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const seed = Math.round(options.seed + frameIndex * (options.seedStep ?? 0));
  const scale = Math.max(1, options.scale);
  const octaves = Math.max(1, Math.round(options.octaves));
  const lacunarity = Math.max(1.01, options.lacunarity);
  const gain = Math.max(0, options.gain);
  const offsetX = options.offsetX + frameIndex * (options.frameOffsetX ?? 0);
  const offsetY = options.offsetY + frameIndex * (options.frameOffsetY ?? 0);
  const offsetZ = (options.offsetZ ?? 0) + frameIndex * (options.frameOffsetZ ?? 0);
  const seamless = !!options.seamless;
  const contrast = Math.max(0, options.contrast);
  const invert = options.invert;
  const grayValues = new Float32Array(width * height);
  let minGray = Number.POSITIVE_INFINITY;
  let maxGray = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rawX = x + offsetX;
      const rawY = y + offsetY;
      let gray = 0;
      if (fractalMode === "none") {
        const useWhitePeriod = String(basis || "perlin").toLowerCase() === "white";
        const periodX = seamless ? useWhitePeriod ? width : Math.max(1, Math.round(width / scale)) : 0;
        const periodY = seamless ? useWhitePeriod ? height : Math.max(1, Math.round(height / scale)) : 0;
        const sampleX = seamless ? x * (periodX / Math.max(1, width)) + offsetX / scale : rawX / scale;
        const sampleY = seamless ? y * (periodY / Math.max(1, height)) + offsetY / scale : rawY / scale;
        const signed = sampleNoiseBasis(basis, sampleX, sampleY, offsetZ / scale, rawX, rawY, offsetZ, seed, periodX, periodY);
        gray = clamp01(signed * 0.5 + 0.5);
      } else {
        let total = 0;
        let amplitude = 1;
        let amplitudeSum = 0;
        let currentScale = scale;
        for (let octave = 0; octave < octaves; octave++) {
          const octaveSeed = seed + octave * 10007;
          const useWhitePeriod = String(basis || "perlin").toLowerCase() === "white";
          const periodX = seamless ? useWhitePeriod ? width : Math.max(1, Math.round(width / currentScale)) : 0;
          const periodY = seamless ? useWhitePeriod ? height : Math.max(1, Math.round(height / currentScale)) : 0;
          const sampleX = seamless ? x * (periodX / Math.max(1, width)) + offsetX / currentScale : rawX / currentScale;
          const sampleY = seamless ? y * (periodY / Math.max(1, height)) + offsetY / currentScale : rawY / currentScale;
          const signed = sampleNoiseBasis(basis, sampleX, sampleY, offsetZ / currentScale, rawX, rawY, offsetZ, octaveSeed, periodX, periodY);
          let contribution = signed;
          if (fractalMode === "turbulence") contribution = Math.abs(signed);
          else if (fractalMode === "ridged") contribution = 1 - Math.abs(signed);
          total += contribution * amplitude;
          amplitudeSum += amplitude;
          amplitude *= gain;
          currentScale = Math.max(1, currentScale / lacunarity);
        }
        const normalized = amplitudeSum > 0 ? total / amplitudeSum : 0;
        gray = fractalMode === "fbm" ? clamp01(normalized * 0.5 + 0.5) : clamp01(normalized);
      }
      const index = y * width + x;
      grayValues[index] = gray;
      if (gray < minGray) minGray = gray;
      if (gray > maxGray) maxGray = gray;
    }
  }
  const grayRange = maxGray - minGray;
  for (let index = 0; index < grayValues.length; index++) {
    let gray = grayRange > 1e-6 ? (grayValues[index] - minGray) / grayRange : 0;
    gray = clamp01((gray - 0.5) * contrast + 0.5);
    if (invert) gray = 1 - gray;
    grayValues[index] = gray;
  }
  return grayValues;
}
function renderNoiseFieldCanvas(width, height, grayValues, low, high, maskOnly = false) {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d");
  const image = context.createImageData(width, height);
  const data = image.data;
  for (let index = 0; index < grayValues.length; index++) {
    const gray = grayValues[index];
    const offset = index * 4;
    if (maskOnly) {
      const channel = Math.round(gray * 255);
      data[offset] = channel;
      data[offset + 1] = channel;
      data[offset + 2] = channel;
    } else {
      data[offset] = Math.round(clamp01(low[0] + gray * (high[0] - low[0])) * 255);
      data[offset + 1] = Math.round(clamp01(low[1] + gray * (high[1] - low[1])) * 255);
      data[offset + 2] = Math.round(clamp01(low[2] + gray * (high[2] - low[2])) * 255);
    }
    data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}
function renderNoiseCanvas(node, maskOnly = false, frameIndex = 0) {
  const width = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const height = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  const batchSize = Math.max(1, Math.round(numAny(node, ["batch_size"], 1)));
  const frameLength = Math.max(0, Math.round(numAny(node, ["frame_length"], 0)));
  const frameCount = frameLength > 0 ? frameLength : batchSize;
  const resolvedFrameIndex = (Math.max(0, Math.round(frameIndex)) % frameCount + frameCount) % frameCount;
  const low = hexToRgb01(strAny(node, ["low_color"], "#000000", resolvedFrameIndex));
  const high = hexToRgb01(strAny(node, ["high_color"], "#ffffff", resolvedFrameIndex));
  const grayValues = buildNoiseField(width, height, {
    basis: strAny(node, ["basis"], "perlin", resolvedFrameIndex),
    fractalMode: strAny(node, ["fractal_mode"], "fbm", resolvedFrameIndex),
    seed: numAny(node, ["seed"], 0, resolvedFrameIndex),
    seedStep: numAny(node, ["seed_step"], 1, resolvedFrameIndex),
    scale: numAny(node, ["scale"], 160, resolvedFrameIndex),
    octaves: numAny(node, ["octaves"], 5, resolvedFrameIndex),
    lacunarity: numAny(node, ["lacunarity"], 2, resolvedFrameIndex),
    gain: numAny(node, ["gain"], 0.5, resolvedFrameIndex),
    offsetX: numAny(node, ["offset_x"], 0, resolvedFrameIndex),
    offsetY: numAny(node, ["offset_y"], 0, resolvedFrameIndex),
    offsetZ: numAny(node, ["offset_z"], 0, resolvedFrameIndex),
    frameOffsetX: numAny(node, ["frame_offset_x"], 0, resolvedFrameIndex),
    frameOffsetY: numAny(node, ["frame_offset_y"], 0, resolvedFrameIndex),
    frameOffsetZ: numAny(node, ["frame_offset_z"], 0, resolvedFrameIndex),
    seamless: boolAny(node, ["seamless"], false, resolvedFrameIndex),
    contrast: numAny(node, ["contrast"], 1, resolvedFrameIndex),
    invert: boolAny(node, ["invert"], false, resolvedFrameIndex),
    frameIndex: resolvedFrameIndex
  });
  return renderNoiseFieldCanvas(width, height, grayValues, low, high, maskOnly);
}
function distortConnectedInputs(node, inputs) {
  const source = inputs[0];
  const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
  const maskConnected = (node.inputs?.[2]?.link ?? null) != null;
  let cursor = 1;
  const displacement = displacementConnected ? inputs[cursor++] ?? null : null;
  const mask = maskConnected ? inputs[cursor] ?? null : null;
  return { source, displacement, mask };
}
function extractCanvasField(canvas, width, height, channel) {
  const normalized = String(channel || "red").toLowerCase();
  const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}:${normalized}`;
  const cachedField = canvasFieldCache.get(canvas)?.get(cacheKey);
  if (cachedField) return cachedField;
  const fitted = (canvas.width || 1) === width && (canvas.height || 1) === height ? canvas : fitCanvas(canvas, width, height);
  const data = fitted.getContext("2d").getImageData(0, 0, width, height).data;
  const field = new Float32Array(width * height);
  const weights = getOpsConstants().luma_weights;
  for (let index = 0; index < field.length; index++) {
    const offset = index * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const a = data[offset + 3] / 255;
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
function reflectCoordinate(value, size) {
  if (size <= 1) return 0;
  let coord = value;
  const max = size - 1;
  while (coord < 0 || coord > max) {
    if (coord < 0) coord = -coord;
    if (coord > max) coord = max - (coord - max);
  }
  return coord;
}
function sampleChannel(data, width, height, x, y, edgeMode) {
  let px = x;
  let py = y;
  if (edgeMode === "zeros") {
    if (px < 0 || py < 0 || px >= width || py >= height) return [0, 0, 0, 0];
  } else if (edgeMode === "reflection") {
    px = reflectCoordinate(px, width);
    py = reflectCoordinate(py, height);
  } else {
    px = Math.max(0, Math.min(width - 1, px));
    py = Math.max(0, Math.min(height - 1, py));
  }
  const offset = (py * width + px) * 4;
  return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}
function bilinearSample(data, width, height, x, y, edgeMode) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const c00 = sampleChannel(data, width, height, x0, y0, edgeMode);
  const c10 = sampleChannel(data, width, height, x1, y0, edgeMode);
  const c01 = sampleChannel(data, width, height, x0, y1, edgeMode);
  const c11 = sampleChannel(data, width, height, x1, y1, edgeMode);
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = noiseLerp(c00[c], c10[c], tx);
    const bottom = noiseLerp(c01[c], c11[c], tx);
    out[c] = noiseLerp(top, bottom, ty);
  }
  return out;
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
  const sourceCanvas = source;
  const sourceCtx = sourceCanvas.getContext("2d");
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const output = makeCanvas(width, height);
  const outCtx = output.getContext("2d");
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
function setResampleMode(ctx, filter) {
  const mode = String(filter || "bilinear").toLowerCase();
  ctx.imageSmoothingEnabled = mode !== "nearest";
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
  }
}
function applyLevels(ctx, W, H, inMin, inMax, gamma, outMin, outMax) {
  const { epsilon: EPS, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const ig = 1 / Math.max(GE, gamma);
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] / 255;
      v = (v - inMin) / Math.max(EPS, inMax - inMin);
      v = clamp01(v);
      v = Math.pow(v, ig);
      v = outMin + v * (outMax - outMin);
      d[i + c] = Math.round(clamp01(v) * 255);
    }
  }
  putImageData(ctx, img);
}
function applyHueSat(ctx, W, H, hueDeg, sat, val) {
  const { epsilon: EPS } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const hue = hueDeg % 360 * Math.PI / 180;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    let h0 = 0;
    if (delta > EPS) {
      if (max === r) h0 = (g - b) / delta % 6;
      else if (max === g) h0 = (b - r) / delta + 2;
      else h0 = (r - g) / delta + 4;
      h0 *= Math.PI / 3;
    }
    let s0 = max === 0 ? 0 : delta / max;
    let v0 = max;
    h0 += hue;
    s0 = clamp01(s0 * sat);
    v0 = clamp01(v0 * val);
    const c = v0 * s0;
    const x = c * (1 - Math.abs(h0 / (Math.PI / 3) % 2 - 1));
    const m = v0 - c;
    let rp = 0, gp = 0, bp = 0;
    const hh = (h0 % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const sector = Math.floor(hh / (Math.PI / 3));
    switch (sector) {
      case 0:
        rp = c;
        gp = x;
        bp = 0;
        break;
      case 1:
        rp = x;
        gp = c;
        bp = 0;
        break;
      case 2:
        rp = 0;
        gp = c;
        bp = x;
        break;
      case 3:
        rp = 0;
        gp = x;
        bp = c;
        break;
      case 4:
        rp = x;
        gp = 0;
        bp = c;
        break;
      case 5:
        rp = c;
        gp = 0;
        bp = x;
        break;
    }
    d[i] = Math.round(clamp01(rp + m) * 255);
    d[i + 1] = Math.round(clamp01(gp + m) * 255);
    d[i + 2] = Math.round(clamp01(bp + m) * 255);
  }
  putImageData(ctx, img);
}
function applyInvert(ctx, W, H, invertAlpha = false) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
    if (invertAlpha) d[i + 3] = 255 - d[i + 3];
  }
  putImageData(ctx, img);
}
function applyClamp(ctx, W, H, minV, maxV) {
  const lo = Math.min(minV, maxV);
  const hi = Math.max(minV, maxV);
  const mn = Math.round(clamp01(lo) * 255);
  const mx = Math.round(clamp01(hi) * 255);
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(mn, Math.min(mx, d[i]));
    d[i + 1] = Math.max(mn, Math.min(mx, d[i + 1]));
    d[i + 2] = Math.max(mn, Math.min(mx, d[i + 2]));
    d[i + 3] = Math.max(mn, Math.min(mx, d[i + 3]));
  }
  putImageData(ctx, img);
}
function applyColorCorrect(ctx, W, H, brightness, contrast, gamma, saturation) {
  const { luma_weights: LW, gamma_safe_min: GMIN, gamma_max: GMAX, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const g = Math.max(GMIN, Math.min(GMAX, gamma));
  const invGamma = 1 / Math.max(GE, g);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, gr = d[i + 1] / 255, b = d[i + 2] / 255;
    r += brightness;
    gr += brightness;
    b += brightness;
    r = (r - 0.5) * contrast + 0.5;
    gr = (gr - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    r = clamp01(r);
    gr = clamp01(gr);
    b = clamp01(b);
    r = Math.pow(r, invGamma);
    gr = Math.pow(gr, invGamma);
    b = Math.pow(b, invGamma);
    const l = luma01(r, gr, b, LW);
    r = l + (r - l) * saturation;
    gr = l + (gr - l) * saturation;
    b = l + (b - l) * saturation;
    d[i] = Math.round(clamp01(r) * 255);
    d[i + 1] = Math.round(clamp01(gr) * 255);
    d[i + 2] = Math.round(clamp01(b) * 255);
  }
  putImageData(ctx, img);
}
function applyColorCorrectReference(ctx, W, H, temperature, hue, brightness, contrast, saturation, gamma) {
  const { luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const brightnessFactor = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const temperatureFactor = temperature / 100;
  const safeGamma = Math.max(0.2, Math.min(2.2, gamma));
  let meanLuma = 0;
  const pixelCount = Math.max(1, W * H);
  for (let i = 0; i < d.length; i += 4) {
    const r = clamp01(d[i] / 255 * brightnessFactor);
    const g = clamp01(d[i + 1] / 255 * brightnessFactor);
    const b = clamp01(d[i + 2] / 255 * brightnessFactor);
    meanLuma += luma01(r, g, b, LW);
  }
  meanLuma /= pixelCount;
  for (let i = 0; i < d.length; i += 4) {
    let r = clamp01(d[i] / 255 * brightnessFactor);
    let g = clamp01(d[i + 1] / 255 * brightnessFactor);
    let b = clamp01(d[i + 2] / 255 * brightnessFactor);
    r = meanLuma + (r - meanLuma) * contrastFactor;
    g = meanLuma + (g - meanLuma) * contrastFactor;
    b = meanLuma + (b - meanLuma) * contrastFactor;
    if (temperatureFactor > 0) {
      r *= 1 + temperatureFactor;
      g *= 1 + temperatureFactor * 0.4;
    } else if (temperatureFactor < 0) {
      b *= 1 - temperatureFactor;
    }
    d[i] = Math.round(clamp01(Math.pow(clamp01(r), safeGamma)) * 255);
    d[i + 1] = Math.round(clamp01(Math.pow(clamp01(g), safeGamma)) * 255);
    d[i + 2] = Math.round(clamp01(Math.pow(clamp01(b), safeGamma)) * 255);
  }
  putImageData(ctx, img);
  applyHueSat(ctx, W, H, hue, 1 + saturation / 100, 1);
}
function applyUnsharp(ctx, W, H, amount = 1) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.filter = "blur(2px)";
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.filter = "none";
  const o = getImageData(ctx, W, H);
  const b = tctx.getImageData(0, 0, W, H);
  const d = o.data, bd = b.data;
  const a = Math.max(0, amount);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, d[i] + a * (d[i] - bd[i])));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + a * (d[i + 1] - bd[i + 1])));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + a * (d[i + 2] - bd[i + 2])));
  }
  putImageData(ctx, o);
}
function applyEdgeDetect(ctx, W, H, strength = 1) {
  const { luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const gr = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      gr[y * W + x] = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    }
  }
  const out = new Uint8ClampedArray(d.length);
  const k = strength;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = -1 * gr[(y - 1) * W + (x - 1)] + 1 * gr[(y - 1) * W + (x + 1)] + -2 * gr[y * W + (x - 1)] + 2 * gr[y * W + (x + 1)] + -1 * gr[(y + 1) * W + (x - 1)] + 1 * gr[(y + 1) * W + (x + 1)];
      const gy = -1 * gr[(y - 1) * W + (x - 1)] + -2 * gr[(y - 1) * W + x] + -1 * gr[(y - 1) * W + (x + 1)] + 1 * gr[(y + 1) * W + (x - 1)] + 2 * gr[(y + 1) * W + x] + 1 * gr[(y + 1) * W + (x + 1)];
      const mag = clamp01(Math.sqrt(gx * gx + gy * gy) * k);
      const v = Math.round(mag * 255);
      const i = (y * W + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  img.data.set(out);
  putImageData(ctx, img);
}
function applyBlur(ctx, W, H, radiusPx, sigmaPx) {
  const blurPx = Math.max(0, Math.max(radiusPx, sigmaPx));
  if (blurPx <= 0) return;
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.filter = "none";
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0);
}
function applyChannel(ctx, W, H, channel) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const normalized = String(channel || "Red").trim().toLowerCase();
  const index = normalized === "green" || normalized === "g" ? 1 : normalized === "blue" || normalized === "b" ? 2 : normalized === "alpha" || normalized === "a" ? 3 : 0;
  for (let i = 0; i < d.length; i += 4) {
    const value = index === 3 ? d[i + 3] : d[i + index];
    d[i] = value;
    d[i + 1] = value;
    d[i + 2] = value;
    if (index === 3) d[i + 3] = value;
  }
  putImageData(ctx, img);
}
function applyDesaturate(ctx, W, H, factor = 1) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const amount = clamp01(factor);
  const lw = getOpsConstants().luma_weights;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const l = luma01(r, g, b, lw);
    d[i] = Math.round(clamp01(r * (1 - amount) + l * amount) * 255);
    d[i + 1] = Math.round(clamp01(g * (1 - amount) + l * amount) * 255);
    d[i + 2] = Math.round(clamp01(b * (1 - amount) + l * amount) * 255);
  }
  putImageData(ctx, img);
}
function applyTransform(ctx, W, H, tx, ty, rotDeg, scale, filter, expand) {
  void expand;
  const safeScale = Math.max(0.01, scale || 1);
  const rad = rotDeg * Math.PI / 180;
  const needsScale = Math.abs(safeScale - 1) > 1e-4;
  const needsRotate = Math.abs(rotDeg) > 1e-4;
  const needsTranslate = tx !== 0 || ty !== 0;
  if (!needsScale && !needsRotate && !needsTranslate) return;
  const output = makeCanvas(W, H);
  const octx = output.getContext("2d");
  setResampleMode(octx, filter);
  octx.clearRect(0, 0, W, H);
  octx.save();
  octx.translate(W / 2 + tx, H / 2 + ty);
  octx.rotate(rad);
  octx.scale(safeScale, safeScale);
  octx.drawImage(ctx.canvas, -W / 2, -H / 2, W, H);
  octx.restore();
  return output;
}
function applyGlow(ctx, W, H, threshold, intensity, blurPx) {
  const { luma_weights: LW } = getOpsConstants();
  const base = getImageData(ctx, W, H);
  const d = base.data;
  const hi = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const l = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    if (l >= threshold) {
      hi[i] = d[i];
      hi[i + 1] = d[i + 1];
      hi[i + 2] = d[i + 2];
      hi[i + 3] = d[i + 3];
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.putImageData(new ImageData(hi, W, H), 0, 0);
  const blur = document.createElement("canvas");
  blur.width = W;
  blur.height = H;
  const bctx = blur.getContext("2d");
  bctx.filter = `blur(${Math.max(0, blurPx)}px)`;
  bctx.drawImage(tmp, 0, 0);
  bctx.filter = "none";
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(blur, 0, 0);
  ctx.restore();
}
function applyCropReformat(ctx, W, H, x, y, cw, ch, padding, outW, outH, mode) {
  const cropW = Math.max(1, Math.round(cw));
  const cropH = Math.max(1, Math.round(ch));
  const pad = Math.max(0, Math.round(padding));
  const tmp = document.createElement("canvas");
  tmp.width = cropW + pad * 2;
  tmp.height = cropH + pad * 2;
  const tctx = tmp.getContext("2d");
  tctx.clearRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(ctx.canvas, -Math.round(x) + pad, -Math.round(y) + pad);
  const finalW = outW > 0 ? Math.round(outW) : tmp.width;
  const finalH = outH > 0 ? Math.round(outH) : tmp.height;
  const dst = document.createElement("canvas");
  dst.width = finalW;
  dst.height = finalH;
  const dctx = dst.getContext("2d");
  dctx.clearRect(0, 0, finalW, finalH);
  if (mode === "stretch") {
    dctx.drawImage(tmp, 0, 0, finalW, finalH);
  } else {
    const s = mode === "fill" ? Math.max(finalW / tmp.width, finalH / tmp.height) : Math.min(finalW / tmp.width, finalH / tmp.height);
    const dw = Math.floor(tmp.width * s);
    const dh = Math.floor(tmp.height * s);
    const dx = Math.floor((finalW - dw) / 2);
    const dy = Math.floor((finalH - dh) / 2);
    dctx.drawImage(tmp, dx, dy, dw, dh);
  }
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(dst, 0, 0, W, H);
}
function applyCrop(ctx, node, sourceWidth, sourceHeight, aspectRatio, outW, outH) {
  const finalW = Math.max(1, Math.round(outW));
  const finalH = Math.max(1, Math.round(outH));
  const ratio = resolveCropAspectRatio(aspectRatio, finalW, finalH);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    ratio,
    clampCropCenter(num(node, "crop_center_x", 0.5)),
    clampCropCenter(num(node, "crop_center_y", 0.5)),
    clampCropScale(num(node, "crop_scale", 1))
  );
  const output = makeCanvas(finalW, finalH);
  const octx = output.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.clearRect(0, 0, finalW, finalH);
  octx.drawImage(
    ctx.canvas,
    crop.x,
    crop.y,
    crop.cropWidth,
    crop.cropHeight,
    0,
    0,
    finalW,
    finalH
  );
  return output;
}
function padOutRatio(targetFormat) {
  const normalized = String(targetFormat || "custom").trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized === "1:1" || normalized === "square" || normalized === "nearest_square") return [1, 1];
  if (normalized === "16:9") return [16, 9];
  if (normalized === "9:16") return [9, 16];
  if (normalized === "4:3") return [4, 3];
  if (normalized === "3:4") return [3, 4];
  return null;
}
function resolvePadOutGeometry(sourceWidth, sourceHeight, node, frameIndex = 0) {
  let padLeft = Math.max(0, Math.round(numAny(node, ["pad_left"], 0, frameIndex)));
  let padTop = Math.max(0, Math.round(numAny(node, ["pad_top"], 0, frameIndex)));
  let padRight = Math.max(0, Math.round(numAny(node, ["pad_right"], 0, frameIndex)));
  let padBottom = Math.max(0, Math.round(numAny(node, ["pad_bottom"], 0, frameIndex)));
  let outWidth = Math.max(1, sourceWidth + padLeft + padRight);
  let outHeight = Math.max(1, sourceHeight + padTop + padBottom);
  const ratio = padOutRatio(strAny(node, ["target_format"], "custom", frameIndex));
  if (ratio) {
    const [ratioW, ratioH] = ratio;
    let targetWidth = outWidth;
    let targetHeight = outHeight;
    if (outWidth * ratioH < outHeight * ratioW) {
      targetWidth = Math.ceil(outHeight * ratioW / ratioH);
    } else if (outWidth * ratioH > outHeight * ratioW) {
      targetHeight = Math.ceil(outWidth * ratioH / ratioW);
    }
    const extraW = Math.max(0, targetWidth - outWidth);
    const extraH = Math.max(0, targetHeight - outHeight);
    const extraLeft = Math.floor(extraW / 2);
    const extraTop = Math.floor(extraH / 2);
    padLeft += extraLeft;
    padRight += extraW - extraLeft;
    padTop += extraTop;
    padBottom += extraH - extraTop;
    outWidth = targetWidth;
    outHeight = targetHeight;
  }
  return { padLeft, padTop, padRight, padBottom, outWidth, outHeight };
}
function normalizePadOutFillMode(value) {
  const normalized = String(value || "constant").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "edge" || normalized === "edge_extend" || normalized === "replicate" || normalized === "extend") return "edge_extend";
  if (normalized === "blur" || normalized === "blurry" || normalized === "blurred") return "blurry";
  if (normalized === "reflect" || normalized === "reflection" || normalized === "mirror") return "reflect";
  return "constant";
}
function drawPadOutExtendedEdges(ctx, source, sourceWidth, sourceHeight, padLeft, padTop, padRight, padBottom) {
  const centerX = padLeft;
  const centerY = padTop;
  ctx.imageSmoothingEnabled = false;
  if (padLeft > 0) ctx.drawImage(source, 0, 0, 1, sourceHeight, 0, centerY, padLeft, sourceHeight);
  if (padRight > 0) ctx.drawImage(source, sourceWidth - 1, 0, 1, sourceHeight, centerX + sourceWidth, centerY, padRight, sourceHeight);
  if (padTop > 0) ctx.drawImage(source, 0, 0, sourceWidth, 1, centerX, 0, sourceWidth, padTop);
  if (padBottom > 0) ctx.drawImage(source, 0, sourceHeight - 1, sourceWidth, 1, centerX, centerY + sourceHeight, sourceWidth, padBottom);
  if (padLeft > 0 && padTop > 0) ctx.drawImage(source, 0, 0, 1, 1, 0, 0, padLeft, padTop);
  if (padRight > 0 && padTop > 0) ctx.drawImage(source, sourceWidth - 1, 0, 1, 1, centerX + sourceWidth, 0, padRight, padTop);
  if (padLeft > 0 && padBottom > 0) ctx.drawImage(source, 0, sourceHeight - 1, 1, 1, 0, centerY + sourceHeight, padLeft, padBottom);
  if (padRight > 0 && padBottom > 0) ctx.drawImage(source, sourceWidth - 1, sourceHeight - 1, 1, 1, centerX + sourceWidth, centerY + sourceHeight, padRight, padBottom);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, centerX, centerY, sourceWidth, sourceHeight);
}
function renderPadOutCanvases(node, source, frameIndex = 0, applyInvertMask = true) {
  const fillColor = parseHexColor(strAny(node, ["fill_color"], "#000000", frameIndex));
  const fillMode = normalizePadOutFillMode(strAny(node, ["fill_mode"], "constant", frameIndex));
  const blurRadius = Math.max(0, Math.round(numAny(node, ["blur_radius"], 32, frameIndex)));
  const invertMask = applyInvertMask && boolAny(node, ["invert_mask"], false, frameIndex);
  const sourceWidth = source.width || 1;
  const sourceHeight = source.height || 1;
  const { padLeft, padTop, padRight, padBottom, outWidth, outHeight } = resolvePadOutGeometry(sourceWidth, sourceHeight, node, frameIndex);
  const image = makeCanvas(outWidth, outHeight);
  const imageCtx = image.getContext("2d");
  if (fillMode === "blurry") {
    imageCtx.save();
    imageCtx.imageSmoothingEnabled = true;
    imageCtx.imageSmoothingQuality = "high";
    imageCtx.filter = blurRadius > 0 ? `blur(${blurRadius}px)` : "none";
    imageCtx.drawImage(source, 0, 0, outWidth, outHeight);
    imageCtx.restore();
    imageCtx.drawImage(source, padLeft, padTop, sourceWidth, sourceHeight);
  } else if (fillMode === "edge_extend" || fillMode === "reflect") {
    drawPadOutExtendedEdges(imageCtx, source, sourceWidth, sourceHeight, padLeft, padTop, padRight, padBottom);
  } else {
    imageCtx.fillStyle = fillColor;
    imageCtx.fillRect(0, 0, outWidth, outHeight);
    imageCtx.drawImage(source, padLeft, padTop, sourceWidth, sourceHeight);
  }
  const mask = makeCanvas(outWidth, outHeight);
  const maskCtx = mask.getContext("2d");
  maskCtx.fillStyle = invertMask ? "#000000" : "#FFFFFF";
  maskCtx.fillRect(0, 0, outWidth, outHeight);
  maskCtx.fillStyle = invertMask ? "#FFFFFF" : "#000000";
  maskCtx.fillRect(padLeft, padTop, sourceWidth, sourceHeight);
  markPreparedMaskCanvas(mask);
  return { image, mask };
}
function solveLinear8x8(matrix, vector) {
  const n = 8;
  const A = matrix.map((row) => row.slice());
  const b = vector.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const valueAbs = Math.abs(A[row][col]);
      if (valueAbs > pivotAbs) {
        pivot = row;
        pivotAbs = valueAbs;
      }
    }
    if (pivotAbs < 1e-10) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
      const vb = b[col];
      b[col] = b[pivot];
      b[pivot] = vb;
    }
    const inv = 1 / A[col][col];
    for (let c = col; c < n; c++) A[col][c] *= inv;
    b[col] *= inv;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c < n; c++) A[row][c] -= factor * A[col][c];
      b[row] -= factor * b[col];
    }
  }
  return b;
}
function invert3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10) return null;
  const invDet = 1 / det;
  return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
}
function solveCornerPinInverseHomography(node, width, height, frameIndex = 0) {
  const src = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)]
  ];
  const dst = [
    [numAny(node, ["tl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["tl_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["tr_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["tr_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["bl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["bl_y"], 1, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["br_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["br_y"], 1, frameIndex) * Math.max(0, height - 1)]
  ];
  const A = [];
  const b = [];
  for (let idx = 0; idx < 4; idx++) {
    const x = src[idx][0];
    const y = src[idx][1];
    const u = dst[idx][0];
    const v = dst[idx][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const solved = solveLinear8x8(A, b);
  if (!solved) return null;
  const H = [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1];
  return invert3x3(H);
}
function reflectCoord(value, maxInclusive) {
  if (maxInclusive <= 0) return 0;
  const period = maxInclusive * 2;
  let x = value % period;
  if (x < 0) x += period;
  if (x > maxInclusive) x = period - x;
  return x;
}
function sampleChannelNearest(data, width, height, x, y, channel) {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return data[(iy * width + ix) * 4 + channel];
}
function sampleChannelBilinear(data, width, height, x, y, channel) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const c00 = data[(Math.max(0, y0) * width + Math.max(0, x0)) * 4 + channel];
  const c10 = data[(Math.max(0, y0) * width + Math.max(0, x1)) * 4 + channel];
  const c01 = data[(Math.max(0, y1) * width + Math.max(0, x0)) * 4 + channel];
  const c11 = data[(Math.max(0, y1) * width + Math.max(0, x1)) * 4 + channel];
  return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy;
}
function renderCornerPinCanvases(node, source, frameIndex = 0) {
  const width = source.width || 1;
  const height = source.height || 1;
  const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
  const edgeMode = strAny(node, ["edge_mode"], "zeros", frameIndex).toLowerCase();
  const supersample = Math.max(1, Math.min(4, Math.round(numAny(node, ["supersample"], 1, frameIndex))));
  const invertMask = boolAny(node, ["invert_mask"], false, frameIndex);
  const bypass = boolAny(node, ["bypass"], false, frameIndex);
  if (bypass) {
    const image2 = fitCanvas(source, width, height);
    const mask2 = makeCanvas(width, height);
    const maskCtx2 = mask2.getContext("2d");
    maskCtx2.fillStyle = invertMask ? "#000000" : "#FFFFFF";
    maskCtx2.fillRect(0, 0, width, height);
    markPreparedMaskCanvas(mask2);
    return { image: image2, mask: mask2 };
  }
  const inverse = solveCornerPinInverseHomography(node, width, height, frameIndex);
  if (!inverse) {
    const image2 = fitCanvas(source, width, height);
    const mask2 = makeCanvas(width, height);
    const maskCtx2 = mask2.getContext("2d");
    maskCtx2.fillStyle = invertMask ? "#FFFFFF" : "#000000";
    maskCtx2.fillRect(0, 0, width, height);
    markPreparedMaskCanvas(mask2);
    return { image: image2, mask: mask2 };
  }
  const sourceCtx = source.getContext("2d");
  const srcImage = sourceCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;
  const image = makeCanvas(width, height);
  const imageCtx = image.getContext("2d");
  const outImage = imageCtx.createImageData(width, height);
  const outData = outImage.data;
  const mask = makeCanvas(width, height);
  const maskCtx = mask.getContext("2d");
  const outMask = maskCtx.createImageData(width, height);
  const outMaskData = outMask.data;
  const useNearest = filter === "nearest";
  const sampleCount = supersample * supersample;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outOffset = (y * width + x) * 4;
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;
      let alphaSum = 0;
      let insideSum = 0;
      for (let subY = 0; subY < supersample; subY++) {
        const dstY = supersample === 1 ? y : y + (subY + 0.5) / supersample - 0.5;
        for (let subX = 0; subX < supersample; subX++) {
          const dstX = supersample === 1 ? x : x + (subX + 0.5) / supersample - 0.5;
          const denom = inverse[6] * dstX + inverse[7] * dstY + inverse[8];
          const safeDenom = Math.abs(denom) < 1e-8 ? 1e-8 : denom;
          let sx = (inverse[0] * dstX + inverse[1] * dstY + inverse[2]) / safeDenom;
          let sy = (inverse[3] * dstX + inverse[4] * dstY + inverse[5]) / safeDenom;
          const inside = sx >= 0 && sx <= width - 1 && sy >= 0 && sy <= height - 1;
          if (inside) insideSum += 1;
          if (!inside && edgeMode === "zeros") continue;
          if (edgeMode === "border") {
            sx = Math.max(0, Math.min(width - 1, sx));
            sy = Math.max(0, Math.min(height - 1, sy));
          } else if (edgeMode === "reflection") {
            sx = reflectCoord(sx, width - 1);
            sy = reflectCoord(sy, height - 1);
          }
          const r = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 0) : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
          const g = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 1) : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
          const b = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 2) : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
          const a = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 3) : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
          premulR += r * (a / 255);
          premulG += g * (a / 255);
          premulB += b * (a / 255);
          alphaSum += a;
        }
      }
      const alpha = alphaSum / sampleCount;
      const alpha01 = alpha / 255;
      outData[outOffset] = alpha01 > 1e-6 ? Math.round(clamp01(premulR / sampleCount / alpha01 / 255) * 255) : 0;
      outData[outOffset + 1] = alpha01 > 1e-6 ? Math.round(clamp01(premulG / sampleCount / alpha01 / 255) * 255) : 0;
      outData[outOffset + 2] = alpha01 > 1e-6 ? Math.round(clamp01(premulB / sampleCount / alpha01 / 255) * 255) : 0;
      outData[outOffset + 3] = Math.round(clamp01(alpha01) * 255);
      const maskValue = Math.round(clamp01(insideSum / sampleCount * alpha01) * 255);
      const finalMask = invertMask ? 255 - maskValue : maskValue;
      outMaskData[outOffset] = finalMask;
      outMaskData[outOffset + 1] = finalMask;
      outMaskData[outOffset + 2] = finalMask;
      outMaskData[outOffset + 3] = 255;
    }
  }
  imageCtx.putImageData(outImage, 0, 0);
  maskCtx.putImageData(outMask, 0, 0);
  markPreparedMaskCanvas(mask);
  return { image, mask };
}
function buildMaskAlphaCanvas(maskCanvas, width, height) {
  if (isPreparedMaskCanvas(maskCanvas) && (maskCanvas.width || 1) === width && (maskCanvas.height || 1) === height) {
    return maskCanvas;
  }
  const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}`;
  const cachedPrepared = preparedMaskCache.get(maskCanvas)?.get(cacheKey);
  if (cachedPrepared) return cachedPrepared;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d");
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
function alphaMaskCanvas(source) {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  const image = octx.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const matte = data[index + 3];
    data[index] = matte;
    data[index + 1] = matte;
    data[index + 2] = matte;
    data[index + 3] = 255;
  }
  octx.putImageData(image, 0, 0);
  return markPreparedMaskCanvas(output);
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
  const octx = output.getContext("2d");
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
    const blurCtx = levelsSource.getContext("2d");
    blurCtx.filter = `blur(${antialiasRadius}px)`;
    blurCtx.drawImage(output, 0, 0);
    blurCtx.filter = "none";
  }
  const blackPoint = numAny(node ?? {}, ["black_point", "black"], 0, frameIndex);
  const whitePoint = numAny(node ?? {}, ["white_point", "white"], 1, frameIndex);
  const levelsCtx = levelsSource.getContext("2d");
  const levelsImage = levelsCtx.getImageData(0, 0, levelsSource.width, levelsSource.height);
  const levelsData = levelsImage.data;
  for (let index = 0; index < levelsData.length; index += 4) {
    const matte = Math.round(applyMaskConvertLevels(levelsData[index] / 255, blackPoint, whitePoint) * 255);
    levelsData[index] = matte;
    levelsData[index + 1] = matte;
    levelsData[index + 2] = matte;
    levelsData[index + 3] = 255;
  }
  levelsCtx.putImageData(levelsImage, 0, 0);
  return markPreparedMaskCanvas(levelsSource);
}
function applyEffectToCanvas(source, effect) {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const copyCtx = output.getContext("2d");
  copyCtx.drawImage(source, 0, 0, output.width, output.height);
  const octx = output.getContext("2d");
  const result = effect(octx, output.width, output.height);
  return result instanceof HTMLCanvasElement ? result : output;
}
function resolvePreviewMaskCanvas(node, source, rawMask, frameIndex = 0) {
  if (!rawMask) return null;
  const matte = buildMaskAlphaCanvas(rawMask, source.width || 1, source.height || 1);
  return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(matte) : matte;
}
function compositeProcessedWithMask(baseCanvas, processedCanvas, maskCanvas) {
  if (!maskCanvas) return processedCanvas;
  const output = fitCanvas(baseCanvas, processedCanvas.width || 1, processedCanvas.height || 1);
  const octx = output.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
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
  const processedMask = options.processMask ? options.processMask(mask) : fitCanvas(mask, processed.width || 1, processed.height || 1);
  return compositeProcessedWithMask(options.baseCanvas ?? source, processed, processedMask);
}
function premultLayerWithMask(imageCanvas, maskCanvas) {
  if (!maskCanvas) return imageCanvas;
  const output = makeCanvas(imageCanvas.width || 1, imageCanvas.height || 1);
  const octx = output.getContext("2d");
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
  const output = makeCanvas(maskCanvas.width || 1, maskCanvas.height || 1);
  const octx = output.getContext("2d");
  octx.drawImage(maskCanvas, 0, 0, output.width, output.height);
  const image = octx.getImageData(0, 0, output.width, output.height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255 - data[i];
    data[i + 1] = 255 - data[i + 1];
    data[i + 2] = 255 - data[i + 2];
    data[i + 3] = 255 - data[i + 3];
  }
  octx.putImageData(image, 0, 0);
  return markPreparedMaskCanvas(output);
}
function invertMaskAlphaCanvas(maskCanvas) {
  const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d");
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
function blurMaskAlphaCanvas(maskCanvas, radius) {
  const prepared = buildMaskAlphaCanvas(maskCanvas, maskCanvas.width || 1, maskCanvas.height || 1);
  const safeRadius = Math.max(0, radius);
  if (safeRadius <= 0) return prepared;
  const output = makeCanvas(prepared.width || 1, prepared.height || 1);
  const octx = output.getContext("2d");
  octx.filter = `blur(${safeRadius}px)`;
  octx.drawImage(prepared, 0, 0, output.width, output.height);
  octx.filter = "none";
  return markPreparedMaskCanvas(output);
}
function emptyMaskCanvas(width, height) {
  return markPreparedMaskCanvas(makeCanvas(width, height));
}
function renderPadOutStitchCanvases(node, inputs = [], frameIndex = 0) {
  const stitcherCanvas = inputs[0] ?? null;
  const outpainted = inputs[1] ?? stitcherCanvas ?? makeCanvas(1, 1);
  const fallbackOriginal = inputs[2] ?? null;
  const width = outpainted.width || 1;
  const height = outpainted.height || 1;
  const stitcherMask = getPadOutStitcherMask(stitcherCanvas);
  const rawPadoutMask = stitcherMask ?? inputs[3] ?? null;
  const canvasSource = stitcherCanvas ?? fallbackOriginal;
  if (!rawPadoutMask) {
    return { image: outpainted, mask: emptyMaskCanvas(width, height) };
  }
  const padoutMask = buildMaskAlphaCanvas(rawPadoutMask, width, height);
  const originalRegion = strAny(node, ["original_region"], "black_is_original", frameIndex).toLowerCase().replace(/[-\s]+/g, "_");
  const preserveMask = stitcherMask ? invertMaskAlphaCanvas(padoutMask) : originalRegion === "white_is_original" ? padoutMask : invertMaskAlphaCanvas(padoutMask);
  const outpaintMask = invertMaskAlphaCanvas(preserveMask);
  const outputMask = boolAny(node, ["invert_mask"], false, frameIndex) ? preserveMask : outpaintMask;
  if (!canvasSource || boolAny(node, ["bypass"], false, frameIndex)) {
    return { image: outpainted, mask: outputMask };
  }
  const bounds = computeMaskBounds(preserveMask);
  if (!bounds) {
    return { image: outpainted, mask: outputMask };
  }
  const placed = makeCanvas(width, height);
  const pctx = placed.getContext("2d");
  pctx.drawImage(outpainted, 0, 0, width, height);
  setResampleMode(pctx, "bicubic");
  if (stitcherMask) {
    pctx.drawImage(canvasSource, 0, 0, width, height);
  } else {
    pctx.drawImage(canvasSource, bounds.x, bounds.y, bounds.width, bounds.height);
  }
  const featherRadius = Math.max(0, numAny(node, ["feather_radius"], 0, frameIndex));
  const compositeMask = featherRadius > 0 ? blurMaskAlphaCanvas(preserveMask, featherRadius) : preserveMask;
  return {
    image: compositeProcessedWithMask(outpainted, placed, compositeMask),
    mask: outputMask
  };
}
function renderCompPreview(node, inputLayers) {
  const slots = getCompSlots(node);
  const allLayers = syncCompLayers(str(node, "layers_json", ""), slots);
  const layerBySlot = new Map(allLayers.map((layer) => [layer.slot, layer]));
  const firstInput = inputLayers[0]?.image ?? null;
  const useAutoLayering = bool(node, "auto_layering", false);
  const useFirst = bool(node, "use_first_layer_size", true);
  const largestWidth = inputLayers.reduce((value, entry) => Math.max(value, entry.image.width || 1), 1);
  const largestHeight = inputLayers.reduce((value, entry) => Math.max(value, entry.image.height || 1), 1);
  const outputWidth = useAutoLayering ? largestWidth : useFirst && firstInput ? Math.max(1, firstInput.width) : Math.max(1, Math.round(num(node, "width", firstInput?.width ?? 1024)));
  const outputHeight = useAutoLayering ? largestHeight : useFirst && firstInput ? Math.max(1, firstInput.height) : Math.max(1, Math.round(num(node, "height", firstInput?.height ?? 1024)));
  const output = makeCanvas(outputWidth, outputHeight);
  const octx = output.getContext("2d");
  const alphaCanvas = makeCanvas(outputWidth, outputHeight);
  const alphaCtx = alphaCanvas.getContext("2d");
  octx.fillStyle = parseHexColor(str(node, "background_color", "#000000"));
  octx.fillRect(0, 0, outputWidth, outputHeight);
  alphaCtx.clearRect(0, 0, outputWidth, outputHeight);
  const geometries = [];
  for (let index = 0; index < inputLayers.length; index++) {
    const entry = inputLayers[index];
    const input = premultLayerWithMask(entry.image, entry.mask ?? null);
    const layer = layerBySlot.get(entry.slot);
    if (!input || !layer || layer.enabled === false) continue;
    const rect = computeCompRect(outputWidth, outputHeight, entry.image.width || 1, entry.image.height || 1, layer);
    geometries.push({
      slot: entry.slot,
      layerNumber: entry.layerNumber,
      inputIndex: entry.inputIndex,
      sourceWidth: entry.image.width || 1,
      sourceHeight: entry.image.height || 1,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.centerX,
      centerY: rect.centerY,
      drawWidth: rect.drawWidth,
      drawHeight: rect.drawHeight,
      rotationDeg: rect.rotationDeg
    });
    octx.save();
    octx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    octx.globalCompositeOperation = compModeToCanvasOp(layer.mode);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.translate(rect.centerX, rect.centerY);
    octx.rotate(rect.rotationDeg * Math.PI / 180);
    octx.drawImage(input, -rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
    octx.restore();
    alphaCtx.save();
    alphaCtx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    alphaCtx.globalCompositeOperation = "source-over";
    alphaCtx.imageSmoothingEnabled = true;
    alphaCtx.imageSmoothingQuality = "high";
    alphaCtx.translate(rect.centerX, rect.centerY);
    alphaCtx.rotate(rect.rotationDeg * Math.PI / 180);
    alphaCtx.drawImage(input, -rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
    alphaCtx.restore();
  }
  const image = octx.getImageData(0, 0, outputWidth, outputHeight);
  const alphaImage = alphaCtx.getImageData(0, 0, outputWidth, outputHeight);
  const data = image.data;
  const alphaData = alphaImage.data;
  for (let index = 0; index < data.length; index += 4) {
    data[index + 3] = alphaData[index + 3];
  }
  octx.putImageData(image, 0, 0);
  return { canvas: output, layers: geometries };
}
function resolveCompPreviewInputs(node, inputs) {
  const connectedSlots = getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null);
  const resolved = [];
  let cursor = 0;
  for (const slot of connectedSlots) {
    const image = inputs[cursor++] ?? null;
    if (!image) continue;
    let mask = null;
    if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
      mask = inputs[cursor++] ?? null;
    }
    resolved.push({
      image,
      mask,
      slot: slot.slot,
      layerNumber: slot.layerNumber,
      inputIndex: slot.inputIndex
    });
  }
  return resolved;
}
async function renderDrawNodePreview(node, baseCanvas = null) {
  return await renderDrawPreview(node, baseCanvas);
}
function applyLumaKey(ctx, W, H, low, high, softness) {
  const { epsilon: EPS, luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    let a = 0;
    if (l <= low) a = 0;
    else if (l >= high) a = 1;
    else {
      const t = (l - low) / Math.max(EPS, high - low);
      const s = Math.max(0, Math.min(1, softness * 10));
      a = t * (1 - s) + t * t * (3 - 2 * t) * s;
    }
    d[i + 3] = Math.round(clamp01(a) * 255);
  }
  putImageData(ctx, img);
}
function softLightD(a) {
  return a <= 0.25 ? ((16 * a - 12) * a + 4) * a : Math.sqrt(a);
}
function srgbToLinear01(value) {
  const v = clamp01(value);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb01(value) {
  const v = clamp01(value);
  return v <= 31308e-7 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
function normalizeBlendModeName(mode) {
  const normalized = String(mode || "over").toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "normal" ? "over" : normalized;
}
function colorDodge01(base, top) {
  return top >= 1 - 1e-6 ? 1 : clamp01(base / Math.max(1e-6, 1 - top));
}
function colorBurn01(base, top) {
  return top <= 1e-6 ? 0 : clamp01(1 - (1 - base) / Math.max(1e-6, top));
}
function blendChannel01(base, top, mode) {
  if (mode === "over") return top;
  if (mode === "add") return base + top;
  if (mode === "subtract") return base - top;
  if (mode === "multiply") return base * top;
  if (mode === "screen") return 1 - (1 - base) * (1 - top);
  if (mode === "overlay") return base <= 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
  if (mode === "soft_light" || mode === "soft-light") {
    return top <= 0.5 ? base - (1 - 2 * top) * base * (1 - base) : base + (2 * top - 1) * (softLightD(base) - base);
  }
  if (mode === "difference") return Math.abs(base - top);
  if (mode === "lighten" || mode === "max") return Math.max(base, top);
  if (mode === "darken" || mode === "min") return Math.min(base, top);
  if (mode === "color_dodge") return colorDodge01(base, top);
  if (mode === "color_burn") return colorBurn01(base, top);
  if (mode === "exclusion") return base + top - 2 * base * top;
  if (mode === "vivid_light") return top <= 0.5 ? colorBurn01(base, top * 2) : colorDodge01(base, top * 2 - 1);
  if (mode === "pin_light") return top <= 0.5 ? Math.min(base, top * 2) : Math.max(base, top * 2 - 1);
  if (mode === "hard_mix") return blendChannel01(base, top, "vivid_light") < 0.5 ? 0 : 1;
  return top;
}
function fitMergeForeground(topCanvas, width, height, fitMode) {
  const mode = String(fitMode || "stretch").toLowerCase().replace(/[-\s]+/g, "_");
  const out = makeCanvas(width, height);
  const octx = out.getContext("2d");
  octx.clearRect(0, 0, out.width, out.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  const srcW = Math.max(1, topCanvas.width || 1);
  const srcH = Math.max(1, topCanvas.height || 1);
  if (mode === "stretch" || mode === "scale" || mode === "resize" || mode === "fit_exact") {
    octx.drawImage(topCanvas, 0, 0, out.width, out.height);
    return out;
  }
  let drawW = srcW;
  let drawH = srcH;
  if (!(mode === "none" || mode === "center" || mode === "original")) {
    const fitScale = Math.min(out.width / srcW, out.height / srcH);
    const fillScale = Math.max(out.width / srcW, out.height / srcH);
    const scale = mode === "cover" || mode === "fill" || mode === "crop" ? fillScale : fitScale;
    drawW = Math.max(1, Math.round(srcW * scale));
    drawH = Math.max(1, Math.round(srcH * scale));
  }
  const dx = Math.round((out.width - drawW) / 2);
  const dy = Math.round((out.height - drawH) / 2);
  octx.drawImage(topCanvas, dx, dy, drawW, drawH);
  return out;
}
function blend(ctx, W, H, topCanvas, mode, mix, foregroundFit = "stretch", blendSpace = "linear") {
  const m = Math.max(0, Math.min(1, mix));
  if (m <= 0) return;
  const scaledTop = fitMergeForeground(topCanvas, W, H, foregroundFit);
  const base = getImageData(ctx, W, H);
  const top = scaledTop.getContext("2d").getImageData(0, 0, W, H);
  const bd = base.data;
  const td = top.data;
  const blendMode = normalizeBlendModeName(mode);
  const linear = String(blendSpace || "linear").toLowerCase().replace(/[-\s]+/g, "_") !== "srgb";
  for (let i = 0; i < bd.length; i += 4) {
    const arSrgb = bd[i] / 255;
    const agSrgb = bd[i + 1] / 255;
    const abSrgb = bd[i + 2] / 255;
    const aa = bd[i + 3] / 255;
    const brSrgb = td[i] / 255;
    const bgSrgb = td[i + 1] / 255;
    const bbSrgb = td[i + 2] / 255;
    const ba = td[i + 3] / 255;
    const ar = linear ? srgbToLinear01(arSrgb) : arSrgb;
    const ag = linear ? srgbToLinear01(agSrgb) : agSrgb;
    const ab = linear ? srgbToLinear01(abSrgb) : abSrgb;
    const br = linear ? srgbToLinear01(brSrgb) : brSrgb;
    const bg = linear ? srgbToLinear01(bgSrgb) : bgSrgb;
    const bb = linear ? srgbToLinear01(bbSrgb) : bbSrgb;
    if (blendMode === "over") {
      const rr2 = br * ba + ar * (1 - ba);
      const rg2 = bg * ba + ag * (1 - ba);
      const rb2 = bb * ba + ab * (1 - ba);
      const outR2 = clamp01(ar * (1 - m) + rr2 * m);
      const outG2 = clamp01(ag * (1 - m) + rg2 * m);
      const outB2 = clamp01(ab * (1 - m) + rb2 * m);
      const mergedAlpha = ba + aa * (1 - ba);
      const outA = clamp01(aa * (1 - m) + mergedAlpha * m);
      bd[i] = Math.round((linear ? linearToSrgb01(outR2) : outR2) * 255);
      bd[i + 1] = Math.round((linear ? linearToSrgb01(outG2) : outG2) * 255);
      bd[i + 2] = Math.round((linear ? linearToSrgb01(outB2) : outB2) * 255);
      bd[i + 3] = Math.round(outA * 255);
      continue;
    }
    const rr = blendChannel01(ar, br, blendMode) * ba + ar * (1 - ba);
    const rg = blendChannel01(ag, bg, blendMode) * ba + ag * (1 - ba);
    const rb = blendChannel01(ab, bb, blendMode) * ba + ab * (1 - ba);
    const outR = clamp01(ar * (1 - m) + clamp01(rr) * m);
    const outG = clamp01(ag * (1 - m) + clamp01(rg) * m);
    const outB = clamp01(ab * (1 - m) + clamp01(rb) * m);
    bd[i] = Math.round((linear ? linearToSrgb01(outR) : outR) * 255);
    bd[i + 1] = Math.round((linear ? linearToSrgb01(outG) : outG) * 255);
    bd[i + 2] = Math.round((linear ? linearToSrgb01(outB) : outB) * 255);
    bd[i + 3] = Math.round(clamp01(aa) * 255);
  }
  putImageData(ctx, base);
}
function resolveResizeDimensions(node, sourceWidth, sourceHeight) {
  let width = Math.round(numAny(node, ["target_width", "width", "largest_size"], 0));
  let height = Math.round(numAny(node, ["target_height", "height", "largest_size"], 0));
  const scaleBy = numAny(node, ["scale_by", "multiplier"], 0);
  const megapixels = numAny(node, ["megapixels"], 0);
  const size = Math.round(numAny(node, ["size", "longer_size", "shorter_size"], 0));
  const filter = normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear"));
  const crop = strAny(node, ["crop", "crop_method"], "disabled");
  const method = strAny(node, ["keep_proportion", "method", "resize_type"], crop === "center" ? "crop" : "stretch");
  const keepProportion = boolAny(node, ["keep_proportion"], false);
  const fillColor = strAny(node, ["pad_color", "padding_color", "background_color", "color"], "#000000");
  const cropPosition = strAny(node, ["crop_position"], "center");
  if (scaleBy > 0) {
    width = Math.max(1, Math.round(sourceWidth * scaleBy));
    height = Math.max(1, Math.round(sourceHeight * scaleBy));
  } else if (size > 0) {
    const useLonger = !w(node, "mode") || bool(node, "mode", true) || String(strAny(node, ["resize_type"], "")).includes("longer");
    const dominant = useLonger ? Math.max(sourceWidth, sourceHeight) : Math.min(sourceWidth, sourceHeight);
    const ratio = size / Math.max(1, dominant);
    width = Math.max(1, Math.round(sourceWidth * ratio));
    height = Math.max(1, Math.round(sourceHeight * ratio));
  } else if (megapixels > 0) {
    const total = megapixels * 1024 * 1024;
    const ratio = sourceWidth / Math.max(1, sourceHeight);
    height = Math.max(1, Math.round(Math.sqrt(total / Math.max(1e-4, ratio))));
    width = Math.max(1, Math.round(height * ratio));
  } else if (width === 0 && height === 0) {
    width = sourceWidth;
    height = sourceHeight;
  } else if (width === 0) {
    width = Math.max(1, Math.round(sourceWidth * (height / Math.max(1, sourceHeight))));
  } else if (height === 0) {
    height = Math.max(1, Math.round(sourceHeight * (width / Math.max(1, sourceWidth))));
  }
  const multiple = Math.round(numAny(node, ["multiple_of", "divisible_by", "resolution_steps"], 0));
  if (multiple > 1) {
    width = Math.max(1, width - width % multiple);
    height = Math.max(1, height - height % multiple);
  }
  let mode = "stretch";
  const normalizedMethod = String(method).toLowerCase();
  if (keepProportion && normalizedMethod === "stretch" && crop !== "center") mode = "fit";
  else if (normalizedMethod.includes("pad") || normalizedMethod.includes("pillarbox")) mode = "pad";
  else if (normalizedMethod.includes("keep proportion") || normalizedMethod === "resize" || normalizedMethod.includes("fit")) mode = "fit";
  else if (normalizedMethod.includes("fill") || normalizedMethod.includes("crop") || crop === "center") mode = "crop";
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    mode,
    filter,
    fillColor,
    cropPosition
  };
}
function cropRectCanvas(source, x, y, width, height) {
  const out = makeCanvas(Math.max(1, width), Math.max(1, height));
  const octx = out.getContext("2d");
  octx.clearRect(0, 0, out.width, out.height);
  octx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}
function extractMaskDrivenCrop(source, maskCanvas, padding, targetWidth, targetHeight) {
  if (!maskCanvas) return resizeWithMode(source, targetWidth, targetHeight, "bicubic", "crop");
  const fittedMask = fitCanvas(maskCanvas, source.width || 1, source.height || 1);
  const bounds = computeMaskBounds(fittedMask);
  if (!bounds) return resizeWithMode(source, targetWidth, targetHeight, "bicubic", "crop");
  const pad = Math.max(0, Math.round(padding));
  const x = Math.max(0, bounds.x - pad);
  const y = Math.max(0, bounds.y - pad);
  const right = Math.min(source.width, bounds.x + bounds.width + pad);
  const bottom = Math.min(source.height, bounds.y + bounds.height + pad);
  const cropped = cropRectCanvas(source, x, y, Math.max(1, right - x), Math.max(1, bottom - y));
  return resizeWithMode(cropped, targetWidth, targetHeight, "bicubic", "crop");
}
function stitchCanvases(a, b, direction, spacingWidth, spacingColor, matchSize) {
  const normalizedDirection = String(direction || "right").toLowerCase();
  const spacing = Math.max(0, Math.round(spacingWidth));
  const second = matchSize ? resizeWithMode(b, normalizedDirection === "up" || normalizedDirection === "down" ? a.width : b.width, normalizedDirection === "right" || normalizedDirection === "left" ? a.height : b.height, "bicubic", "stretch") : b;
  const horizontal = normalizedDirection === "right" || normalizedDirection === "left";
  const width = horizontal ? a.width + second.width + spacing : Math.max(a.width, second.width);
  const height = horizontal ? Math.max(a.height, second.height) : a.height + second.height + spacing;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d");
  octx.fillStyle = parseHexColor(spacingColor);
  octx.fillRect(0, 0, width, height);
  if (normalizedDirection === "left") {
    octx.drawImage(second, 0, 0);
    octx.drawImage(a, second.width + spacing, 0);
  } else if (normalizedDirection === "up") {
    octx.drawImage(second, 0, 0);
    octx.drawImage(a, 0, second.height + spacing);
  } else if (normalizedDirection === "down") {
    octx.drawImage(a, 0, 0);
    octx.drawImage(second, 0, a.height + spacing);
  } else {
    octx.drawImage(a, 0, 0);
    octx.drawImage(second, a.width + spacing, 0);
  }
  return output;
}
function extractSplitChannelCanvas(source, outputSlot, mode) {
  const normalizedMode = String(mode || "rgba").toLowerCase();
  const channelIndex = Math.max(0, Math.min(3, outputSlot ?? 0));
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  if (normalizedMode === "rgba" || normalizedMode === "rgb") {
    applyChannel(octx, output.width, output.height, channelIndex === 1 ? "Green" : channelIndex === 2 ? "Blue" : channelIndex === 3 ? "Alpha" : "Red");
    return output;
  }
  const img = octx.getImageData(0, 0, output.width, output.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    let value = 0;
    if (normalizedMode === "hsv") {
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      let hue = 0;
      if (delta > 1e-4) {
        if (max === r) hue = (g - b) / delta % 6;
        else if (max === g) hue = (b - r) / delta + 2;
        else hue = (r - g) / delta + 4;
        hue /= 6;
        if (hue < 0) hue += 1;
      }
      const sat = max <= 0 ? 0 : delta / max;
      value = channelIndex === 1 ? sat : channelIndex === 2 ? max : channelIndex === 3 ? data[i + 3] / 255 : hue;
    } else if (normalizedMode === "ycbcr") {
      const y = clamp01(0.299 * r + 0.587 * g + 0.114 * b);
      const cb = clamp01(0.5 + (-0.168736 * r - 0.331264 * g + 0.5 * b));
      const cr = clamp01(0.5 + (0.5 * r - 0.418688 * g - 0.081312 * b));
      value = channelIndex === 1 ? cb : channelIndex === 2 ? cr : channelIndex === 3 ? data[i + 3] / 255 : y;
    } else {
      const l = clamp01(luma01(r, g, b, getOpsConstants().luma_weights));
      value = channelIndex === 1 ? clamp01(0.5 + (r - g) * 0.5) : channelIndex === 2 ? clamp01(0.5 + (b - g) * 0.5) : channelIndex === 3 ? data[i + 3] / 255 : l;
    }
    const channel = Math.round(clamp01(value) * 255);
    data[i] = channel;
    data[i + 1] = channel;
    data[i + 2] = channel;
    data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return output;
}
function mergeChannelInputs(inputs, mode) {
  if (inputs.length < 3) return null;
  const width = inputs[0].width || 1;
  const height = inputs[0].height || 1;
  const channels = inputs.slice(0, 4).map((input) => fitCanvas(input, width, height));
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d");
  const images = channels.map((canvas) => canvas.getContext("2d").getImageData(0, 0, width, height).data);
  const out = octx.createImageData(width, height);
  const data = out.data;
  const normalizedMode = String(mode || "rgba").toLowerCase();
  for (let i = 0; i < data.length; i += 4) {
    const c1 = images[0]?.[i] ?? 0;
    const c2 = images[1]?.[i] ?? 0;
    const c3 = images[2]?.[i] ?? 0;
    const c4 = images[3]?.[i] ?? 255;
    if (normalizedMode === "rgba" || normalizedMode === "rgb") {
      data[i] = c1;
      data[i + 1] = c2;
      data[i + 2] = c3;
      data[i + 3] = images[3] ? c4 : 255;
    } else {
      data[i] = c1;
      data[i + 1] = c2;
      data[i + 2] = c3;
      data[i + 3] = images[3] ? c4 : 255;
    }
  }
  octx.putImageData(out, 0, 0);
  return output;
}
const ops = {
  colorAjust(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyColorCorrectReference(
          effectCtx,
          width,
          height,
          numAny(node, ["temperature"], 0, frameIndex),
          numAny(node, ["hue", "hue_deg"], 0, frameIndex),
          numAny(node, ["brightness"], 0, frameIndex),
          numAny(node, ["contrast"], 0, frameIndex),
          numAny(node, ["saturation", "sat"], 0, frameIndex),
          numAny(node, ["gamma"], 1, frameIndex)
        );
      }),
      { frameIndex }
    );
  },
  colorCorrect(ctx, W, node, inputs = [], frameIndex = 0) {
    return ops.colorAjust(ctx, W, node, inputs, frameIndex);
  },
  blur(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const radius = numAny(node, ["radius", "blur", "blur_radius"], 0, frameIndex);
    const sigma = numAny(node, ["sigma", "radius", "blur"], radius, frameIndex);
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyBlur(effectCtx, width, height, radius, sigma);
      }),
      {
        frameIndex,
        premultBeforeProcess: true,
        processMask: (mask) => applyEffectToCanvas(mask, (effectCtx, width, height) => {
          applyBlur(effectCtx, width, height, radius, sigma);
        })
      }
    );
  },
  channel(ctx, W, node, outputSlot, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const splitMode = strAny(node, ["mode"], "RGBA", frameIndex);
    const hasSingleChannelWidget = !!wAny(node, ["channel"]);
    if (!hasSingleChannelWidget && outputSlot != null) {
      return extractSplitChannelCanvas(source, outputSlot, splitMode);
    }
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red", frameIndex));
      }),
      { frameIndex }
    );
  },
  crop(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => applyCrop(
        effectCtx,
        node,
        width,
        height,
        str(node, "aspect_ratio", "custom", frameIndex),
        num(node, "width", width, frameIndex),
        num(node, "height", height, frameIndex)
      )),
      {
        frameIndex,
        premultBeforeProcess: true,
        processMask: (mask) => applyEffectToCanvas(mask, (effectCtx, width, height) => applyCrop(
          effectCtx,
          node,
          width,
          height,
          str(node, "aspect_ratio", "custom", frameIndex),
          num(node, "width", width, frameIndex),
          num(node, "height", height, frameIndex)
        ))
      }
    );
  },
  padOut(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    return renderPadOutCanvases(node, source, frameIndex).image;
  },
  padOutStitcher(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const { image, mask } = renderPadOutCanvases(node, source, frameIndex, false);
    return markPadOutStitcherCanvas(image, mask);
  },
  padOutStitch(ctx, W, node, inputs = [], frameIndex = 0) {
    return renderPadOutStitchCanvases(node, inputs, frameIndex).image;
  },
  cornerPin(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    return renderCornerPinCanvases(node, source, frameIndex).image;
  },
  cropGeneric(ctx, W, node, inputs = [], inputInfos = []) {
    const source = inputs[0] ?? ctx.canvas;
    const sourceWidth = source.width || 1;
    const sourceHeight = source.height || 1;
    let targetWidth = Math.max(1, Math.round(numAny(node, ["width", "target_width", "base_resolution"], sourceWidth)));
    let targetHeight = Math.max(1, Math.round(numAny(node, ["height", "target_height", "base_resolution"], sourceHeight)));
    const maskInput = inputs[1] ?? null;
    if (maskInput) {
      if (!wAny(node, ["width", "target_width", "height", "target_height"]) && !!w(node, "base_resolution")) {
        const fittedMask = fitCanvas(maskInput, sourceWidth, sourceHeight);
        const bounds = computeMaskBounds(fittedMask);
        if (bounds) {
          const aspect = bounds.width / Math.max(1, bounds.height);
          const baseResolution = Math.max(1, Math.round(numAny(node, ["base_resolution"], Math.max(bounds.width, bounds.height))));
          if (aspect >= 1) {
            targetWidth = baseResolution;
            targetHeight = Math.max(1, Math.round(baseResolution / aspect));
          } else {
            targetHeight = baseResolution;
            targetWidth = Math.max(1, Math.round(baseResolution * aspect));
          }
        }
      }
      return extractMaskDrivenCrop(source, maskInput, numAny(node, ["padding"], 0), targetWidth, targetHeight);
    }
    const cropRegion = w(node, "crop_region")?.value;
    const bboxNode = inputInfos[1]?.upstreamNode ?? null;
    const x = Math.max(0, Math.round(cropRegion?.x ?? numAny(bboxNode ?? node, ["x", "x_offset"], 0)));
    const y = Math.max(0, Math.round(cropRegion?.y ?? numAny(bboxNode ?? node, ["y", "y_offset"], 0)));
    const width = Math.max(1, Math.round(cropRegion?.width ?? numAny(bboxNode ?? node, ["width", "crop_w"], sourceWidth)));
    const height = Math.max(1, Math.round(cropRegion?.height ?? numAny(bboxNode ?? node, ["height", "crop_h"], sourceHeight)));
    return cropRectCanvas(source, x, y, Math.min(width, sourceWidth - x), Math.min(height, sourceHeight - y));
  },
  transform(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const transformImage = (input) => {
      let working = input;
      const mirror = strAny(node, ["mirror"], "none", frameIndex).toLowerCase();
      const flipMethod = strAny(node, ["flip_method"], "", frameIndex);
      const horizontal = mirror === "horizontal" || flipMethod.startsWith("y");
      const vertical = mirror === "vertical" || flipMethod.startsWith("x");
      working = flipCanvas(working, horizontal, vertical);
      const rotationLabel = strAny(node, ["rotation"], "", frameIndex);
      if (rotationLabel.startsWith("90")) working = rotateDiscrete(working, 1);
      else if (rotationLabel.startsWith("180")) working = rotateDiscrete(working, 2);
      else if (rotationLabel.startsWith("270")) working = rotateDiscrete(working, 3);
      const aspectRatio = numAny(node, ["aspect_ratio"], 1, frameIndex);
      if (Math.abs(aspectRatio - 1) > 1e-4) {
        const scaled = makeCanvas(working.width || 1, Math.max(1, Math.round((working.height || 1) * aspectRatio)));
        const sctx = scaled.getContext("2d");
        setResampleMode(sctx, normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear", frameIndex)));
        sctx.drawImage(working, 0, 0, scaled.width, scaled.height);
        working = scaled;
      }
      const tx = numAny(node, ["translate_x", "x", "shift_x"], 0, frameIndex);
      const ty = numAny(node, ["translate_y", "y", "shift_y"], 0, frameIndex);
      const rot = numAny(node, ["rotate_deg", "rotate"], 0, frameIndex);
      const scale = numAny(node, ["scale"], 1, frameIndex);
      const filter = normalizeFilterName(strAny(node, ["filter", "upscale_method", "interpolation", "transform_method"], "bilinear", frameIndex));
      const expand = boolAny(node, ["expand"], false, frameIndex);
      return applyEffectToCanvas(working, (effectCtx, width, height) => {
        return applyTransform(effectCtx, width, height, tx, ty, rot, scale, filter, expand);
      });
    };
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      transformImage,
      {
        frameIndex,
        premultBeforeProcess: true,
        processMask: transformImage
      }
    );
  },
  levels(ctx, W, node, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    applyLevels(
      ctx,
      width,
      height,
      numAny(node, ["in_min", "min"], 0),
      numAny(node, ["in_max", "max"], 1),
      numAny(node, ["gamma", "mid"], 1),
      numAny(node, ["out_min"], 0),
      numAny(node, ["out_max"], 1)
    );
  },
  hueSat(ctx, W, node, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    applyHueSat(
      ctx,
      width,
      height,
      numAny(node, ["hue_deg", "hue"], 0),
      numAny(node, ["saturation", "sat"], 1),
      numAny(node, ["value", "val"], 1)
    );
  },
  invert(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyInvert(effectCtx, width, height, boolAny(node, ["invert_alpha"], false, frameIndex));
      }),
      { frameIndex }
    );
  },
  clamp(ctx, W, node, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0, frameIndex), numAny(node, ["max_v", "max"], 1, frameIndex));
      }),
      { frameIndex }
    );
  },
  sharpen(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyUnsharp(ctx, width, height, numAny(node, ["amount", "strength", "factor"], 1));
  },
  edgeDetect(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyEdgeDetect(ctx, width, height, numAny(node, ["strength"], 1));
  },
  glow(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyGlow(ctx, width, height, numAny(node, ["threshold"], 0.8), numAny(node, ["intensity"], 0.75), Math.round(numAny(node, ["blur_px", "blur", "radius"], 6)));
  },
  cropReformat(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyCropReformat(
      ctx,
      width,
      height,
      numAny(node, ["x"], 0),
      numAny(node, ["y"], 0),
      numAny(node, ["crop_w", "width"], width),
      numAny(node, ["crop_h", "height"], height),
      numAny(node, ["padding"], 0),
      numAny(node, ["out_w", "target_width"], 0),
      numAny(node, ["out_h", "target_height"], 0),
      strAny(node, ["mode", "method"], "fit")
    );
  },
  lumaKey(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyLumaKey(ctx, width, height, numAny(node, ["low"], 0.1), numAny(node, ["high"], 0.9), numAny(node, ["softness"], 0.05));
  },
  merge(ctx, W, node, topCanvasOrInputs, _opts, frameIndex = 0) {
    const inputs = Array.isArray(topCanvasOrInputs) ? topCanvasOrInputs : [ctx.canvas, topCanvasOrInputs];
    const base = inputs[0] ?? ctx.canvas;
    const topCanvas = inputs[1] ?? null;
    if (!topCanvas) return fitCanvas(base, base.width || 1, base.height || 1);
    const mode = strAny(node, ["mode", "blend_mode"], "over", frameIndex);
    const foregroundFit = strAny(node, ["foreground_fit", "fit_mode"], "stretch", frameIndex);
    const blendSpace = strAny(node, ["blend_space", "color_space"], "linear", frameIndex);
    const rawOpacity = w(node, "opacity") ? num(node, "opacity", 100, frameIndex) : numAny(node, ["mix", "factor", "fade_factor", "blend_factor", "start_level", "end_level"], 1, frameIndex);
    const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
    const merged = applyEffectToCanvas(base, (effectCtx, width, height) => {
      blend(effectCtx, width, height, topCanvas, mode, opacity, foregroundFit, blendSpace);
    });
    const effectMask = resolvePreviewMaskCanvas(node, base, inputs[2] ?? null, frameIndex);
    return effectMask ? compositeProcessedWithMask(base, merged, effectMask) : merged;
  },
  resize(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    const resolved = resolveResizeDimensions(node, width, height);
    return resizeWithMode(ctx.canvas, resolved.width, resolved.height, resolved.filter, resolved.mode, resolved.fillColor, resolved.cropPosition);
  },
  pad(ctx, W, node, inputs = []) {
    const source = inputs[0] ?? ctx.canvas;
    const top = Math.max(0, Math.round(numAny(node, ["top"], 0)));
    const bottom = Math.max(0, Math.round(numAny(node, ["bottom"], 0)));
    const left = Math.max(0, Math.round(numAny(node, ["left"], 0)));
    const right = Math.max(0, Math.round(numAny(node, ["right"], 0)));
    const output = makeCanvas((source.width || 1) + left + right, (source.height || 1) + top + bottom);
    const octx = output.getContext("2d");
    octx.fillStyle = parseHexColor(strAny(node, ["color", "background_color", "pad_color", "padding_color"], "#808080"));
    octx.fillRect(0, 0, output.width, output.height);
    octx.drawImage(source, left, top, source.width || 1, source.height || 1);
    return output;
  },
  flipRotate(ctx, W, node) {
    const flipMethod = strAny(node, ["flip_method"], "");
    const horizontal = flipMethod.startsWith("y");
    const vertical = flipMethod.startsWith("x");
    let working = flipCanvas(ctx.canvas, horizontal, vertical);
    const rotation = strAny(node, ["rotation"], "");
    if (rotation.startsWith("90")) working = rotateDiscrete(working, 1);
    else if (rotation.startsWith("180")) working = rotateDiscrete(working, 2);
    else if (rotation.startsWith("270")) working = rotateDiscrete(working, 3);
    return working;
  },
  desaturate(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    const factor = numAny(node, ["factor", "amount"], 1);
    applyDesaturate(ctx, width, height, factor);
  },
  composite(ctx, W, node, inputs) {
    const base = inputs[0] ?? ctx.canvas;
    const topInput = inputs[1] ?? null;
    if (!topInput) return base;
    const rawMask = inputs[2] ?? null;
    const maskInput = rawMask && boolAny(node, ["invert_mask"], false) ? invertMaskCanvas(rawMask) : rawMask;
    const top = premultLayerWithMask(topInput, maskInput);
    const x = Math.round(numAny(node, ["x"], 0) + numAny(node, ["offset_x"], 0));
    const y = Math.round(numAny(node, ["y"], 0) + numAny(node, ["offset_y"], 0));
    const mode = strAny(node, ["mode", "blend_mode"], "over");
    const rawOpacity = w(node, "opacity") ? num(node, "opacity", 100) : numAny(node, ["mix", "factor", "blend_factor", "start_level", "end_level"], 1);
    const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
    return compositeAt(base, top, mode, opacity, x, y, top.width || 1, top.height || 1);
  },
  stitch(ctx, W, node, inputs) {
    const first = inputs[0] ?? ctx.canvas;
    const second = inputs[1] ?? null;
    if (!second) return first;
    return stitchCanvases(
      first,
      second,
      strAny(node, ["direction"], "right"),
      numAny(node, ["spacing_width"], 0),
      strAny(node, ["spacing_color"], "black"),
      boolAny(node, ["match_image_size"], true)
    );
  },
  channelSplit(ctx, W, node, outputSlot) {
    return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
  },
  channelMerge(ctx, W, node, inputs) {
    return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
  },
  channelApply(ctx, W, node, inputs) {
    const base = fitCanvas(inputs[0] ?? ctx.canvas, (inputs[0] ?? ctx.canvas).width || 1, (inputs[0] ?? ctx.canvas).height || 1);
    const mask = inputs[1] ? fitCanvas(inputs[1], base.width, base.height) : null;
    if (!mask) return base;
    const bctx = base.getContext("2d");
    const image = bctx.getImageData(0, 0, base.width, base.height);
    const data = image.data;
    const matte = mask.getContext("2d").getImageData(0, 0, base.width, base.height).data;
    const channel = strAny(node, ["channel"], "A").toLowerCase();
    const channelIndex = channel === "g" || channel === "green" ? 1 : channel === "b" || channel === "blue" ? 2 : channel === "a" || channel === "alpha" ? 3 : 0;
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.round(clamp01(matte[i] / 255 * (matte[i + 3] / 255)) * 255);
      data[i + channelIndex] = value;
    }
    bctx.putImageData(image, 0, 0);
    return base;
  },
  comp(ctx, W, node, inputs) {
    return renderCompPreview(
      node,
      resolveCompPreviewInputs(node, inputs)
    ).canvas;
  },
  distort(ctx, W, node, inputs, frameIndex = 0) {
    return renderDistortCanvas(node, inputs, frameIndex).image;
  },
  noise(ctx, W, node, frameIndex = 0) {
    return renderNoiseCanvas(node, false, frameIndex);
  },
  async draw(ctx, W, node, inputs) {
    return await renderDrawPreview(node, inputs[0] ?? null);
  },
  async drawMask(ctx, W, node, inputs) {
    const base = inputs[0] ?? null;
    const width = base?.width || Math.max(1, Math.round(numAny(node, ["width"], 1024)));
    const height = base?.height || Math.max(1, Math.round(numAny(node, ["height"], 1024)));
    const overlay = await resolveDrawOverlayCanvas(node, width, height);
    return buildMaskAlphaCanvas(overlay, overlay.width || 1, overlay.height || 1);
  },
  imageOpsMask(ctx, W, node, cls, inputs = [], frameIndex = 0) {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const resolvedMask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
    if (cls === "ImageOpsMaskConvert") {
      return boolAny(node, ["reverse"], false, frameIndex) ? imageToMaskPreviewCanvas(source, node, frameIndex) : source;
    }
    if (cls === "ImageOpsNoise") {
      return renderNoiseCanvas(node, true, frameIndex);
    }
    if (cls === "ImageOpsDistort") {
      return renderDistortCanvas(node, inputs, frameIndex).mask;
    }
    if (cls === "ImageOpsBlur") {
      const radius = numAny(node, ["radius", "blur", "blur_radius"], 0, frameIndex);
      const sigma = numAny(node, ["sigma", "radius", "blur"], radius, frameIndex);
      return applyEffectToCanvas(resolvedMask ?? alphaMaskCanvas(source), (effectCtx, width, height) => {
        applyBlur(effectCtx, width, height, radius, sigma);
      });
    }
    if (cls === "ImageOpsTransform") {
      return ops.transform(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
    }
    if (cls === "ImageOpsCrop") {
      return ops.crop(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)], frameIndex);
    }
    if (cls === "ImageOpsPadOut") {
      return renderPadOutCanvases(node, source, frameIndex).mask;
    }
    if (cls === "ImageOpsPadOutStitch") {
      return renderPadOutStitchCanvases(node, inputs, frameIndex).mask;
    }
    if (cls === "ImageOpsCornerPin") {
      return renderCornerPinCanvases(node, source, frameIndex).mask;
    }
    if (cls === "ImageOpsChannel") {
      const extracted = applyEffectToCanvas(source, (effectCtx, width, height) => {
        applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red", frameIndex));
      });
      return resolvedMask ? premultLayerWithMask(extracted, resolvedMask) : extracted;
    }
    if (cls === "ImageOpsClamp") {
      if (!resolvedMask) return alphaMaskCanvas(source);
      return applyEffectToCanvas(resolvedMask, (effectCtx, width, height) => {
        applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0, frameIndex), numAny(node, ["max_v", "max"], 1, frameIndex));
      });
    }
    if (cls === "ImageOpsInvert") {
      let mask = resolvedMask ?? alphaMaskCanvas(source);
      if (!resolvedMask && boolAny(node, ["invert_alpha"], false, frameIndex)) {
        mask = invertMaskCanvas(mask);
      }
      return mask;
    }
    if (cls === "ImageOpsMerge") {
      if (resolvedMask) return resolvedMask;
      const merged = ops.merge(ctx, W, node, inputs, void 0, frameIndex);
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
};
export {
  ops,
  renderCompPreview,
  renderDrawNodePreview
};
