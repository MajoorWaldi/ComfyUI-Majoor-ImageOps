// Shared ops implementation for live preview (v6)
// IMPORTANT: this module is the single place implementing preview ops. Nodes must not duplicate preview code.
import type { ComfyNode, ComfyWidget, RenderInputInfo } from "../types.js";
import { getOpsConstants, initOpsConstants } from "./constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "./crop.js";
import { computeCompRect, getCompSlots, syncCompLayers } from "./comp.js";
import { renderDrawPreview, resolveDrawOverlayCanvas } from "./draw.js";

initOpsConstants();

function w(node: ComfyNode, name: string): ComfyWidget | null {
  return node?.widgets?.find((x: ComfyWidget) => x?.name === name) ?? null;
}
function widgetScalarValue(value: unknown, index: number = 0): unknown {
  let current = value;
  while (Array.isArray(current) && current.length > 0) {
    const resolvedIndex = Math.max(0, Math.min(current.length - 1, index));
    current = current[resolvedIndex];
  }
  return current;
}
function num(node: ComfyNode, name: string, fallback: number = 0, index: number = 0): number {
  const v = widgetScalarValue(w(node, name)?.value, index);
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
}
function str(node: ComfyNode, name: string, fallback: string = "", index: number = 0): string {
  const v = widgetScalarValue(w(node, name)?.value, index);
  return typeof v === "string" ? v : fallback;
}
function bool(node: ComfyNode, name: string, fallback: boolean = false, index: number = 0): boolean {
  const v = widgetScalarValue(w(node, name)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function wAny(node: ComfyNode, names: string[]): ComfyWidget | null {
  for (const name of names) {
    const found = w(node, name);
    if (found) return found;
  }
  return null;
}
function numAny(node: ComfyNode, names: string[], fallback: number = 0, index: number = 0): number {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
}
function strAny(node: ComfyNode, names: string[], fallback: string = "", index: number = 0): string {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  return typeof v === "string" ? v : fallback;
}
function boolAny(node: ComfyNode, names: string[], fallback: boolean = false, index: number = 0): boolean {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
function luma01(r: number, g: number, b: number, lw: number[]): number { return lw[0]*r + lw[1]*g + lw[2]*b; }

function getImageData(ctx: CanvasRenderingContext2D, W: number, H: number): ImageData { return ctx.getImageData(0,0,W,H); }
function putImageData(ctx: CanvasRenderingContext2D, img: ImageData): void { ctx.putImageData(img,0,0); }
function getCanvasDimensions(ctx: CanvasRenderingContext2D): { width: number; height: number } {
  return {
    width: Math.max(1, ctx.canvas.width || 1),
    height: Math.max(1, ctx.canvas.height || 1),
  };
}
function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

function normalizeFilterName(filter: string): string {
  const value = String(filter || "bilinear").toLowerCase();
  if (value === "nearest") return "nearest-exact";
  if (value === "linear") return "bilinear";
  if (value === "cubic") return "bicubic";
  return value;
}

function parseHexColor(value: string): string {
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

function imageLikeInputName(name: string): boolean {
  return /image|images|source|destination|background|foreground|layer|red|green|blue|channel|input/i.test(name);
}

function getPreferredInputIndexes(node: ComfyNode): number[] {
  const indexes: number[] = [];
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

function resizeWithMode(
  source: HTMLCanvasElement,
  width: number,
  height: number,
  filter: string,
  mode: string,
  fillColor: string = "#000000",
  cropPosition: string = "center",
): HTMLCanvasElement {
  const targetWidth = Math.max(1, Math.round(width));
  const targetHeight = Math.max(1, Math.round(height));
  const output = makeCanvas(targetWidth, targetHeight);
  const octx = output.getContext("2d")!;
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

  if (
    normalizedMode === "stretch" ||
    normalizedMode === "disabled" ||
    normalizedMode === "scale dimensions"
  ) {
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

function fitCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d")!;
  setResampleMode(octx, "bicubic");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  return output;
}

function flipCanvas(source: HTMLCanvasElement, horizontal: boolean, vertical: boolean): HTMLCanvasElement {
  if (!horizontal && !vertical) return source;
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d")!;
  octx.save();
  octx.translate(horizontal ? output.width : 0, vertical ? output.height : 0);
  octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  octx.drawImage(source, 0, 0, output.width, output.height);
  octx.restore();
  return output;
}

function rotateDiscrete(source: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return source;
  const swap = turns % 2 === 1;
  const output = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const octx = output.getContext("2d")!;
  octx.translate(output.width / 2, output.height / 2);
  octx.rotate(turns * Math.PI / 2);
  octx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
}

function toMaskCanvas(input: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  return buildMaskAlphaCanvas(input, width, height);
}

function computeMaskBounds(maskCanvas: HTMLCanvasElement): { x: number; y: number; width: number; height: number } | null {
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

function compositeAt(
  base: HTMLCanvasElement,
  top: HTMLCanvasElement,
  mode: string,
  opacity: number,
  x: number,
  y: number,
  width: number,
  height: number,
): HTMLCanvasElement {
  const output = makeCanvas(base.width || 1, base.height || 1);
  const octx = output.getContext("2d")!;
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

function compModeToCanvasOp(mode: string): GlobalCompositeOperation {
  const normalized = String(mode || "over").toLowerCase();
  if (normalized === "add") return "lighter";
  if (normalized === "multiply") return "multiply";
  if (normalized === "screen") return "screen";
  if (normalized === "overlay") return "overlay";
  if (normalized === "soft_light") return "soft-light";
  if (normalized === "difference") return "difference";
  if (normalized === "lighten") return "lighten";
  if (normalized === "darken") return "darken";
  return "source-over";
}

function hexToRgb01(value: string): [number, number, number] {
  const hex = parseHexColor(value);
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

function noiseFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function noiseLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function noiseHash2D(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function sampleWhiteNoise(x: number, y: number, seed: number): number {
  return noiseHash2D(Math.floor(x), Math.floor(y), seed) * 2 - 1;
}

function sampleValueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const u = noiseFade(tx);
  const v = noiseFade(ty);

  const v00 = noiseHash2D(x0, y0, seed) * 2 - 1;
  const v10 = noiseHash2D(x1, y0, seed) * 2 - 1;
  const v01 = noiseHash2D(x0, y1, seed) * 2 - 1;
  const v11 = noiseHash2D(x1, y1, seed) * 2 - 1;
  return noiseLerp(noiseLerp(v00, v10, u), noiseLerp(v01, v11, u), v);
}

function gradientDot(ix: number, iy: number, x: number, y: number, seed: number): number {
  const angle = noiseHash2D(ix, iy, seed) * Math.PI * 2;
  return Math.cos(angle) * (x - ix) + Math.sin(angle) * (y - iy);
}

function samplePerlinNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const u = noiseFade(tx);
  const v = noiseFade(ty);

  const n00 = gradientDot(x0, y0, x, y, seed);
  const n10 = gradientDot(x1, y0, x, y, seed);
  const n01 = gradientDot(x0, y1, x, y, seed);
  const n11 = gradientDot(x1, y1, x, y, seed);
  return Math.max(-1, Math.min(1, noiseLerp(noiseLerp(n00, n10, u), noiseLerp(n01, n11, u), v) * Math.SQRT2));
}

function sampleNoiseBasis(basis: string, sampleX: number, sampleY: number, rawX: number, rawY: number, seed: number): number {
  const normalized = String(basis || "perlin").toLowerCase();
  if (normalized === "value") return sampleValueNoise(sampleX, sampleY, seed);
  if (normalized === "white") return sampleWhiteNoise(rawX, rawY, seed);
  return samplePerlinNoise(sampleX, sampleY, seed);
}

function buildNoiseField(
  width: number,
  height: number,
  options: {
    basis: string;
    fractalMode: string;
    seed: number;
    seedStep?: number;
    scale: number;
    octaves: number;
    lacunarity: number;
    gain: number;
    offsetX: number;
    offsetY: number;
    frameOffsetX?: number;
    frameOffsetY?: number;
    contrast: number;
    invert: boolean;
    frameIndex?: number;
  },
): Float32Array {
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
        const signed = sampleNoiseBasis(basis, rawX / scale, rawY / scale, rawX, rawY, seed);
        gray = clamp01(signed * 0.5 + 0.5);
      } else {
        let total = 0;
        let amplitude = 1;
        let amplitudeSum = 0;
        let currentScale = scale;

        for (let octave = 0; octave < octaves; octave++) {
          const octaveSeed = seed + octave * 10007;
          const signed = sampleNoiseBasis(basis, rawX / currentScale, rawY / currentScale, rawX, rawY, octaveSeed);
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
    let gray = grayRange > 1.0e-6 ? (grayValues[index] - minGray) / grayRange : 0;
    gray = clamp01((gray - 0.5) * contrast + 0.5);
    if (invert) gray = 1 - gray;
    grayValues[index] = gray;
  }

  return grayValues;
}

function renderNoiseFieldCanvas(
  width: number,
  height: number,
  grayValues: Float32Array,
  low: [number, number, number],
  high: [number, number, number],
  maskOnly: boolean = false,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d")!;
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

function renderNoiseCanvas(node: ComfyNode, maskOnly: boolean = false, frameIndex: number = 0): HTMLCanvasElement {
  const width = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const height = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  const batchSize = Math.max(1, Math.round(numAny(node, ["batch_size"], 1)));
  const resolvedFrameIndex = ((Math.max(0, Math.round(frameIndex)) % batchSize) + batchSize) % batchSize;
  const low = hexToRgb01(strAny(node, ["low_color"], "#000000"));
  const high = hexToRgb01(strAny(node, ["high_color"], "#ffffff"));
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
    frameOffsetX: numAny(node, ["frame_offset_x"], 0, resolvedFrameIndex),
    frameOffsetY: numAny(node, ["frame_offset_y"], 0, resolvedFrameIndex),
    contrast: numAny(node, ["contrast"], 1, resolvedFrameIndex),
    invert: boolAny(node, ["invert"], false, resolvedFrameIndex),
    frameIndex: resolvedFrameIndex,
  });

  return renderNoiseFieldCanvas(width, height, grayValues, low, high, maskOnly);
}

function distortConnectedInputs(
  node: ComfyNode,
  inputs: HTMLCanvasElement[],
): { source: HTMLCanvasElement; displacement: HTMLCanvasElement | null; mask: HTMLCanvasElement | null } {
  const source = inputs[0];
  const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
  const maskConnected = (node.inputs?.[2]?.link ?? null) != null;
  let cursor = 1;
  const displacement = displacementConnected ? (inputs[cursor++] ?? null) : null;
  const mask = maskConnected ? (inputs[cursor] ?? null) : null;
  return { source, displacement, mask };
}

function extractCanvasField(canvas: HTMLCanvasElement, width: number, height: number, channel: string): Float32Array {
  const fitted = fitCanvas(canvas, width, height);
  const data = fitted.getContext("2d")!.getImageData(0, 0, width, height).data;
  const field = new Float32Array(width * height);
  const normalized = String(channel || "red").toLowerCase();
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
  return field;
}

function neutralField(width: number, height: number, centered: boolean): Float32Array {
  const field = new Float32Array(width * height);
  field.fill(centered ? 0.5 : 0);
  return field;
}

function reflectCoordinate(value: number, size: number): number {
  if (size <= 1) return 0;
  let coord = value;
  const max = size - 1;
  while (coord < 0 || coord > max) {
    if (coord < 0) coord = -coord;
    if (coord > max) coord = max - (coord - max);
  }
  return coord;
}

function sampleChannel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, edgeMode: string): [number, number, number, number] {
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

function bilinearSample(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, edgeMode: string): [number, number, number, number] {
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
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = noiseLerp(c00[c], c10[c], tx);
    const bottom = noiseLerp(c01[c], c11[c], tx);
    out[c] = noiseLerp(top, bottom, ty);
  }
  return out;
}

function renderDistortCanvas(
  node: ComfyNode,
  inputs: HTMLCanvasElement[],
  frameIndex: number = 0,
): { image: HTMLCanvasElement; mask: HTMLCanvasElement | null } {
  const { source, displacement, mask: rawMask } = distortConnectedInputs(node, inputs);
  const width = source.width || 1;
  const height = source.height || 1;
  const mapSource = strAny(node, ["map_source"], "source_channel", frameIndex).toLowerCase();
  const centeredMap = boolAny(node, ["centered_map"], true, frameIndex);
  const invertMap = boolAny(node, ["invert_map"], false, frameIndex);
  const effectMask = mapSource === "mask" ? null : resolvePreviewMaskCanvas(node, source, rawMask);
  let previewMask: HTMLCanvasElement | null = null;

  let xField: Float32Array;
  let yField: Float32Array;
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
    xField = extractCanvasField(driver, width, height, strAny(node, ["x_channel"], "Red", frameIndex));
    yField = extractCanvasField(driver, width, height, strAny(node, ["y_channel"], "Green", frameIndex));
  }

  const sourceCanvas = fitCanvas(source, width, height);
  const sourceCtx = sourceCanvas.getContext("2d")!;
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const output = makeCanvas(width, height);
  const outCtx = output.getContext("2d")!;
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
      const rgba = useNearest
        ? sampleChannel(sourceData.data, width, height, Math.round(sampleX), Math.round(sampleY), edgeMode)
        : bilinearSample(sourceData.data, width, height, sampleX, sampleY, edgeMode);
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

function setResampleMode(ctx: CanvasRenderingContext2D, filter: string): void {
  const mode = String(filter || "bilinear").toLowerCase();
  ctx.imageSmoothingEnabled = mode !== "nearest";
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
  }
}
function rotatedBounds(width: number, height: number, radians: number): { width: number; height: number } {
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.ceil(width * cos + height * sin)),
    height: Math.max(1, Math.ceil(width * sin + height * cos)),
  };
}

function applyLevels(ctx: CanvasRenderingContext2D, W: number, H: number, inMin: number, inMax: number, gamma: number, outMin: number, outMax: number): void {
  const { epsilon: EPS, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx,W,H);
  const d = img.data;
  const ig = 1/Math.max(GE,gamma);
  for (let i=0;i<d.length;i+=4){
    for (let c=0;c<3;c++){
      let v = d[i+c]/255;
      v = (v - inMin) / Math.max(EPS,(inMax - inMin));
      v = clamp01(v);
      v = Math.pow(v, ig);
      v = outMin + v*(outMax - outMin);
      d[i+c] = Math.round(clamp01(v)*255);
    }
  }
  putImageData(ctx,img);
}

function applyHueSat(ctx: CanvasRenderingContext2D, W: number, H: number, hueDeg: number, sat: number, val: number): void {
  const { epsilon: EPS } = getOpsConstants();
  const img = getImageData(ctx,W,H);
  const d = img.data;
  const hue = (hueDeg % 360) * Math.PI/180;
  for (let i=0;i<d.length;i+=4){
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b);
    const delta=max-min;
    let h0=0;
    if (delta>EPS){
      if (max===r) h0=((g-b)/delta)%6;
      else if (max===g) h0=(b-r)/delta+2;
      else h0=(r-g)/delta+4;
      h0 *= Math.PI/3;
    }
    let s0 = max===0?0:delta/max;
    let v0 = max;

    h0 += hue;
    s0 = clamp01(s0*sat);
    v0 = clamp01(v0*val);

    const c=v0*s0;
    const x=c*(1-Math.abs(((h0/(Math.PI/3))%2)-1));
    const m=v0-c;
    let rp=0,gp=0,bp=0;
    const hh=((h0%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    const sector=Math.floor(hh/(Math.PI/3));
    switch(sector){
      case 0: rp=c; gp=x; bp=0; break;
      case 1: rp=x; gp=c; bp=0; break;
      case 2: rp=0; gp=c; bp=x; break;
      case 3: rp=0; gp=x; bp=c; break;
      case 4: rp=x; gp=0; bp=c; break;
      case 5: rp=c; gp=0; bp=x; break;
    }
    d[i]=Math.round(clamp01(rp+m)*255);
    d[i+1]=Math.round(clamp01(gp+m)*255);
    d[i+2]=Math.round(clamp01(bp+m)*255);
  }
  putImageData(ctx,img);
}

function applyInvert(ctx: CanvasRenderingContext2D, W: number, H: number, invertAlpha: boolean = false): void {
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    d[i]=255-d[i];
    d[i+1]=255-d[i+1];
    d[i+2]=255-d[i+2];
    if (invertAlpha) d[i+3]=255-d[i+3];
  }
  putImageData(ctx,img);
}

function applyClamp(ctx: CanvasRenderingContext2D, W: number, H: number, minV: number, maxV: number): void {
  const lo = Math.min(minV, maxV);
  const hi = Math.max(minV, maxV);
  const mn=Math.round(clamp01(lo)*255);
  const mx=Math.round(clamp01(hi)*255);
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    d[i]=Math.max(mn,Math.min(mx,d[i]));
    d[i+1]=Math.max(mn,Math.min(mx,d[i+1]));
    d[i+2]=Math.max(mn,Math.min(mx,d[i+2]));
    d[i+3]=Math.max(mn,Math.min(mx,d[i+3]));
  }
  putImageData(ctx,img);
}

function applyColorCorrect(ctx: CanvasRenderingContext2D, W: number, H: number, brightness: number, contrast: number, gamma: number, saturation: number): void {
  const { luma_weights: LW, gamma_safe_min: GMIN, gamma_max: GMAX, preview_gamma_epsilon: GE } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  const g = Math.max(GMIN, Math.min(GMAX, gamma));
  const invGamma=1/Math.max(GE,g);

  for (let i=0;i<d.length;i+=4){
    let r=d[i]/255,gr=d[i+1]/255,b=d[i+2]/255;
    r += brightness; gr += brightness; b += brightness;
    r = (r-0.5)*contrast+0.5;
    gr = (gr-0.5)*contrast+0.5;
    b = (b-0.5)*contrast+0.5;
    r=clamp01(r); gr=clamp01(gr); b=clamp01(b);
    r=Math.pow(r,invGamma);
    gr=Math.pow(gr,invGamma);
    b=Math.pow(b,invGamma);

    const l=luma01(r,gr,b,LW);
    r = l + (r-l)*saturation;
    gr = l + (gr-l)*saturation;
    b = l + (b-l)*saturation;

    d[i]=Math.round(clamp01(r)*255);
    d[i+1]=Math.round(clamp01(gr)*255);
    d[i+2]=Math.round(clamp01(b)*255);
  }
  putImageData(ctx,img);
}

function applyColorCorrectReference(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  temperature: number,
  hue: number,
  brightness: number,
  contrast: number,
  saturation: number,
  gamma: number,
): void {
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
    const r = clamp01((d[i] / 255) * brightnessFactor);
    const g = clamp01((d[i + 1] / 255) * brightnessFactor);
    const b = clamp01((d[i + 2] / 255) * brightnessFactor);
    meanLuma += luma01(r, g, b, LW);
  }
  meanLuma /= pixelCount;

  for (let i = 0; i < d.length; i += 4) {
    let r = clamp01((d[i] / 255) * brightnessFactor);
    let g = clamp01((d[i + 1] / 255) * brightnessFactor);
    let b = clamp01((d[i + 2] / 255) * brightnessFactor);

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

function applyUnsharp(ctx: CanvasRenderingContext2D, W: number, H: number, amount: number = 1.0): void {
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d")!;
  tctx.filter="blur(2px)";
  tctx.drawImage(ctx.canvas,0,0);
  tctx.filter="none";
  const o=getImageData(ctx,W,H);
  const b=tctx.getImageData(0,0,W,H);
  const d=o.data, bd=b.data;
  const a=Math.max(0,amount);
  for (let i=0;i<d.length;i+=4){
    d[i]=Math.max(0,Math.min(255,d[i]+a*(d[i]-bd[i])));
    d[i+1]=Math.max(0,Math.min(255,d[i+1]+a*(d[i+1]-bd[i+1])));
    d[i+2]=Math.max(0,Math.min(255,d[i+2]+a*(d[i+2]-bd[i+2])));
  }
  putImageData(ctx,o);
}

function applyEdgeDetect(ctx: CanvasRenderingContext2D, W: number, H: number, strength: number = 1.0): void {
  const { luma_weights: LW } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  const gr=new Float32Array(W*H);
  for (let y=0;y<H;y++){
    for (let x=0;x<W;x++){
      const i=(y*W+x)*4;
      gr[y*W+x]=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    }
  }
  const out=new Uint8ClampedArray(d.length);
  const k=strength;
  for (let y=1;y<H-1;y++){
    for (let x=1;x<W-1;x++){
      const gx = -1*gr[(y-1)*W+(x-1)] + 1*gr[(y-1)*W+(x+1)] +
                 -2*gr[(y)*W+(x-1)]   + 2*gr[(y)*W+(x+1)]   +
                 -1*gr[(y+1)*W+(x-1)] + 1*gr[(y+1)*W+(x+1)];
      const gy = -1*gr[(y-1)*W+(x-1)] + -2*gr[(y-1)*W+(x)] + -1*gr[(y-1)*W+(x+1)] +
                  1*gr[(y+1)*W+(x-1)] +  2*gr[(y+1)*W+(x)] +  1*gr[(y+1)*W+(x+1)];
      const mag = clamp01(Math.sqrt(gx*gx+gy*gy)*k);
      const v=Math.round(mag*255);
      const i=(y*W+x)*4;
      out[i]=v; out[i+1]=v; out[i+2]=v; out[i+3]=255;
    }
  }
  img.data.set(out);
  putImageData(ctx,img);
}

function applyBlur(ctx: CanvasRenderingContext2D, W: number, H: number, radiusPx: number, sigmaPx: number): void {
  const blurPx = Math.max(0, Math.max(radiusPx, sigmaPx));
  if (blurPx <= 0) return;
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d")!;
  tctx.filter=`blur(${blurPx}px)`;
  tctx.drawImage(ctx.canvas,0,0);
  tctx.filter="none";
  ctx.clearRect(0,0,W,H);
  ctx.drawImage(tmp,0,0);
}

function applyChannel(ctx: CanvasRenderingContext2D, W: number, H: number, channel: string): void {
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

function applyDesaturate(ctx: CanvasRenderingContext2D, W: number, H: number, factor: number = 1): void {
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

function applyTransform(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  tx: number,
  ty: number,
  rotDeg: number,
  scale: number,
  filter: string,
  expand: boolean,
): HTMLCanvasElement | void {
  const safeScale = Math.max(0.01, scale || 1);
  const rad = rotDeg * Math.PI / 180;
  const needsScale = Math.abs(safeScale - 1) > 0.0001;
  const needsRotate = Math.abs(rotDeg) > 0.0001;
  const needsTranslate = tx !== 0 || ty !== 0;
  if (!needsScale && !needsRotate && !needsTranslate) return;

  let working = makeCanvas(needsScale ? Math.round(W * safeScale) : W, needsScale ? Math.round(H * safeScale) : H);
  let wctx = working.getContext("2d")!;
  setResampleMode(wctx, filter);
  wctx.clearRect(0, 0, working.width, working.height);
  wctx.drawImage(ctx.canvas, 0, 0, working.width, working.height);

  if (needsRotate) {
    const bounds = expand ? rotatedBounds(working.width, working.height, rad) : { width: working.width, height: working.height };
    const rotated = makeCanvas(bounds.width, bounds.height);
    const rctx = rotated.getContext("2d")!;
    setResampleMode(rctx, filter);
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate(rad);
    rctx.drawImage(working, -working.width / 2, -working.height / 2);
    working = rotated;
    wctx = rctx;
  }

  const output = makeCanvas(W, H);
  const octx = output.getContext("2d")!;
  setResampleMode(octx, filter);
  octx.clearRect(0, 0, W, H);
  const drawX = Math.round((W - working.width) / 2 + (needsTranslate ? tx : 0));
  const drawY = Math.round((H - working.height) / 2 + (needsTranslate ? ty : 0));
  octx.drawImage(working, drawX, drawY);
  return output;
}

function applyGlow(ctx: CanvasRenderingContext2D, W: number, H: number, threshold: number, intensity: number, blurPx: number): void {
  const { luma_weights: LW } = getOpsConstants();
  const base=getImageData(ctx,W,H);
  const d=base.data;
  const hi=new Uint8ClampedArray(d.length);
  for (let i=0;i<d.length;i+=4){
    const l=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    if (l>=threshold){
      hi[i]=d[i]; hi[i+1]=d[i+1]; hi[i+2]=d[i+2]; hi[i+3]=d[i+3];
    }
  }
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d")!;
  tctx.putImageData(new ImageData(hi,W,H),0,0);

  const blur=document.createElement("canvas");
  blur.width=W; blur.height=H;
  const bctx=blur.getContext("2d")!;
  bctx.filter=`blur(${Math.max(0,blurPx)}px)`;
  bctx.drawImage(tmp,0,0);
  bctx.filter="none";

  ctx.save();
  ctx.globalAlpha=Math.max(0,Math.min(1,intensity));
  ctx.globalCompositeOperation="lighter";
  ctx.drawImage(blur,0,0);
  ctx.restore();
}

function applyCropReformat(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, cw: number, ch: number, padding: number, outW: number, outH: number, mode: string): void {
  const cropW=Math.max(1,Math.round(cw));
  const cropH=Math.max(1,Math.round(ch));
  const pad=Math.max(0,Math.round(padding));

  const tmp=document.createElement("canvas");
  tmp.width=cropW+pad*2;
  tmp.height=cropH+pad*2;
  const tctx=tmp.getContext("2d")!;
  tctx.clearRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(ctx.canvas, -Math.round(x)+pad, -Math.round(y)+pad);

  const finalW=outW>0?Math.round(outW):tmp.width;
  const finalH=outH>0?Math.round(outH):tmp.height;

  const dst=document.createElement("canvas");
  dst.width=finalW;
  dst.height=finalH;
  const dctx=dst.getContext("2d")!;
  dctx.clearRect(0,0,finalW,finalH);

  if (mode==="stretch"){
    dctx.drawImage(tmp,0,0,finalW,finalH);
  } else {
    const s=(mode==="fill") ? Math.max(finalW/tmp.width, finalH/tmp.height) : Math.min(finalW/tmp.width, finalH/tmp.height);
    const dw=Math.floor(tmp.width*s);
    const dh=Math.floor(tmp.height*s);
    const dx=Math.floor((finalW-dw)/2);
    const dy=Math.floor((finalH-dh)/2);
    dctx.drawImage(tmp,dx,dy,dw,dh);
  }

  ctx.clearRect(0,0,W,H);
  ctx.drawImage(dst,0,0,W,H);
}

function applyCrop(
  ctx: CanvasRenderingContext2D,
  node: ComfyNode,
  sourceWidth: number,
  sourceHeight: number,
  aspectRatio: string,
  outW: number,
  outH: number,
): HTMLCanvasElement {
  const finalW = Math.max(1, Math.round(outW));
  const finalH = Math.max(1, Math.round(outH));
  const ratio = resolveCropAspectRatio(aspectRatio, finalW, finalH);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    ratio,
    clampCropCenter(num(node, "crop_center_x", 0.5)),
    clampCropCenter(num(node, "crop_center_y", 0.5)),
    clampCropScale(num(node, "crop_scale", 1)),
  );
  const output = makeCanvas(finalW, finalH);
  const octx = output.getContext("2d")!;
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
    finalH,
  );
  return output;
}

function buildMaskAlphaCanvas(maskCanvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d")!;
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
  return output;
}

function alphaMaskCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d")!;
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
  return output;
}

function applyEffectToCanvas(
  source: HTMLCanvasElement,
  effect: (ctx: CanvasRenderingContext2D, width: number, height: number) => HTMLCanvasElement | void,
): HTMLCanvasElement {
  const output = fitCanvas(source, source.width || 1, source.height || 1);
  const octx = output.getContext("2d")!;
  const result = effect(octx, output.width, output.height);
  return result instanceof HTMLCanvasElement ? result : output;
}

function resolvePreviewMaskCanvas(
  node: ComfyNode,
  source: HTMLCanvasElement,
  rawMask: HTMLCanvasElement | null,
): HTMLCanvasElement | null {
  if (!rawMask) return null;
  const matte = buildMaskAlphaCanvas(rawMask, source.width || 1, source.height || 1);
  return boolAny(node, ["invert_mask"], false) ? invertMaskCanvas(matte) : matte;
}

function compositeProcessedWithMask(
  baseCanvas: HTMLCanvasElement,
  processedCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null,
): HTMLCanvasElement {
  if (!maskCanvas) return fitCanvas(processedCanvas, processedCanvas.width || 1, processedCanvas.height || 1);
  const output = fitCanvas(baseCanvas, processedCanvas.width || 1, processedCanvas.height || 1);
  const octx = output.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(
    premultLayerWithMask(processedCanvas, fitCanvas(maskCanvas, output.width, output.height)),
    0,
    0,
    output.width,
    output.height,
  );
  return output;
}

function renderMaskedEffectPreview(
  node: ComfyNode,
  source: HTMLCanvasElement,
  rawMask: HTMLCanvasElement | null,
  processImage: (input: HTMLCanvasElement) => HTMLCanvasElement,
  options: {
    premultBeforeProcess?: boolean;
    processMask?: ((mask: HTMLCanvasElement) => HTMLCanvasElement) | null;
    baseCanvas?: HTMLCanvasElement | null;
  } = {},
): HTMLCanvasElement {
  const mask = resolvePreviewMaskCanvas(node, source, rawMask);
  if (!mask) return processImage(source);
  const processed = processImage(options.premultBeforeProcess ? premultLayerWithMask(source, mask) : source);
  const processedMask = options.processMask
    ? options.processMask(mask)
    : fitCanvas(mask, processed.width || 1, processed.height || 1);
  return compositeProcessedWithMask(options.baseCanvas ?? source, processed, processedMask);
}

function premultLayerWithMask(imageCanvas: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null): HTMLCanvasElement {
  if (!maskCanvas) return imageCanvas;
  const output = makeCanvas(imageCanvas.width || 1, imageCanvas.height || 1);
  const octx = output.getContext("2d")!;
  octx.clearRect(0, 0, output.width, output.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(imageCanvas, 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(buildMaskAlphaCanvas(maskCanvas, output.width, output.height), 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "source-over";
  return output;
}

function invertMaskCanvas(maskCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const output = makeCanvas(maskCanvas.width || 1, maskCanvas.height || 1);
  const octx = output.getContext("2d")!;
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
  return output;
}

export function renderCompPreview(
  node: ComfyNode,
  inputLayers: Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number }>,
): {
  canvas: HTMLCanvasElement;
  layers: Array<{
    slot: string;
    layerNumber: number;
    inputIndex: number;
    sourceWidth: number;
    sourceHeight: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
} {
  const slots = getCompSlots(node);
  const allLayers = syncCompLayers(str(node, "layers_json", ""), slots);
  const layerBySlot = new Map(allLayers.map((layer) => [layer.slot, layer]));
  const firstInput = inputLayers[0]?.image ?? null;
  const useFirst = bool(node, "use_first_layer_size", true);
  const outputWidth = useFirst && firstInput ? Math.max(1, firstInput.width) : Math.max(1, Math.round(num(node, "width", firstInput?.width ?? 1024)));
  const outputHeight = useFirst && firstInput ? Math.max(1, firstInput.height) : Math.max(1, Math.round(num(node, "height", firstInput?.height ?? 1024)));
  const output = makeCanvas(outputWidth, outputHeight);
  const octx = output.getContext("2d")!;
  octx.clearRect(0, 0, outputWidth, outputHeight);

  const geometries: Array<{
    slot: string;
    layerNumber: number;
    inputIndex: number;
    sourceWidth: number;
    sourceHeight: number;
    left: number;
    top: number;
    width: number;
    height: number;
  }> = [];

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
    });

    octx.save();
    octx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    octx.globalCompositeOperation = compModeToCanvasOp(layer.mode);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(input, rect.left, rect.top, rect.width, rect.height);
    octx.restore();
  }

  return { canvas: output, layers: geometries };
}

export async function renderDrawNodePreview(node: ComfyNode, baseCanvas: HTMLCanvasElement | null = null): Promise<HTMLCanvasElement> {
  return await renderDrawPreview(node, baseCanvas);
}

function applyLumaKey(ctx: CanvasRenderingContext2D, W: number, H: number, low: number, high: number, softness: number): void {
  const { epsilon: EPS, luma_weights: LW } = getOpsConstants();
  const img=getImageData(ctx,W,H);
  const d=img.data;
  for (let i=0;i<d.length;i+=4){
    const l=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    let a=0;
    if (l<=low) a=0;
    else if (l>=high) a=1;
    else {
      const t=(l-low)/Math.max(EPS,(high-low));
      const s=Math.max(0,Math.min(1,softness*10));
      a = t*(1-s) + (t*t*(3-2*t))*s;
    }
    d[i+3]=Math.round(clamp01(a)*255);
  }
  putImageData(ctx,img);
}

function blend(ctx: CanvasRenderingContext2D, W: number, H: number, topCanvas: HTMLCanvasElement, mode: string, mix: number): void {
  const m=Math.max(0,Math.min(1,mix));
  if (m<=0) return;
  const scaledTop = makeCanvas(W, H);
  const sctx = scaledTop.getContext("2d")!;
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(topCanvas, 0, 0, W, H);

  const base = getImageData(ctx, W, H);
  const top = sctx.getImageData(0, 0, W, H);
  const bd = base.data;
  const td = top.data;
  const normalizedMode = String(mode || "over").toLowerCase();
  const blendMode = normalizedMode === "normal" ? "over" : normalizedMode;

  for (let i = 0; i < bd.length; i += 4) {
    const ar = bd[i] / 255;
    const ag = bd[i + 1] / 255;
    const ab = bd[i + 2] / 255;
    const aa = bd[i + 3] / 255;

    const br = td[i] / 255;
    const bg = td[i + 1] / 255;
    const bb = td[i + 2] / 255;
    const ba = td[i + 3] / 255;

    let rr = br;
    let rg = bg;
    let rb = bb;

    if (blendMode === "over") {
      rr = br * ba + ar * (1 - ba);
      rg = bg * ba + ag * (1 - ba);
      rb = bb * ba + ab * (1 - ba);
    } else if (blendMode === "add") {
      rr = ar + br;
      rg = ag + bg;
      rb = ab + bb;
    } else if (blendMode === "subtract") {
      rr = ar - br;
      rg = ag - bg;
      rb = ab - bb;
    } else if (blendMode === "multiply") {
      rr = ar * br;
      rg = ag * bg;
      rb = ab * bb;
    } else if (blendMode === "screen") {
      rr = 1 - (1 - ar) * (1 - br);
      rg = 1 - (1 - ag) * (1 - bg);
      rb = 1 - (1 - ab) * (1 - bb);
    } else if (blendMode === "overlay") {
      rr = ar <= 0.5 ? 2 * ar * br : 1 - 2 * (1 - ar) * (1 - br);
      rg = ag <= 0.5 ? 2 * ag * bg : 1 - 2 * (1 - ag) * (1 - bg);
      rb = ab <= 0.5 ? 2 * ab * bb : 1 - 2 * (1 - ab) * (1 - bb);
    } else if (blendMode === "soft_light" || blendMode === "soft-light") {
      rr = (1 - 2 * br) * ar * ar + 2 * br * ar;
      rg = (1 - 2 * bg) * ag * ag + 2 * bg * ag;
      rb = (1 - 2 * bb) * ab * ab + 2 * bb * ab;
    } else if (blendMode === "difference") {
      rr = Math.abs(ar - br);
      rg = Math.abs(ag - bg);
      rb = Math.abs(ab - bb);
    } else if (blendMode === "lighten" || blendMode === "max") {
      rr = Math.max(ar, br);
      rg = Math.max(ag, bg);
      rb = Math.max(ab, bb);
    } else if (blendMode === "darken" || blendMode === "min") {
      rr = Math.min(ar, br);
      rg = Math.min(ag, bg);
      rb = Math.min(ab, bb);
    }

    const outR = clamp01(ar * (1 - m) + clamp01(rr) * m);
    const outG = clamp01(ag * (1 - m) + clamp01(rg) * m);
    const outB = clamp01(ab * (1 - m) + clamp01(rb) * m);

    let outA = aa;
    if (blendMode === "over") {
      const mergedAlpha = ba + aa * (1 - ba);
      outA = clamp01(aa * (1 - m) + mergedAlpha * m);
    }

    bd[i] = Math.round(outR * 255);
    bd[i + 1] = Math.round(outG * 255);
    bd[i + 2] = Math.round(outB * 255);
    bd[i + 3] = Math.round(clamp01(outA) * 255);
  }

  putImageData(ctx, base);
}

function resolveResizeDimensions(node: ComfyNode, sourceWidth: number, sourceHeight: number): { width: number; height: number; mode: string; filter: string; fillColor: string; cropPosition: string } {
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
    height = Math.max(1, Math.round(Math.sqrt(total / Math.max(0.0001, ratio))));
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
    width = Math.max(1, width - (width % multiple));
    height = Math.max(1, height - (height % multiple));
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
    cropPosition,
  };
}

function cropRectCanvas(source: HTMLCanvasElement, x: number, y: number, width: number, height: number): HTMLCanvasElement {
  const out = makeCanvas(Math.max(1, width), Math.max(1, height));
  const octx = out.getContext("2d")!;
  octx.clearRect(0, 0, out.width, out.height);
  octx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}

function extractMaskDrivenCrop(source: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null, padding: number, targetWidth: number, targetHeight: number): HTMLCanvasElement {
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

function stitchCanvases(a: HTMLCanvasElement, b: HTMLCanvasElement, direction: string, spacingWidth: number, spacingColor: string, matchSize: boolean): HTMLCanvasElement {
  const normalizedDirection = String(direction || "right").toLowerCase();
  const spacing = Math.max(0, Math.round(spacingWidth));
  const second = matchSize
    ? resizeWithMode(b, normalizedDirection === "up" || normalizedDirection === "down" ? a.width : b.width, normalizedDirection === "right" || normalizedDirection === "left" ? a.height : b.height, "bicubic", "stretch")
    : b;

  const horizontal = normalizedDirection === "right" || normalizedDirection === "left";
  const width = horizontal ? a.width + second.width + spacing : Math.max(a.width, second.width);
  const height = horizontal ? Math.max(a.height, second.height) : a.height + second.height + spacing;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d")!;
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

function extractSplitChannelCanvas(source: HTMLCanvasElement, outputSlot: number | null, mode: string): HTMLCanvasElement {
  const normalizedMode = String(mode || "rgba").toLowerCase();
  const channelIndex = Math.max(0, Math.min(3, outputSlot ?? 0));
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d")!;
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
      if (delta > 0.0001) {
        if (max === r) hue = ((g - b) / delta) % 6;
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

function mergeChannelInputs(inputs: HTMLCanvasElement[], mode: string): HTMLCanvasElement | null {
  if (inputs.length < 3) return null;
  const width = inputs[0].width || 1;
  const height = inputs[0].height || 1;
  const channels = inputs.slice(0, 4).map((input) => fitCanvas(input, width, height));
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d")!;
  const images = channels.map((canvas) => canvas.getContext("2d")!.getImageData(0, 0, width, height).data);
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

export const ops = {
  colorAjust(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyColorCorrectReference(effectCtx, width, height,
          numAny(node, ["temperature"], 0),
          numAny(node, ["hue", "hue_deg"], 0),
          numAny(node, ["brightness"], 0),
          numAny(node, ["contrast"], 0),
          numAny(node, ["saturation", "sat"], 0),
          numAny(node, ["gamma"], 1),
        );
      }),
    );
  },
  colorCorrect(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    return ops.colorAjust(ctx, W, node, inputs);
  },
  blur(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const radius = numAny(node, ["radius", "blur", "blur_radius"], 0);
    const sigma = numAny(node, ["sigma", "radius", "blur"], radius);
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyBlur(effectCtx, width, height, radius, sigma);
      }),
      {
        premultBeforeProcess: true,
        processMask: (mask) => applyEffectToCanvas(mask, (effectCtx, width, height) => {
          applyBlur(effectCtx, width, height, radius, sigma);
        }),
      },
    );
  },
  channel(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot?: number | null, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const splitMode = strAny(node, ["mode"], "RGBA");
    const hasSingleChannelWidget = !!wAny(node, ["channel"]);
    if (!hasSingleChannelWidget && outputSlot != null) {
      return extractSplitChannelCanvas(source, outputSlot, splitMode);
    }
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red"));
      }),
    );
  },
  crop(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
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
        str(node, "aspect_ratio", "custom"),
        num(node, "width", width),
        num(node, "height", height),
      )),
      {
        premultBeforeProcess: true,
        processMask: (mask) => applyEffectToCanvas(mask, (effectCtx, width, height) => applyCrop(
          effectCtx,
          node,
          width,
          height,
          str(node, "aspect_ratio", "custom"),
          num(node, "width", width),
          num(node, "height", height),
        )),
      },
    );
  },
  cropGeneric(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], inputInfos: RenderInputInfo[] = []): HTMLCanvasElement {
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

    const cropRegion = w(node, "crop_region")?.value as { x?: number; y?: number; width?: number; height?: number } | null;
    const bboxNode = inputInfos[1]?.upstreamNode ?? null;
    const x = Math.max(0, Math.round(cropRegion?.x ?? numAny(bboxNode ?? node, ["x", "x_offset"], 0)));
    const y = Math.max(0, Math.round(cropRegion?.y ?? numAny(bboxNode ?? node, ["y", "y_offset"], 0)));
    const width = Math.max(1, Math.round(cropRegion?.width ?? numAny(bboxNode ?? node, ["width", "crop_w"], sourceWidth)));
    const height = Math.max(1, Math.round(cropRegion?.height ?? numAny(bboxNode ?? node, ["height", "crop_h"], sourceHeight)));
    return cropRectCanvas(source, x, y, Math.min(width, sourceWidth - x), Math.min(height, sourceHeight - y));
  },
  transform(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const transformImage = (input: HTMLCanvasElement): HTMLCanvasElement => {
      let working = input;
      const mirror = strAny(node, ["mirror"], "none").toLowerCase();
      const flipMethod = strAny(node, ["flip_method"], "");
      const horizontal = mirror === "horizontal" || flipMethod.startsWith("y");
      const vertical = mirror === "vertical" || flipMethod.startsWith("x");
      working = flipCanvas(working, horizontal, vertical);

      const rotationLabel = strAny(node, ["rotation"], "");
      if (rotationLabel.startsWith("90")) working = rotateDiscrete(working, 1);
      else if (rotationLabel.startsWith("180")) working = rotateDiscrete(working, 2);
      else if (rotationLabel.startsWith("270")) working = rotateDiscrete(working, 3);

      const aspectRatio = numAny(node, ["aspect_ratio"], 1);
      if (Math.abs(aspectRatio - 1) > 0.0001) {
        const scaled = makeCanvas(working.width || 1, Math.max(1, Math.round((working.height || 1) * aspectRatio)));
        const sctx = scaled.getContext("2d")!;
        setResampleMode(sctx, normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear")));
        sctx.drawImage(working, 0, 0, scaled.width, scaled.height);
        working = scaled;
      }

      const tx = numAny(node, ["translate_x", "x", "shift_x"], 0);
      const ty = numAny(node, ["translate_y", "y", "shift_y"], 0);
      const rot = numAny(node, ["rotate_deg", "rotate"], 0);
      const scale = numAny(node, ["scale"], 1);
      const filter = normalizeFilterName(strAny(node, ["filter", "upscale_method", "interpolation", "transform_method"], "bilinear"));
      const expand = boolAny(node, ["expand"], false);

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
        premultBeforeProcess: true,
        processMask: transformImage,
      },
    );
  },
  levels(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, _opts?: any): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyLevels(ctx,width,height,
      numAny(node, ["in_min", "min"], 0),
      numAny(node, ["in_max", "max"], 1),
      numAny(node, ["gamma", "mid"], 1),
      numAny(node, ["out_min"], 0),
      numAny(node, ["out_max"], 1),
    );
  },
  hueSat(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, _opts?: any): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyHueSat(ctx,width,height,
      numAny(node, ["hue_deg", "hue"], 0),
      numAny(node, ["saturation", "sat"], 1),
      numAny(node, ["value", "val"], 1),
    );
  },
  invert(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyInvert(effectCtx, width, height, boolAny(node, ["invert_alpha"], false));
      }),
    );
  },
  clamp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0), numAny(node, ["max_v", "max"], 1));
      }),
    );
  },
  sharpen(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyUnsharp(ctx,width,height, numAny(node,["amount", "strength", "factor"],1));
  },
  edgeDetect(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyEdgeDetect(ctx,width,height, numAny(node,["strength"],1));
  },
  glow(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyGlow(ctx,width,height, numAny(node,["threshold"],0.8), numAny(node,["intensity"],0.75), Math.round(numAny(node,["blur_px", "blur", "radius"],6)));
  },
  cropReformat(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyCropReformat(ctx,width,height,
      numAny(node,["x"],0), numAny(node,["y"],0),
      numAny(node,["crop_w", "width"],width), numAny(node,["crop_h", "height"],height),
      numAny(node,["padding"],0),
      numAny(node,["out_w", "target_width"],0), numAny(node,["out_h", "target_height"],0),
      strAny(node,["mode", "method"],"fit")
    );
  },
  lumaKey(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyLumaKey(ctx,width,height, numAny(node,["low"],0.1), numAny(node,["high"],0.9), numAny(node,["softness"],0.05));
  },
  merge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, topCanvasOrInputs: HTMLCanvasElement | HTMLCanvasElement[], _opts?: any): HTMLCanvasElement {
    const inputs = Array.isArray(topCanvasOrInputs)
      ? topCanvasOrInputs
      : [ctx.canvas, topCanvasOrInputs];
    const base = inputs[0] ?? ctx.canvas;
    const topCanvas = inputs[1] ?? null;
    if (!topCanvas) return fitCanvas(base, base.width || 1, base.height || 1);
    const mode = strAny(node, ["mode", "blend_mode"], "over");
    const rawOpacity = w(node, "opacity") ? num(node, "opacity", 100) : numAny(node, ["mix", "factor", "fade_factor", "blend_factor", "start_level", "end_level"], 1);
    const opacity = rawOpacity > 1 ? rawOpacity / 100 : rawOpacity;
    const merged = applyEffectToCanvas(base, (effectCtx, width, height) => {
      blend(effectCtx, width, height, topCanvas, mode, opacity);
    });
    const effectMask = resolvePreviewMaskCanvas(node, base, inputs[2] ?? null);
    return effectMask ? compositeProcessedWithMask(base, merged, effectMask) : merged;
  },
  resize(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    const { width, height } = getCanvasDimensions(ctx);
    const resolved = resolveResizeDimensions(node, width, height);
    return resizeWithMode(ctx.canvas, resolved.width, resolved.height, resolved.filter, resolved.mode, resolved.fillColor, resolved.cropPosition);
  },
  pad(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const top = Math.max(0, Math.round(numAny(node, ["top"], 0)));
    const bottom = Math.max(0, Math.round(numAny(node, ["bottom"], 0)));
    const left = Math.max(0, Math.round(numAny(node, ["left"], 0)));
    const right = Math.max(0, Math.round(numAny(node, ["right"], 0)));
    const output = makeCanvas((source.width || 1) + left + right, (source.height || 1) + top + bottom);
    const octx = output.getContext("2d")!;
    octx.fillStyle = parseHexColor(strAny(node, ["color", "background_color", "pad_color", "padding_color"], "#808080"));
    octx.fillRect(0, 0, output.width, output.height);
    octx.drawImage(source, left, top, source.width || 1, source.height || 1);
    return output;
  },
  flipRotate(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
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
  desaturate(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    const factor = numAny(node, ["factor", "amount"], 1);
    applyDesaturate(ctx, width, height, factor);
  },
  composite(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
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
  stitch(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    const first = inputs[0] ?? ctx.canvas;
    const second = inputs[1] ?? null;
    if (!second) return first;
    return stitchCanvases(
      first,
      second,
      strAny(node, ["direction"], "right"),
      numAny(node, ["spacing_width"], 0),
      strAny(node, ["spacing_color"], "black"),
      boolAny(node, ["match_image_size"], true),
    );
  },
  channelSplit(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot: number | null): HTMLCanvasElement {
    return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
  },
  channelMerge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
  },
  channelApply(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    const base = fitCanvas(inputs[0] ?? ctx.canvas, (inputs[0] ?? ctx.canvas).width || 1, (inputs[0] ?? ctx.canvas).height || 1);
    const mask = inputs[1] ? fitCanvas(inputs[1], base.width, base.height) : null;
    if (!mask) return base;

    const bctx = base.getContext("2d")!;
    const image = bctx.getImageData(0, 0, base.width, base.height);
    const data = image.data;
    const matte = mask.getContext("2d")!.getImageData(0, 0, base.width, base.height).data;
    const channel = strAny(node, ["channel"], "A").toLowerCase();
    const channelIndex = channel === "g" || channel === "green" ? 1 : channel === "b" || channel === "blue" ? 2 : channel === "a" || channel === "alpha" ? 3 : 0;

    for (let i = 0; i < data.length; i += 4) {
      const value = Math.round(clamp01((matte[i] / 255) * (matte[i + 3] / 255)) * 255);
      data[i + channelIndex] = value;
    }
    bctx.putImageData(image, 0, 0);
    return base;
  },
  comp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    const connectedSlots = getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null);
    return renderCompPreview(
      node,
      inputs.map((canvas, index) => ({
        image: canvas,
        slot: connectedSlots[index]?.slot ?? `image_${index + 1}`,
        layerNumber: connectedSlots[index]?.layerNumber ?? (index + 1),
        inputIndex: connectedSlots[index]?.inputIndex ?? index,
      })),
    ).canvas;
  },
  distort(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[], frameIndex: number = 0): HTMLCanvasElement {
    return renderDistortCanvas(node, inputs, frameIndex).image;
  },
  noise(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, frameIndex: number = 0): HTMLCanvasElement {
    return renderNoiseCanvas(node, false, frameIndex);
  },
  async draw(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    return await renderDrawPreview(node, inputs[0] ?? null);
  },
  async drawMask(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    const base = inputs[0] ?? null;
    const width = base?.width || Math.max(1, Math.round(numAny(node, ["width"], 1024)));
    const height = base?.height || Math.max(1, Math.round(numAny(node, ["height"], 1024)));
    const overlay = await resolveDrawOverlayCanvas(node, width, height);
    return buildMaskAlphaCanvas(overlay, overlay.width || 1, overlay.height || 1);
  },
  imageOpsMask(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, cls: string, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement | null {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const resolvedMask = resolvePreviewMaskCanvas(node, source, rawMask);

    if (cls === "ImageOpsNoise") {
      return renderNoiseCanvas(node, true, frameIndex);
    }

    if (cls === "ImageOpsDistort") {
      return renderDistortCanvas(node, inputs, frameIndex).mask;
    }

    if (cls === "ImageOpsBlur") {
      const radius = numAny(node, ["radius", "blur", "blur_radius"], 0);
      const sigma = numAny(node, ["sigma", "radius", "blur"], radius);
      return applyEffectToCanvas(resolvedMask ?? alphaMaskCanvas(source), (effectCtx, width, height) => {
        applyBlur(effectCtx, width, height, radius, sigma);
      });
    }

    if (cls === "ImageOpsTransform") {
      return ops.transform(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)]);
    }

    if (cls === "ImageOpsCrop") {
      return ops.crop(ctx, W, node, [resolvedMask ?? alphaMaskCanvas(source)]);
    }

    if (cls === "ImageOpsChannel") {
      const extracted = applyEffectToCanvas(source, (effectCtx, width, height) => {
        applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red"));
      });
      return resolvedMask ? premultLayerWithMask(extracted, resolvedMask) : extracted;
    }

    if (cls === "ImageOpsClamp") {
      if (!resolvedMask) return alphaMaskCanvas(source);
      return applyEffectToCanvas(resolvedMask, (effectCtx, width, height) => {
        applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0), numAny(node, ["max_v", "max"], 1));
      });
    }

    if (cls === "ImageOpsInvert") {
      let mask = resolvedMask ?? alphaMaskCanvas(source);
      if (!resolvedMask && boolAny(node, ["invert_alpha"], false)) {
        mask = invertMaskCanvas(mask);
      }
      return mask;
    }

    if (cls === "ImageOpsMerge") {
      if (resolvedMask) return resolvedMask;
      const merged = ops.merge(ctx, W, node, inputs);
      return alphaMaskCanvas(merged);
    }

    if (cls === "ImageOpsComp") {
      return alphaMaskCanvas(ops.comp(ctx, W, node, inputs));
    }

    if (cls === "ImageOpsColorAjust") {
      return resolvedMask ?? alphaMaskCanvas(source);
    }

    return resolvedMask ?? alphaMaskCanvas(source);
  },
};
