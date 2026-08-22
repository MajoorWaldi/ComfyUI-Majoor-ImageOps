// Shared ops implementation for live preview (v6)
// IMPORTANT: this module is the single place implementing preview ops. Nodes must not duplicate preview code.
import type { ComfyNode, ComfyWidget, CornerPinHandle, RenderInputInfo } from "../../types.js";
import { getOpsConstants, initOpsConstants } from "../constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "../crop.js";
import { computeCompRect, getCompLayerOutputCorners, getCompSlots, hasCompLayerCornerPin, syncCompLayers } from "../comp.js";
import { renderDrawPreview, resolveDrawOverlayCanvas } from "../draw.js";
import { acquireCanvas, releaseCanvas } from "../shared/canvas-pool.js";
import { applyColorCorrectGL, type ColorCorrectParams } from "../shared/webgl-color.js";
import { setWidgetValue } from "../shared/widgets.js";
import { blendChannel01 } from "../shared/blend-modes.js";
import { crop, cropStitch, padOut, cornerPin, cropGeneric, transform, cameraShake, cropReformat, resize, pad, flipRotate, distort, spherize } from "./geometry.js";
import { merge, composite, comp } from "./blend.js";
import { channelApply, imageOpsMask } from "./masks.js";
import { grain, text, keyer, stitch, constant, ramp, noise, draw, drawMask } from "./procedural.js";
import { channelSplit, channelMerge } from "./video.js";

initOpsConstants();

export function w(node: ComfyNode, name: string): ComfyWidget | null {
  return node?.widgets?.find((x: ComfyWidget) => x?.name === name) ?? null;
}
export function widgetScalarValue(value: unknown, index: number = 0): unknown {
  let current = value;
  while (Array.isArray(current) && current.length > 0) {
    const resolvedIndex = Math.max(0, Math.min(current.length - 1, index));
    current = current[resolvedIndex];
  }
  return current;
}
export function num(node: ComfyNode, name: string, fallback: number = 0, index: number = 0): number {
  const v = widgetScalarValue(w(node, name)?.value, index);
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
}
export function str(node: ComfyNode, name: string, fallback: string = "", index: number = 0): string {
  const v = widgetScalarValue(w(node, name)?.value, index);
  return typeof v === "string" ? v : fallback;
}
export function bool(node: ComfyNode, name: string, fallback: boolean = false, index: number = 0): boolean {
  const v = widgetScalarValue(w(node, name)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
export function wAny(node: ComfyNode, names: string[]): ComfyWidget | null {
  for (const name of names) {
    const found = w(node, name);
    if (found) return found;
  }
  return null;
}
export function numAny(node: ComfyNode, names: string[], fallback: number = 0, index: number = 0): number {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  const n = parseFloat(v as string);
  return Number.isFinite(n) ? n : fallback;
}
export function strAny(node: ComfyNode, names: string[], fallback: string = "", index: number = 0): string {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  return typeof v === "string" ? v : fallback;
}
// Follow a STRING input connection to read the upstream widget's current value.
// Returns null if the input is not connected or no string widget found upstream.
export function resolveConnectedString(node: ComfyNode, inputName: string): string | null {
  const inputs: any[] = (node as any)?.inputs ?? [];
  const slotIndex = inputs.findIndex((inp: any) => inp?.name === inputName);
  if (slotIndex < 0) return null;
  const link = inputs[slotIndex]?.link;
  if (link == null) return null;
  const linkData = (node as any)?.graph?.links?.[link];
  if (!linkData) return null;
  const upNode = (node as any)?.graph?.getNodeById?.(linkData.origin_id);
  if (!upNode) return null;
  const upWidget = ((upNode as any)?.widgets ?? []).find((w: any) => typeof w?.value === "string");
  return upWidget ? String(upWidget.value) : null;
}
export function boolAny(node: ComfyNode, names: string[], fallback: boolean = false, index: number = 0): boolean {
  const v = widgetScalarValue(wAny(node, names)?.value, index);
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
export function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }
export function luma01(r: number, g: number, b: number, lw: number[]): number { return lw[0]*r + lw[1]*g + lw[2]*b; }

export function getImageData(ctx: CanvasRenderingContext2D, W: number, H: number): ImageData { return ctx.getImageData(0,0,W,H); }
export function putImageData(ctx: CanvasRenderingContext2D, img: ImageData): void { ctx.putImageData(img,0,0); }
export function getCanvasDimensions(ctx: CanvasRenderingContext2D): { width: number; height: number } {
  return {
    width: Math.max(1, ctx.canvas.width || 1),
    height: Math.max(1, ctx.canvas.height || 1),
  };
}
export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

type MaskCanvas = HTMLCanvasElement & { __imageopsPreparedMask?: boolean };
const preparedMaskCache = new WeakMap<HTMLCanvasElement, Map<string, HTMLCanvasElement>>();
const canvasFieldCache = new WeakMap<HTMLCanvasElement, Map<string, Float32Array>>();

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

export function normalizeFilterName(filter: string): string {
  const value = String(filter || "bilinear").toLowerCase();
  if (value === "nearest") return "nearest-exact";
  if (value === "linear") return "bilinear";
  if (value === "cubic") return "bicubic";
  return value;
}

export function parseHexColor(value: string): string {
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

export function imageLikeInputName(name: string): boolean {
  return /image|images|source|destination|background|foreground|layer|red|green|blue|channel|input/i.test(name);
}

export function getPreferredInputIndexes(node: ComfyNode): number[] {
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

export function resizeWithMode(
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
  const octx = output.getContext("2d", { willReadFrequently: true })!;
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

export function fitCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  if ((source.width || 1) === Math.max(1, Math.round(width)) && (source.height || 1) === Math.max(1, Math.round(height))) {
    return source;
  }
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  setResampleMode(octx, "bicubic");
  octx.clearRect(0, 0, output.width, output.height);
  octx.drawImage(source, 0, 0, output.width, output.height);
  if (isPreparedMaskCanvas(source)) {
    markPreparedMaskCanvas(output);
  }
  return output;
}

export function flipCanvas(source: HTMLCanvasElement, horizontal: boolean, vertical: boolean): HTMLCanvasElement {
  if (!horizontal && !vertical) return source;
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.save();
  octx.translate(horizontal ? output.width : 0, vertical ? output.height : 0);
  octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
  octx.drawImage(source, 0, 0, output.width, output.height);
  octx.restore();
  return output;
}

export function rotateDiscrete(source: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
  const turns = ((quarterTurns % 4) + 4) % 4;
  if (turns === 0) return source;
  const swap = turns % 2 === 1;
  const output = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.translate(output.width / 2, output.height / 2);
  octx.rotate(turns * Math.PI / 2);
  octx.drawImage(source, -source.width / 2, -source.height / 2);
  return output;
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

export function compositeAt(
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
  const octx = output.getContext("2d", { willReadFrequently: true })!;
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

export function compModeToCanvasOp(mode: string): GlobalCompositeOperation {
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

export function hexToRgb01(value: string): [number, number, number] {
  const hex = parseHexColor(value);
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export function renderConstantCanvas(node: ComfyNode, maskOnly: boolean = false): HTMLCanvasElement {
  const width = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const height = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  const alpha = Math.max(0, Math.min(1, numAny(node, ["alpha"], 1)));
  const canvas = makeCanvas(width, height);
  const out = canvas.getContext("2d", { willReadFrequently: true })!;
  if (maskOnly) {
    out.fillStyle = `rgba(255,255,255,${alpha})`;
    out.fillRect(0, 0, width, height);
    return markPreparedMaskCanvas(canvas);
  }

  const mode = strAny(node, ["mode"], "constant").toLowerCase().replace(/[-\s]+/g, "_");
  const color = parseHexColor(strAny(node, ["color"], "#ffffff"));
  const colorB = parseHexColor(strAny(node, ["color_b"], "#000000"));
  if (mode === "checkerboard") {
    const tile = Math.max(1, Math.round(numAny(node, ["tile_size"], 64)));
    const offsetX = Math.round(numAny(node, ["offset_x"], 0));
    const offsetY = Math.round(numAny(node, ["offset_y"], 0));
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const ix = Math.floor((x + offsetX) / tile);
        const iy = Math.floor((y + offsetY) / tile);
        out.fillStyle = ((ix + iy) & 1) === 0 ? color : colorB;
        out.fillRect(x, y, Math.min(tile, width - x), Math.min(tile, height - y));
      }
    }
  } else {
    out.fillStyle = color;
    out.fillRect(0, 0, width, height);
  }
  if (alpha < 1) {
    const img = out.getImageData(0, 0, width, height);
    const a = Math.round(alpha * 255);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = a;
    out.putImageData(img, 0, 0);
  }
  return canvas;
}

export function applyRampCurve(value: number, mode: string): number {
  const normalized = String(mode || "linear").toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "ease_in") return value * value;
  if (normalized === "ease_out") return 1 - (1 - value) * (1 - value);
  if (normalized === "smoothstep") return value * value * (3 - 2 * value);
  return value;
}

export function renderRampCanvas(node: ComfyNode, maskOnly: boolean = false): HTMLCanvasElement {
  const width = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const height = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  const alpha = Math.max(0, Math.min(1, numAny(node, ["alpha"], 1)));
  const canvas = makeCanvas(width, height);
  const out = canvas.getContext("2d", { willReadFrequently: true })!;
  if (maskOnly) {
    out.fillStyle = `rgba(255,255,255,${alpha})`;
    out.fillRect(0, 0, width, height);
    return markPreparedMaskCanvas(canvas);
  }

  const colorA = hexToRgb01(strAny(node, ["color_a"], "#ffffff"));
  const colorB = hexToRgb01(strAny(node, ["color_b"], "#000000"));
  const sx = numAny(node, ["start_x"], 0);
  const sy = numAny(node, ["start_y"], 0.5);
  const ex = numAny(node, ["end_x"], 1);
  const ey = numAny(node, ["end_y"], 0.5);
  const dx = ex - sx;
  const dy = ey - sy;
  const denom = dx * dx + dy * dy;
  const invert = boolAny(node, ["invert"], false);
  const mode = strAny(node, ["ramp_mode"], "linear");
  const shape = strAny(node, ["ramp_shape"], "linear").toLowerCase().replace(/[-\s]+/g, "_");
  const image = out.createImageData(width, height);
  const data = image.data;
  const a = Math.round(alpha * 255);
  for (let y = 0; y < height; y++) {
    const ny = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const nx = width > 1 ? x / (width - 1) : 0;
      let t = 0;
      if (denom > 1e-12) {
        t = shape === "radial"
          ? Math.hypot(nx - sx, ny - sy) / Math.sqrt(denom)
          : ((nx - sx) * dx + (ny - sy) * dy) / denom;
      }
      t = Math.max(0, Math.min(1, invert ? 1 - t : t));
      t = Math.max(0, Math.min(1, applyRampCurve(t, mode)));
      const i = (y * width + x) * 4;
      data[i] = Math.round((colorA[0] * (1 - t) + colorB[0] * t) * 255);
      data[i + 1] = Math.round((colorA[1] * (1 - t) + colorB[1] * t) * 255);
      data[i + 2] = Math.round((colorA[2] * (1 - t) + colorB[2] * t) * 255);
      data[i + 3] = a;
    }
  }
  out.putImageData(image, 0, 0);
  return canvas;
}

export function grainRandom01(seed: number, x: number, y: number, channel: number, frame: number): number {
  let v = (seed >>> 0) ^ Math.imul(x + 374761393, 668265263) ^ Math.imul(y + 2246822519, 3266489917);
  v ^= Math.imul(channel + 1, 1274126177);
  v ^= Math.imul(frame + 1, 1597334677);
  v ^= v >>> 15;
  v = Math.imul(v, 2246822519);
  v ^= v >>> 13;
  v = Math.imul(v, 3266489917);
  v ^= v >>> 16;
  return (v >>> 0) / 4294967295;
}

export function blendGrainValue(base: number, noise: number, amount: number, mode: string): number {
  const normalized = String(mode || "add").toLowerCase().replace(/[-\s]+/g, "_");
  const top = Math.max(0, Math.min(1, 0.5 + noise * amount));
  if (normalized === "overlay") {
    const blended = base <= 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
    return base * (1 - amount) + blended * amount;
  }
  if (normalized === "soft_light") {
    const curve = base <= 0.25 ? ((16 * base - 12) * base + 4) * base : Math.sqrt(Math.max(0, Math.min(1, base)));
    const blended = top <= 0.5
      ? base - (1 - 2 * top) * base * (1 - base)
      : base + (2 * top - 1) * (curve - base);
    return base * (1 - amount) + blended * amount;
  }
  return base + noise * amount;
}

export function renderGrainCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const img = octx.getImageData(0, 0, width, height);
  const data = img.data;
  const amount = Math.max(0, Math.min(1, numAny(node, ["amount"], 0.08, frameIndex)));
  const seed = Math.max(0, Math.round(numAny(node, ["seed"], 12345, frameIndex)));
  const mono = boolAny(node, ["monochrome"], true, frameIndex);
  const animated = boolAny(node, ["animated"], true, frameIndex);
  const grainFrame = animated ? Math.max(0, Math.round(frameIndex)) : 0;
  const mode = strAny(node, ["blend_mode"], "add", frameIndex);
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const maskData = mask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const weight = maskData ? maskData[i + 3] / 255 : 1;
      if (weight <= 0 || amount <= 0) continue;
      const monoNoise = grainRandom01(seed, x, y, 0, grainFrame) - 0.5;
      for (let c = 0; c < 3; c++) {
        const base = data[i + c] / 255;
        const noise = mono ? monoNoise : grainRandom01(seed, x, y, c, grainFrame) - 0.5;
        const grained = Math.max(0, Math.min(1, blendGrainValue(base, noise, amount, mode)));
        const mixed = base * (1 - weight) + grained * weight;
        data[i + c] = Math.round(mixed * 255);
      }
    }
  }
  octx.putImageData(img, 0, 0);
  return output;
}

export function renderTextCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const text = resolveConnectedString(node, "text") ?? strAny(node, ["text"], "ImageOps Text", frameIndex);
  const opacity = Math.max(0, Math.min(1, numAny(node, ["opacity"], 1, frameIndex)));
  if (!text || opacity <= 0) return output;

  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const layer = makeCanvas(width, height);
  const lctx = layer.getContext("2d", { willReadFrequently: true })!;
  const fontSize = Math.max(1, Math.round(numAny(node, ["font_size"], 64, frameIndex)));
  const align = strAny(node, ["align"], "center", frameIndex).toLowerCase();
  const x = numAny(node, ["x"], 0.5, frameIndex) * Math.max(1, width - 1);
  const y = numAny(node, ["y"], 0.5, frameIndex) * Math.max(1, height - 1);
  const lineSpacing = Math.max(0, Math.round(numAny(node, ["line_spacing"], 4, frameIndex)));
  const strokeWidth = Math.max(0, Math.round(numAny(node, ["stroke_width"], 0, frameIndex)));
  lctx.font = `${fontSize}px sans-serif`;
  lctx.textBaseline = "top";
  lctx.textAlign = align === "left" || align === "right" ? align as CanvasTextAlign : "center";
  lctx.globalAlpha = opacity;
  lctx.fillStyle = parseHexColor(strAny(node, ["color"], "#ffffff", frameIndex));
  lctx.strokeStyle = parseHexColor(strAny(node, ["stroke_color"], "#000000", frameIndex));
  lctx.lineWidth = strokeWidth;
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const ty = y + index * (fontSize + lineSpacing);
    if (strokeWidth > 0) lctx.strokeText(lines[index], x, ty);
    lctx.fillText(lines[index], x, ty);
  }
  lctx.globalAlpha = 1;

  if (mask) {
    lctx.globalCompositeOperation = "destination-in";
    lctx.drawImage(mask, 0, 0, width, height);
    lctx.globalCompositeOperation = "source-over";
  }
  octx.drawImage(layer, 0, 0, width, height);
  return output;
}

export function shakeRandom(seed: number, frame: number, salt: number): number {
  let v = (seed >>> 0) ^ Math.imul(frame + 1, 1597334677) ^ Math.imul(salt + 1, 3812015801);
  v ^= v >>> 15;
  v = Math.imul(v, 2246822519);
  v ^= v >>> 13;
  v = Math.imul(v, 3266489917);
  v ^= v >>> 16;
  return ((v >>> 0) / 4294967295) * 2 - 1;
}

export function smoothShakeValue(seed: number, frame: number, salt: number, amount: number, smoothing: number, frequency: number = 1): number {
  const smooth = Math.max(0, Math.min(0.98, smoothing));
  const sampleFrame = Math.max(0, frame * Math.max(0.01, frequency));
  const baseFrame = Math.floor(sampleFrame);
  const t = sampleFrame - baseFrame;
  const valueAt = (targetFrame: number): number => {
    let currentValue = shakeRandom(seed, 0, salt) * amount;
    for (let i = 0; i <= Math.max(0, Math.round(targetFrame)); i++) {
      const target = shakeRandom(seed, i, salt) * amount;
      currentValue = currentValue * smooth + target * (1 - smooth);
    }
    return currentValue;
  };
  if (t <= 1e-6) return valueAt(baseFrame);
  return valueAt(baseFrame) * (1 - t) + valueAt(baseFrame + 1) * t;
}

export function noiseFade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function noiseLerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Precomputed 3D gradient table — 16 entries (padded from Perlin's 12 unit vectors).
// Using a table eliminates Math.cos, Math.sin, Math.sqrt per gradient evaluation
// (previously called twice per lattice corner). With 5 Perlin octaves this saves
// ~80 trig/sqrt calls per pixel.
const NOISE_GRAD3_X = new Float32Array([ 1,-1, 1,-1,  1,-1, 1,-1,  0, 0, 0, 0,  1,-1, 0, 0]);
const NOISE_GRAD3_Y = new Float32Array([ 1, 1,-1,-1,  0, 0, 0, 0,  1,-1, 1,-1,  1, 1,-1, 1]);
const NOISE_GRAD3_Z = new Float32Array([ 0, 0, 0, 0,  1, 1,-1,-1,  1, 1,-1,-1,  0, 0, 1,-1]);

export function noiseHash3D(x: number, y: number, z: number, seed: number): number {
  let h = (
    Math.imul(x | 0, 374761393)
    + Math.imul(y | 0, 668265263)
    + Math.imul(z | 0, 2246822519)
    + Math.imul(seed | 0, 1442695041)
  ) | 0;
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function wrapNoiseIndex(value: number, period: number): number {
  if (period <= 0) return value;
  return ((value % period) + period) % period;
}

export function sampleWhiteNoise(x: number, y: number, z: number, seed: number, periodX: number = 0, periodY: number = 0): number {
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

export function sampleValueNoise(x: number, y: number, z: number, seed: number, periodX: number = 0, periodY: number = 0): number {
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
  const w = noiseFade(tz);

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
  return noiseLerp(noiseLerp(x00, x10, v), noiseLerp(x01, x11, v), w);
}

export function gradientDot3(ix: number, iy: number, iz: number, x: number, y: number, z: number, seed: number, periodX: number = 0, periodY: number = 0): number {
  const hashX = wrapNoiseIndex(ix, periodX);
  const hashY = wrapNoiseIndex(iy, periodY);
  const h = noiseHash3D(hashX, hashY, iz, seed);
  const gi = Math.floor(h * 16) & 15;
  return NOISE_GRAD3_X[gi] * (x - ix) + NOISE_GRAD3_Y[gi] * (y - iy) + NOISE_GRAD3_Z[gi] * (z - iz);
}

export function samplePerlinNoise(x: number, y: number, z: number, seed: number, periodX: number = 0, periodY: number = 0): number {
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
  const w = noiseFade(tz);

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
  return Math.max(-1, Math.min(1, noiseLerp(noiseLerp(x00, x10, v), noiseLerp(x01, x11, v), w) * 1.15470053838));
}

export function sampleNoiseBasis(
  basis: string,
  sampleX: number,
  sampleY: number,
  sampleZ: number,
  rawX: number,
  rawY: number,
  rawZ: number,
  seed: number,
  periodX: number = 0,
  periodY: number = 0,
): number {
  const normalized = String(basis || "perlin").toLowerCase();
  if (normalized === "value") return sampleValueNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
  if (normalized === "white") return sampleWhiteNoise(rawX, rawY, rawZ, seed, periodX > 0 ? Math.max(1, Math.round(periodX)) : 0, periodY > 0 ? Math.max(1, Math.round(periodY)) : 0);
  return samplePerlinNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
}

export function buildNoiseField(
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
    offsetZ?: number;
    frameOffsetX?: number;
    frameOffsetY?: number;
    frameOffsetZ?: number;
    seamless?: boolean;
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
        const periodX = seamless ? (useWhitePeriod ? width : Math.max(1, Math.round(width / scale))) : 0;
        const periodY = seamless ? (useWhitePeriod ? height : Math.max(1, Math.round(height / scale))) : 0;
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
          const periodX = seamless ? (useWhitePeriod ? width : Math.max(1, Math.round(width / currentScale))) : 0;
          const periodY = seamless ? (useWhitePeriod ? height : Math.max(1, Math.round(height / currentScale))) : 0;
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
    let gray = grayRange > 1.0e-6 ? (grayValues[index] - minGray) / grayRange : 0;
    gray = clamp01((gray - 0.5) * contrast + 0.5);
    if (invert) gray = 1 - gray;
    grayValues[index] = gray;
  }

  return grayValues;
}

export function renderNoiseFieldCanvas(
  width: number,
  height: number,
  grayValues: Float32Array,
  low: [number, number, number],
  high: [number, number, number],
  maskOnly: boolean = false,
): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = context.createImageData(width, height);
  const data = image.data;

  for (let index = 0; index < grayValues.length; index++) {
    const gray = grayValues[index];
    const offset = index * 4;
    if (maskOnly) {
      const channel = Math.round(gray * 255);
      const rgb = channel > 0 ? 255 : 0;
      data[offset] = rgb;
      data[offset + 1] = rgb;
      data[offset + 2] = rgb;
      data[offset + 3] = channel;
    } else {
      data[offset] = Math.round(clamp01(low[0] + gray * (high[0] - low[0])) * 255);
      data[offset + 1] = Math.round(clamp01(low[1] + gray * (high[1] - low[1])) * 255);
      data[offset + 2] = Math.round(clamp01(low[2] + gray * (high[2] - low[2])) * 255);
      data[offset + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return maskOnly ? markPreparedMaskCanvas(canvas) : canvas;
}

// CPU pixel loop runs synchronously on the main thread, so cap lower than general canvasSize.
const NOISE_CANVAS_MAX = 256;

export function renderNoiseCanvas(node: ComfyNode, maskOnly: boolean = false, frameIndex: number = 0, canvasSize: number = 512): HTMLCanvasElement {
  const fullWidth = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const fullHeight = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  // Cap render resolution to the preview canvas size — the full node dimensions
  // can be thousands of pixels, but the preview widget is much smaller.
  // This is the primary driver of animation fluidity: 1024→384 cuts pixel work by 7×.
  const scaleFactor = Math.min(1, Math.max(1, Math.min(canvasSize, NOISE_CANVAS_MAX)) / Math.max(fullWidth, fullHeight));
  const width = Math.max(1, Math.round(fullWidth * scaleFactor));
  const height = Math.max(1, Math.round(fullHeight * scaleFactor));
  const batchSize = Math.max(1, Math.round(numAny(node, ["batch_size"], 1)));
  const frameLength = Math.max(0, Math.round(numAny(node, ["frame_length"], 0)));
  const frameCount = frameLength > 0 ? frameLength : batchSize;
  const resolvedFrameIndex = ((Math.max(0, Math.round(frameIndex)) % frameCount) + frameCount) % frameCount;
  const low = hexToRgb01(strAny(node, ["low_color"], "#ffffff", resolvedFrameIndex));
  const high = hexToRgb01(strAny(node, ["high_color"], "#000000", resolvedFrameIndex));
  // animation_speed is the new name for frame_offset_z (per-frame Z increment).
  // Use raw frameIndex (tick) so the preview animates continuously regardless of frame_length.
  const animSpeed = numAny(node, ["animation_speed", "frame_offset_z"], 0, resolvedFrameIndex);
  const grayValues = buildNoiseField(width, height, {
    basis: strAny(node, ["basis"], "perlin", resolvedFrameIndex),
    fractalMode: strAny(node, ["fractal_mode"], "fbm", resolvedFrameIndex),
    seed: numAny(node, ["seed"], 0, resolvedFrameIndex),
    seedStep: numAny(node, ["seed_step"], 0, resolvedFrameIndex),
    scale: numAny(node, ["scale"], 160, resolvedFrameIndex),
    octaves: numAny(node, ["octaves"], 5, resolvedFrameIndex),
    lacunarity: numAny(node, ["lacunarity"], 2, resolvedFrameIndex),
    gain: numAny(node, ["gain"], 0.5, resolvedFrameIndex),
    offsetX: numAny(node, ["offset_x"], 0, resolvedFrameIndex),
    offsetY: numAny(node, ["offset_y"], 0, resolvedFrameIndex),
    offsetZ: numAny(node, ["offset_z"], 0, resolvedFrameIndex),
    frameOffsetX: numAny(node, ["frame_offset_x"], 0, resolvedFrameIndex),
    frameOffsetY: numAny(node, ["frame_offset_y"], 0, resolvedFrameIndex),
    frameOffsetZ: animSpeed,
    seamless: boolAny(node, ["seamless"], false, resolvedFrameIndex),
    contrast: numAny(node, ["contrast"], 1, resolvedFrameIndex),
    invert: boolAny(node, ["invert"], false, resolvedFrameIndex),
    frameIndex: frameIndex,
  });

  return renderNoiseFieldCanvas(width, height, grayValues, low, high, maskOnly);
}

export function distortConnectedInputs(
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

export function extractCanvasField(canvas: HTMLCanvasElement, width: number, height: number, channel: string): Float32Array {
  const normalized = String(channel || "red").toLowerCase();
  const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}:${normalized}`;
  const cachedField = canvasFieldCache.get(canvas)?.get(cacheKey);
  if (cachedField) return cachedField;
  const fitted = (canvas.width || 1) === width && (canvas.height || 1) === height
    ? canvas
    : fitCanvas(canvas, width, height);
  const data = fitted.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
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
  const cache = canvasFieldCache.get(canvas) ?? new Map<string, Float32Array>();
  cache.set(cacheKey, field);
  canvasFieldCache.set(canvas, cache);
  return field;
}

export function neutralField(width: number, height: number, centered: boolean): Float32Array {
  const field = new Float32Array(width * height);
  field.fill(centered ? 0.5 : 0);
  return field;
}

// Approximate gaussian blur with 3 separable box passes (mirror padding).
export function blurField(field: Float32Array, width: number, height: number, radiusPx: number): Float32Array {
  const r = Math.max(0, Math.round(radiusPx));
  if (r <= 0 || width < 2 || height < 2) return field;
  const passes = 3;
  let src = new Float32Array(field);
  let dst = new Float32Array(field.length);
  const win = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    // Horizontal
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
        const addCoord = addX >= width ? (2 * (width - 1) - addX) : addX;
        const remCoord = remX < 0 ? -remX : remX;
        sum += src[row + Math.max(0, Math.min(width - 1, addCoord))];
        sum -= src[row + Math.max(0, Math.min(width - 1, remCoord))];
        dst[row + x] = sum / win;
      }
    }
    [src, dst] = [dst, src];
    // Vertical
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
        const addCoord = addY >= height ? (2 * (height - 1) - addY) : addY;
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

export function reflectCoordinate(value: number, size: number): number {
  if (size <= 1) return 0;
  let coord = value;
  const max = size - 1;
  while (coord < 0 || coord > max) {
    if (coord < 0) coord = -coord;
    if (coord > max) coord = max - (coord - max);
  }
  return coord;
}

export function sampleChannel(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, edgeMode: string): [number, number, number, number] {
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

export function bilinearSample(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, edgeMode: string): [number, number, number, number] {
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

export function renderDistortCanvas(
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
  const effectMask = mapSource === "mask" ? null : resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
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
    const xChannel = strAny(node, ["x_channel"], "Red", frameIndex);
    const yChannel = strAny(node, ["y_channel"], "Green", frameIndex);
    xField = extractCanvasField(driver, width, height, xChannel);
    yField = String(xChannel).toLowerCase() === String(yChannel).toLowerCase()
      ? xField
      : extractCanvasField(driver, width, height, yChannel);
  }

  const blurRadius = Math.max(0, Math.round(numAny(node, ["blur_map"], 0, frameIndex)));
  if (blurRadius > 0) {
    xField = blurField(xField, width, height, blurRadius);
    yField = xField === yField ? xField : blurField(yField, width, height, blurRadius);
  }

  const sourceCanvas = source;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true })!;
  const sourceData = sourceCtx.getImageData(0, 0, width, height);
  const output = makeCanvas(width, height);
  const outCtx = output.getContext("2d", { willReadFrequently: true })!;
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

export function setResampleMode(ctx: CanvasRenderingContext2D, filter: string): void {
  const mode = String(filter || "bilinear").toLowerCase();
  ctx.imageSmoothingEnabled = mode !== "nearest";
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
  }
}

export function applyLevels(ctx: CanvasRenderingContext2D, W: number, H: number, inMin: number, inMax: number, gamma: number, outMin: number, outMax: number): void {
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

export function applyHueSat(ctx: CanvasRenderingContext2D, W: number, H: number, hueDeg: number, sat: number, val: number): void {
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

export function applyInvert(ctx: CanvasRenderingContext2D, W: number, H: number, invertAlpha: boolean = false): void {
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

export function applyClamp(ctx: CanvasRenderingContext2D, W: number, H: number, minV: number, maxV: number): void {
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

export function applyColorCorrect(ctx: CanvasRenderingContext2D, W: number, H: number, brightness: number, contrast: number, gamma: number, saturation: number): void {
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

export function applyColorCorrectReference(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  temperature: number,
  tint: number,
  hue: number,
  brightness: number,
  contrast: number,
  saturation: number,
  vibrance: number,
  gamma: number,
  shadowsHue: number,
  shadowsAmount: number,
  midtonesHue: number,
  midtonesAmount: number,
  highlightsHue: number,
  highlightsAmount: number,
  perZone?: Partial<ColorCorrectParams>,
): void {
  const { luma_weights: LW } = getOpsConstants();

  // Try the GPU path first — a single fragment-shader pass instead of a full
  // pixel loop in JS. Falls back transparently to the CPU implementation
  // below if WebGL is unavailable, the context is lost, or any draw fails.
  const okGL = applyColorCorrectGL(ctx, W, H, {
    temperature, tint, hue, brightness, contrast, saturation, vibrance, gamma,
    shadowsHue, shadowsAmount, midtonesHue, midtonesAmount, highlightsHue, highlightsAmount,
    lumaWeights: [LW[0], LW[1], LW[2]],
    ...(perZone ?? {}),
  });
  if (okGL) return;

  const img = getImageData(ctx, W, H);
  const d = img.data;
  const brightnessFactor = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const temperatureFactor = temperature / 100;
  const tintFactor = tint / 100;
  const vibranceFactor = vibrance / 100;
  const safeGamma = Math.max(0.2, Math.min(2.2, gamma));
  const wheelTint = (hueDeg: number, amount: number): [number, number, number] => {
    const sat = clamp01(amount / 100);
    const rad = ((hueDeg % 360) + 360) % 360;
    const sector = rad / 60;
    const c = sat;
    const x = c * (1 - Math.abs((sector % 2) - 1));
    let rp = 0, gp = 0, bp = 0;
    if (sector < 1) [rp, gp, bp] = [c, x, 0];
    else if (sector < 2) [rp, gp, bp] = [x, c, 0];
    else if (sector < 3) [rp, gp, bp] = [0, c, x];
    else if (sector < 4) [rp, gp, bp] = [0, x, c];
    else if (sector < 5) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return [rp, gp, bp];
  };

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

    if (tintFactor > 0) {
      r *= 1 + tintFactor * 0.25;
      b *= 1 + tintFactor * 0.35;
      g *= 1 - tintFactor * 0.2;
    } else if (tintFactor < 0) {
      g *= 1 + (-tintFactor) * 0.3;
      r *= 1 - (-tintFactor) * 0.12;
      b *= 1 - (-tintFactor) * 0.08;
    }

    const luma = luma01(r, g, b, LW);
    const maxChroma = Math.max(r, g, b);
    const minChroma = Math.min(r, g, b);
    const chroma = maxChroma - minChroma;
    const muted = 1 - clamp01(chroma);
    const vibranceBoost = 1 + vibranceFactor * muted;
    r = luma + (r - luma) * vibranceBoost;
    g = luma + (g - luma) * vibranceBoost;
    b = luma + (b - luma) * vibranceBoost;

    const shadowMask = Math.max(0, Math.min(1, ((0.5 - luma) / 0.5))) ** 2;
    const highlightMask = Math.max(0, Math.min(1, ((luma - 0.5) / 0.5))) ** 2;
    const midMask = Math.max(0, Math.min(1, 1 - shadowMask - highlightMask));
    const [sr, sg, sb] = wheelTint(shadowsHue, shadowsAmount);
    const [mr, mg, mb] = wheelTint(midtonesHue, midtonesAmount);
    const [hr, hg, hb] = wheelTint(highlightsHue, highlightsAmount);
    r *= 1 + ((sr - 0.5) * shadowMask + (mr - 0.5) * midMask + (hr - 0.5) * highlightMask) * 0.85;
    g *= 1 + ((sg - 0.5) * shadowMask + (mg - 0.5) * midMask + (hg - 0.5) * highlightMask) * 0.85;
    b *= 1 + ((sb - 0.5) * shadowMask + (mb - 0.5) * midMask + (hb - 0.5) * highlightMask) * 0.85;

    d[i] = Math.round(clamp01(Math.pow(clamp01(r), safeGamma)) * 255);
    d[i + 1] = Math.round(clamp01(Math.pow(clamp01(g), safeGamma)) * 255);
    d[i + 2] = Math.round(clamp01(Math.pow(clamp01(b), safeGamma)) * 255);
  }

  putImageData(ctx, img);
  applyHueSat(ctx, W, H, hue, 1 + saturation / 100, 1);
}

export function applyUnsharp(ctx: CanvasRenderingContext2D, W: number, H: number, amount: number = 1.0): void {
  const tmp=document.createElement("canvas");
  tmp.width=W; tmp.height=H;
  const tctx=tmp.getContext("2d", { willReadFrequently: true })!;
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

export function applyEdgeDetect(ctx: CanvasRenderingContext2D, W: number, H: number, strength: number = 1.0): void {
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

export function applyBlur(ctx: CanvasRenderingContext2D, W: number, H: number, radiusPx: number, sigmaPx: number): void {
  const blurPx = resolveBlurRadiusPx(radiusPx, sigmaPx);
  if (blurPx <= 0) return;
  // CSS filter:blur() takes sigma (standard deviation), not radius.  Use the original
  // sigma value so the Gaussian shape matches the backend kernel; the effective radius
  // only controls truncation which CSS cannot replicate anyway.
  const safeSigma = Math.max(0, sigmaPx);
  const cssSigma = safeSigma > 0 ? Math.min(blurPx, safeSigma) : Math.max(0.1, blurPx / 3);
  // Pool the tmp canvas — acquired/released per call so we don't allocate a fresh
  // canvas on every video tick (hot path: 30+ allocations/sec per blur node).
  const tmp = acquireCanvas(W, H);
  try {
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.filter = `blur(${cssSigma}px)`;
    tctx.drawImage(ctx.canvas, 0, 0);
    tctx.filter = "none";
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
  } finally {
    releaseCanvas(tmp);
  }
}

export function resolveBlurRadiusPx(radiusPx: number, sigmaPx: number): number {
  const safeRadius = Math.max(0, Math.round(radiusPx));
  // Match the backend UX: the explicit radius slider controls the blur extent directly,
  // while sigma only shapes the softness inside that chosen radius.
  void sigmaPx;
  return safeRadius;
}

export function applyChannel(ctx: CanvasRenderingContext2D, W: number, H: number, channel: string): void {
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

export function applyDesaturate(ctx: CanvasRenderingContext2D, W: number, H: number, factor: number = 1): void {
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

export function normalizeAffineFillMode(value: string): string {
  const normalized = String(value || "transparent").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "border" || normalized === "expand" || normalized === "edge" || normalized === "edge_extend" || normalized === "replicate" || normalized === "extend") return "expand";
  if (normalized === "reflect" || normalized === "reflection" || normalized === "mirror") return "mirror";
  if (normalized === "stretch" || normalized === "fill" || normalized === "cover") return "stretch";
  if (normalized === "color" || normalized === "colour" || normalized === "constant" || normalized === "solid") return "color";
  return "transparent";
}

export function applyTransform(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  tx: number,
  ty: number,
  rotDeg: number,
  scale: number,
  filter: string,
  expand: boolean,
  fillMode: string = "transparent",
  fillColor: string = "#000000",
): HTMLCanvasElement | void {
  void expand; // Backend keeps a fixed-size affine_grid output for compatibility.
  const safeScale = Math.max(0.01, scale || 1);
  const normalizedFill = normalizeAffineFillMode(fillMode);
  const rad = rotDeg * Math.PI / 180;
  const needsScale = Math.abs(safeScale - 1) > 0.0001;
  const needsRotate = Math.abs(rotDeg) > 0.0001;
  const needsTranslate = tx !== 0 || ty !== 0;
  if (!needsScale && !needsRotate && !needsTranslate) return;

  const sourceCtx = ctx.canvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;

  const output = makeCanvas(W, H);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  setResampleMode(octx, filter);
  octx.clearRect(0, 0, W, H);

  if (normalizedFill === "color") {
    octx.fillStyle = parseHexColor(fillColor);
    octx.fillRect(0, 0, W, H);
  } else if (normalizedFill === "stretch") {
    octx.drawImage(ctx.canvas, 0, 0, W, H);
  }

  const srcImage = sourceCtx.getImageData(0, 0, W, H);
  const srcData = srcImage.data;
  const outImage = octx.getImageData(0, 0, W, H);
  const outData = outImage.data;
  const useNearest = filter === "nearest" || filter === "nearest-exact";
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const centerX = W / 2;
  const centerY = H / 2;
  const invScale = 1 / safeScale;

  for (let y = 0; y < H; y++) {
    const py = y + 0.5 - (centerY + ty);
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - (centerX + tx);
      let sx = (cos * px + sin * py) * invScale + centerX - 0.5;
      let sy = (-sin * px + cos * py) * invScale + centerY - 0.5;
      const inside = sx >= 0 && sx <= (W - 1) && sy >= 0 && sy <= (H - 1);
      if (!inside) {
        if (normalizedFill === "expand") {
          sx = Math.max(0, Math.min(W - 1, sx));
          sy = Math.max(0, Math.min(H - 1, sy));
        } else if (normalizedFill === "mirror") {
          sx = reflectCoord(sx, W - 1);
          sy = reflectCoord(sy, H - 1);
        } else {
          continue;
        }
      }

      const offset = (y * W + x) * 4;
      const sr = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 0) : sampleChannelBilinear(srcData, W, H, sx, sy, 0);
      const sg = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 1) : sampleChannelBilinear(srcData, W, H, sx, sy, 1);
      const sb = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 2) : sampleChannelBilinear(srcData, W, H, sx, sy, 2);
      const sa = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 3) : sampleChannelBilinear(srcData, W, H, sx, sy, 3);

      const fgA = clamp01(sa / 255);
      const bgA = clamp01(outData[offset + 3] / 255);
      const outA = fgA + bgA * (1 - fgA);
      const bgR = outData[offset] / 255;
      const bgG = outData[offset + 1] / 255;
      const bgB = outData[offset + 2] / 255;
      const premulR = (sr / 255) * fgA + bgR * bgA * (1 - fgA);
      const premulG = (sg / 255) * fgA + bgG * bgA * (1 - fgA);
      const premulB = (sb / 255) * fgA + bgB * bgA * (1 - fgA);

      outData[offset] = outA > 1e-6 ? Math.round(clamp01(premulR / outA) * 255) : 0;
      outData[offset + 1] = outA > 1e-6 ? Math.round(clamp01(premulG / outA) * 255) : 0;
      outData[offset + 2] = outA > 1e-6 ? Math.round(clamp01(premulB / outA) * 255) : 0;
      outData[offset + 3] = Math.round(clamp01(outA) * 255);
    }
  }

  octx.putImageData(outImage, 0, 0);
  return output;
}

export function applyGlow(ctx: CanvasRenderingContext2D, W: number, H: number, threshold: number, intensity: number, blurPx: number): void {
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
  const tctx=tmp.getContext("2d", { willReadFrequently: true })!;
  tctx.putImageData(new ImageData(hi,W,H),0,0);

  const blur=document.createElement("canvas");
  blur.width=W; blur.height=H;
  const bctx=blur.getContext("2d", { willReadFrequently: true })!;
  bctx.filter=`blur(${Math.max(0,blurPx)}px)`;
  bctx.drawImage(tmp,0,0);
  bctx.filter="none";

  ctx.save();
  ctx.globalAlpha=Math.max(0,Math.min(1,intensity));
  ctx.globalCompositeOperation="lighter";
  ctx.drawImage(blur,0,0);
  ctx.restore();
}

export function applyCropReformat(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, cw: number, ch: number, padding: number, outW: number, outH: number, mode: string): void {
  const cropW=Math.max(1,Math.round(cw));
  const cropH=Math.max(1,Math.round(ch));
  const pad=Math.max(0,Math.round(padding));

  const tmp=document.createElement("canvas");
  tmp.width=cropW+pad*2;
  tmp.height=cropH+pad*2;
  const tctx=tmp.getContext("2d", { willReadFrequently: true })!;
  tctx.clearRect(0,0,tmp.width,tmp.height);
  tctx.drawImage(ctx.canvas, -Math.round(x)+pad, -Math.round(y)+pad);

  const finalW=outW>0?Math.round(outW):tmp.width;
  const finalH=outH>0?Math.round(outH):tmp.height;

  const dst=document.createElement("canvas");
  dst.width=finalW;
  dst.height=finalH;
  const dctx=dst.getContext("2d", { willReadFrequently: true })!;
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

export function applyCrop(
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
  const octx = output.getContext("2d", { willReadFrequently: true })!;
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

export function resolvePadOutGeometry(sourceWidth: number, sourceHeight: number, node: ComfyNode, frameIndex: number = 0): {
  padLeft: number;
  padTop: number;
  padRight: number;
  padBottom: number;
  outWidth: number;
  outHeight: number;
} {
  const snap = Math.max(1, Math.round(numAny(node, ["snap_to_multiple"], 1, frameIndex)));
  const snapPad = (value: number): number => snap <= 1 ? Math.max(0, Math.round(value)) : Math.max(0, Math.round(Math.round(value) / snap) * snap);
  let padLeft = snapPad(numAny(node, ["pad_left"], 0, frameIndex));
  let padTop = snapPad(numAny(node, ["pad_top"], 0, frameIndex));
  let padRight = snapPad(numAny(node, ["pad_right"], 0, frameIndex));
  let padBottom = snapPad(numAny(node, ["pad_bottom"], 0, frameIndex));
  const outWidth = Math.max(1, sourceWidth + padLeft + padRight);
  const outHeight = Math.max(1, sourceHeight + padTop + padBottom);
  return { padLeft, padTop, padRight, padBottom, outWidth, outHeight };
}

export function renderPadOutCanvases(
  node: ComfyNode,
  source: HTMLCanvasElement,
  frameIndex: number = 0,
  applyInvertMask: boolean = true,
): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const invertMask = applyInvertMask && boolAny(node, ["invert_mask"], false, frameIndex);

  const sourceWidth = source.width || 1;
  const sourceHeight = source.height || 1;
  const { padLeft, padTop, padRight, padBottom, outWidth, outHeight } = resolvePadOutGeometry(sourceWidth, sourceHeight, node, frameIndex);

  const image = makeCanvas(outWidth, outHeight);
  const imageCtx = image.getContext("2d", { willReadFrequently: true })!;
  imageCtx.fillStyle = "#000000";
  imageCtx.fillRect(0, 0, outWidth, outHeight);
  imageCtx.drawImage(source, padLeft, padTop, sourceWidth, sourceHeight);

  const mask = makeCanvas(outWidth, outHeight);
  const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
  // Prepared mask format: RGB=255, A=mask_value. New canvas is transparent (A=0 = mask=0).
  if (invertMask) {
    // Inverted: center = mask=1 (opaque white), border = mask=0 (transparent)
    maskCtx.fillStyle = "#FFFFFF";
    maskCtx.fillRect(padLeft, padTop, sourceWidth, sourceHeight);
  } else {
    // Default: border = mask=1 (opaque white), center = mask=0 (transparent)
    maskCtx.fillStyle = "#FFFFFF";
    maskCtx.fillRect(0, 0, outWidth, outHeight);
    maskCtx.clearRect(padLeft, padTop, sourceWidth, sourceHeight);
  }
  markPreparedMaskCanvas(mask);

  return { image, mask };
}

export function solveLinear8x8(matrix: number[][], vector: number[]): number[] | null {
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

export function invert3x3(m: number[]): number[] | null {
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

export function solveCornerPinInverseHomography(node: ComfyNode, width: number, height: number, frameIndex: number = 0): number[] | null {
  const src = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)],
  ];
  const dst = [
    [numAny(node, ["tl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["tl_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["tr_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["tr_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["bl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["bl_y"], 1, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["br_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["br_y"], 1, frameIndex) * Math.max(0, height - 1)],
  ];

  const A: number[][] = [];
  const b: number[] = [];
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

export function reflectCoord(value: number, maxInclusive: number): number {
  if (maxInclusive <= 0) return 0;
  const period = maxInclusive * 2;
  let x = value % period;
  if (x < 0) x += period;
  if (x > maxInclusive) x = period - x;
  return x;
}

export function sampleChannelNearest(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
  const ix = Math.max(0, Math.min(width - 1, Math.round(x)));
  const iy = Math.max(0, Math.min(height - 1, Math.round(y)));
  return data[(iy * width + ix) * 4 + channel];
}

export function sampleChannelBilinear(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
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

export function cubicHermite(a: number, b: number, c: number, d: number, t: number): number {
  const a1 = -0.5 * a + 1.5 * b - 1.5 * c + 0.5 * d;
  const a2 = a - 2.5 * b + 2 * c - 0.5 * d;
  const a3 = -0.5 * a + 0.5 * c;
  return ((a1 * t + a2) * t + a3) * t + b;
}

export function sampleChannelBicubic(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, channel: number): number {
  const x1 = Math.floor(x);
  const y1 = Math.floor(y);
  const tx = x - x1;
  const ty = y - y1;
  const rows = new Array<number>(4);
  for (let row = -1; row <= 2; row++) {
    const iy = Math.max(0, Math.min(height - 1, y1 + row));
    const p0 = data[(iy * width + Math.max(0, Math.min(width - 1, x1 - 1))) * 4 + channel];
    const p1 = data[(iy * width + Math.max(0, Math.min(width - 1, x1))) * 4 + channel];
    const p2 = data[(iy * width + Math.max(0, Math.min(width - 1, x1 + 1))) * 4 + channel];
    const p3 = data[(iy * width + Math.max(0, Math.min(width - 1, x1 + 2))) * 4 + channel];
    rows[row + 1] = cubicHermite(p0, p1, p2, p3, tx);
  }
  return cubicHermite(rows[0], rows[1], rows[2], rows[3], ty);
}

export function solveInverseHomographyFromCorners(
  sourceWidth: number,
  sourceHeight: number,
  corners: Record<CornerPinHandle, { x: number; y: number }>,
): number[] | null {
  const src = [
    [0, 0],
    [Math.max(0, sourceWidth - 1), 0],
    [0, Math.max(0, sourceHeight - 1)],
    [Math.max(0, sourceWidth - 1), Math.max(0, sourceHeight - 1)],
  ];
  const dst = [
    [corners.tl.x, corners.tl.y],
    [corners.tr.x, corners.tr.y],
    [corners.bl.x, corners.bl.y],
    [corners.br.x, corners.br.y],
  ];
  const A: number[][] = [];
  const b: number[] = [];
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
  return invert3x3([solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1]);
}

export function warpCanvasToQuad(
  source: HTMLCanvasElement,
  outputWidth: number,
  outputHeight: number,
  corners: Record<CornerPinHandle, { x: number; y: number }>,
  filter: string = "bilinear",
): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const width = source.width || 1;
  const height = source.height || 1;
  const inverse = solveInverseHomographyFromCorners(width, height, corners);
  const image = makeCanvas(outputWidth, outputHeight);
  const mask = makeCanvas(outputWidth, outputHeight);
  if (!inverse) {
    markPreparedMaskCanvas(mask);
    return { image, mask };
  }

  const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
  const srcImage = sourceCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;
  const imageCtx = image.getContext("2d", { willReadFrequently: true })!;
  const outImage = imageCtx.createImageData(outputWidth, outputHeight);
  const outData = outImage.data;
  const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
  const outMask = maskCtx.createImageData(outputWidth, outputHeight);
  const outMaskData = outMask.data;
  const useNearest = filter === "nearest";
  const useBicubic = filter === "bicubic";

  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const outOffset = (y * outputWidth + x) * 4;
      const denom = inverse[6] * x + inverse[7] * y + inverse[8];
      const safeDenom = Math.abs(denom) < 1e-8 ? (denom < 0 ? -1e-8 : 1e-8) : denom;
      const sx = (inverse[0] * x + inverse[1] * y + inverse[2]) / safeDenom;
      const sy = (inverse[3] * x + inverse[4] * y + inverse[5]) / safeDenom;
      const inside = sx >= 0 && sx <= (width - 1) && sy >= 0 && sy <= (height - 1);
      if (!inside) continue;

      const r = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 0)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 0)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
      const g = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 1)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 1)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
      const b = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 2)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 2)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
      const a = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 3)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 3)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
      outData[outOffset] = Math.round(clamp01(r / 255) * 255);
      outData[outOffset + 1] = Math.round(clamp01(g / 255) * 255);
      outData[outOffset + 2] = Math.round(clamp01(b / 255) * 255);
      outData[outOffset + 3] = Math.round(clamp01(a / 255) * 255);
      const alpha = Math.round(clamp01(a / 255) * 255);
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = alpha;
    }
  }

  imageCtx.putImageData(outImage, 0, 0);
  maskCtx.putImageData(outMask, 0, 0);
  markPreparedMaskCanvas(mask);
  return { image, mask };
}

export function renderCornerPinCanvases(
  node: ComfyNode,
  source: HTMLCanvasElement,
  frameIndex: number = 0,
): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const width = source.width || 1;
  const height = source.height || 1;
  const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
  const fillMode = normalizeAffineFillMode(strAny(node, ["fill_mode", "edge_mode"], "transparent", frameIndex));
  const fillColor = parseHexColor(strAny(node, ["fill_color"], "#000000", frameIndex));
  const supersample = Math.max(1, Math.min(4, Math.round(numAny(node, ["supersample"], 1, frameIndex))));
  const invertMask = boolAny(node, ["invert_mask"], false, frameIndex);
  const bypass = boolAny(node, ["bypass"], false, frameIndex);

  if (bypass) {
    const image = fitCanvas(source, width, height);
    const mask = makeCanvas(width, height);
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    if (!invertMask) {
      // mask=1 everywhere (white opaque) — new canvas is already transparent so only fill when mask=1
      maskCtx.fillStyle = "#FFFFFF";
      maskCtx.fillRect(0, 0, width, height);
    }
    // else mask=0 everywhere → canvas stays transparent (A=0)
    markPreparedMaskCanvas(mask);
    return { image, mask };
  }

  const inverse = solveCornerPinInverseHomography(node, width, height, frameIndex);
  if (!inverse) {
    const image = fitCanvas(source, width, height);
    const mask = makeCanvas(width, height);
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    if (invertMask) {
      // inverted + no valid transform → mask=1 everywhere
      maskCtx.fillStyle = "#FFFFFF";
      maskCtx.fillRect(0, 0, width, height);
    }
    // else mask=0 everywhere → canvas stays transparent (A=0)
    markPreparedMaskCanvas(mask);
    return { image, mask };
  }

  const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
  const srcImage = sourceCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;

  const image = makeCanvas(width, height);
  const imageCtx = image.getContext("2d", { willReadFrequently: true })!;
  if (fillMode === "color") {
    imageCtx.fillStyle = fillColor;
    imageCtx.fillRect(0, 0, width, height);
  } else if (fillMode === "stretch") {
    imageCtx.drawImage(source, 0, 0, width, height);
  }
  const outImage = imageCtx.getImageData(0, 0, width, height);
  const outData = outImage.data;

  const mask = makeCanvas(width, height);
  const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
  const outMask = maskCtx.createImageData(width, height);
  const outMaskData = outMask.data;

  const useNearest = filter === "nearest";
  const useBicubic = filter === "bicubic";
  const sampleCount = supersample * supersample;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outOffset = (y * width + x) * 4;
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;
      let alphaSum = 0;
      let insideSum = 0;
      // Track per-subsample coverage*alpha so the mask edge is supersampled
      // in lockstep with the colour: avg(cov_i * alpha_i) is more faithful than
      // avg(cov_i) * avg(alpha_i) on transparent or semi-covered edges.
      let coveredAlphaSum = 0;

      for (let subY = 0; subY < supersample; subY++) {
        const dstY = supersample === 1 ? y : y + (subY + 0.5) / supersample - 0.5;
        for (let subX = 0; subX < supersample; subX++) {
          const dstX = supersample === 1 ? x : x + (subX + 0.5) / supersample - 0.5;
          const denom = inverse[6] * dstX + inverse[7] * dstY + inverse[8];
          const safeDenom = Math.abs(denom) < 1e-8 ? (denom < 0 ? -1e-8 : 1e-8) : denom;
          let sx = (inverse[0] * dstX + inverse[1] * dstY + inverse[2]) / safeDenom;
          let sy = (inverse[3] * dstX + inverse[4] * dstY + inverse[5]) / safeDenom;
          const inside = sx >= 0 && sx <= (width - 1) && sy >= 0 && sy <= (height - 1);
          if (inside) insideSum += 1;
          if (!inside) {
            if (fillMode === "expand") {
              sx = Math.max(0, Math.min(width - 1, sx));
              sy = Math.max(0, Math.min(height - 1, sy));
            } else if (fillMode === "mirror") {
              sx = reflectCoord(sx, width - 1);
              sy = reflectCoord(sy, height - 1);
            } else {
              continue;
            }
          }

          const r = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 0)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 0)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
          const g = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 1)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 1)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
          const b = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 2)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 2)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
          const a = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 3)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 3)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
          premulR += r * (a / 255);
          premulG += g * (a / 255);
          premulB += b * (a / 255);
          alphaSum += a;
          if (inside) coveredAlphaSum += a;
        }
      }

      const alpha = alphaSum / sampleCount;
      const alpha01 = alpha / 255;
      const fgR = alpha01 > 1e-6 ? clamp01((premulR / sampleCount) / alpha01 / 255) : 0;
      const fgG = alpha01 > 1e-6 ? clamp01((premulG / sampleCount) / alpha01 / 255) : 0;
      const fgB = alpha01 > 1e-6 ? clamp01((premulB / sampleCount) / alpha01 / 255) : 0;
      const bgA = clamp01(outData[outOffset + 3] / 255);
      const bgR = outData[outOffset] / 255;
      const bgG = outData[outOffset + 1] / 255;
      const bgB = outData[outOffset + 2] / 255;
      const outA = alpha01 + bgA * (1 - alpha01);
      const premulOutR = fgR * alpha01 + bgR * bgA * (1 - alpha01);
      const premulOutG = fgG * alpha01 + bgG * bgA * (1 - alpha01);
      const premulOutB = fgB * alpha01 + bgB * bgA * (1 - alpha01);
      outData[outOffset] = outA > 1e-6 ? Math.round(clamp01(premulOutR / outA) * 255) : 0;
      outData[outOffset + 1] = outA > 1e-6 ? Math.round(clamp01(premulOutG / outA) * 255) : 0;
      outData[outOffset + 2] = outA > 1e-6 ? Math.round(clamp01(premulOutB / outA) * 255) : 0;
      outData[outOffset + 3] = Math.round(clamp01(outA) * 255);

      const maskValue = fillMode === "transparent"
        ? Math.round(clamp01(coveredAlphaSum / sampleCount / 255) * 255)
        : 255;
      const finalMask = invertMask ? 255 - maskValue : maskValue;
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = finalMask;
    }
  }

  imageCtx.putImageData(outImage, 0, 0);
  maskCtx.putImageData(outMask, 0, 0);
  markPreparedMaskCanvas(mask);
  return { image, mask };
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

export function maskConvertSourceValue(
  data: Uint8ClampedArray,
  index: number,
  sourceMode: string,
  useAlpha: boolean,
  lumaWeights: number[],
): number {
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

export function applyEffectToCanvas(
  source: HTMLCanvasElement,
  effect: (ctx: CanvasRenderingContext2D, width: number, height: number) => HTMLCanvasElement | void,
): HTMLCanvasElement {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const copyCtx = output.getContext("2d", { willReadFrequently: true })!;
  copyCtx.drawImage(source, 0, 0, output.width, output.height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  const result = effect(octx, output.width, output.height);
  return result instanceof HTMLCanvasElement ? result : output;
}

export function resolvePreviewMaskCanvas(
  node: ComfyNode,
  source: HTMLCanvasElement,
  rawMask: HTMLCanvasElement | null,
  frameIndex: number = 0,
): HTMLCanvasElement | null {
  if (!rawMask) return null;
  const matte = buildMaskAlphaCanvas(rawMask, source.width || 1, source.height || 1);
  return boolAny(node, ["invert_mask"], false, frameIndex) ? invertMaskCanvas(matte) : matte;
}

export function compositeProcessedWithMask(
  baseCanvas: HTMLCanvasElement,
  processedCanvas: HTMLCanvasElement,
  maskCanvas: HTMLCanvasElement | null,
): HTMLCanvasElement {
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

export function renderMaskedEffectPreview(
  node: ComfyNode,
  source: HTMLCanvasElement,
  rawMask: HTMLCanvasElement | null,
  processImage: (input: HTMLCanvasElement) => HTMLCanvasElement,
  options: {
    premultBeforeProcess?: boolean;
    processMask?: ((mask: HTMLCanvasElement) => HTMLCanvasElement) | null;
    baseCanvas?: HTMLCanvasElement | null;
    compositeWithBase?: boolean;
    frameIndex?: number;
  } = {},
): HTMLCanvasElement {
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

export function renderSpherizeMaskCanvas(
  node: ComfyNode,
  source: HTMLCanvasElement,
  rawMask: HTMLCanvasElement | null,
  frameIndex: number = 0,
): HTMLCanvasElement {
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

export function renderCompPreview(
  node: ComfyNode,
  inputLayers: Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number; sourceWidth?: number; sourceHeight?: number }>,
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
    centerX: number;
    centerY: number;
    drawWidth: number;
    drawHeight: number;
    rotationDeg: number;
    corners: Record<CornerPinHandle, { x: number; y: number }> | null;
    cornerPinned: boolean;
  }>;
} {
  const slots = getCompSlots(node);
  const allLayers = syncCompLayers(str(node, "layers_json", ""), slots);
  const layerBySlot = new Map(allLayers.map((layer) => [layer.slot, layer]));
  const firstInput = inputLayers[0] ?? null;
  const useAutoLayering = bool(node, "auto_layering", false);
  const useFirst = bool(node, "use_first_layer_size", true);
  const largestWidth = inputLayers.reduce((value, entry) => Math.max(value, entry.sourceWidth || entry.image.width || 1), 1);
  const largestHeight = inputLayers.reduce((value, entry) => Math.max(value, entry.sourceHeight || entry.image.height || 1), 1);
  const customAspect = str(node, "aspect_ratio", "custom").trim().toLowerCase();
  const customRatio = customAspect === "1:1" || customAspect === "1/1"
    ? 1
    : customAspect === "3:4" || customAspect === "3/4"
      ? 3 / 4
      : customAspect === "4:3" || customAspect === "4/3"
        ? 4 / 3
        : customAspect === "16:9" || customAspect === "16/9"
          ? 16 / 9
          : customAspect === "9:16" || customAspect === "9/16"
            ? 9 / 16
            : null;
  const outputWidth = useAutoLayering
    ? largestWidth
    : useFirst && firstInput
      ? Math.max(1, firstInput.sourceWidth || firstInput.image.width || 1)
      : Math.max(1, Math.round(num(node, "width", firstInput?.sourceWidth ?? firstInput?.image.width ?? 1024)));
  const outputHeight = useAutoLayering
    ? largestHeight
    : useFirst && firstInput
      ? Math.max(1, firstInput.sourceHeight || firstInput.image.height || 1)
      : customRatio
        ? Math.max(1, Math.round(outputWidth / customRatio))
        : Math.max(1, Math.round(num(node, "height", firstInput?.sourceHeight ?? firstInput?.image.height ?? 1024)));
  // Reflect the actually-used dimensions back into the width/height widgets when
  // they're being overridden by `use_first_layer_size` or `auto_layering`, so the
  // user always sees the real output size in the UI.
  if ((useAutoLayering || (useFirst && firstInput) || (!useFirst && !useAutoLayering && customRatio))) {
    const ww = w(node, "width");
    const hw = w(node, "height");
    setWidgetValue(ww, outputWidth);
    setWidgetValue(hw, outputHeight);
  }
  const output = makeCanvas(outputWidth, outputHeight);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  const alphaCanvas = makeCanvas(outputWidth, outputHeight);
  const alphaCtx = alphaCanvas.getContext("2d", { willReadFrequently: true })!;
  octx.fillStyle = parseHexColor(str(node, "background_color", "#000000"));
  octx.fillRect(0, 0, outputWidth, outputHeight);
  alphaCtx.clearRect(0, 0, outputWidth, outputHeight);

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
    centerX: number;
    centerY: number;
    drawWidth: number;
    drawHeight: number;
    rotationDeg: number;
    corners: Record<CornerPinHandle, { x: number; y: number }> | null;
    cornerPinned: boolean;
  }> = [];

  for (let index = 0; index < inputLayers.length; index++) {
    const entry = inputLayers[index];
    const input = premultLayerWithMask(entry.image, entry.mask ?? null);
    const layer = layerBySlot.get(entry.slot);
    if (!input || !layer || layer.enabled === false) continue;

    const sourceWidth = Math.max(1, entry.sourceWidth || entry.image.width || 1);
    const sourceHeight = Math.max(1, entry.sourceHeight || entry.image.height || 1);

    const rect = computeCompRect(outputWidth, outputHeight, sourceWidth, sourceHeight, layer);
    const corners = getCompLayerOutputCorners(outputWidth, outputHeight, sourceWidth, sourceHeight, layer);
    const cornerPinned = hasCompLayerCornerPin(layer);
    geometries.push({
      slot: entry.slot,
      layerNumber: entry.layerNumber,
      inputIndex: entry.inputIndex,
      sourceWidth,
      sourceHeight,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      centerX: rect.centerX,
      centerY: rect.centerY,
      drawWidth: rect.drawWidth,
      drawHeight: rect.drawHeight,
      rotationDeg: rect.rotationDeg,
      corners,
      cornerPinned,
    });

    if (cornerPinned) {
      const warped = warpCanvasToQuad(input, outputWidth, outputHeight, corners, "bilinear");
      octx.save();
      octx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      octx.globalCompositeOperation = compModeToCanvasOp(layer.mode);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = "high";
      octx.drawImage(warped.image, 0, 0, outputWidth, outputHeight);
      octx.restore();

      alphaCtx.save();
      alphaCtx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
      alphaCtx.globalCompositeOperation = "source-over";
      alphaCtx.imageSmoothingEnabled = true;
      alphaCtx.imageSmoothingQuality = "high";
      alphaCtx.drawImage(warped.mask, 0, 0, outputWidth, outputHeight);
      alphaCtx.restore();
      continue;
    }

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

export function resolveCompPreviewInputs(
  node: ComfyNode,
  inputs: HTMLCanvasElement[],
): Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number }> {
  const connectedSlots = getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null);
  const resolved: Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number }> = [];
  let cursor = 0;
  for (const slot of connectedSlots) {
    const image = inputs[cursor++] ?? null;
    if (!image) continue;
    let mask: HTMLCanvasElement | null = null;
    if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
      mask = inputs[cursor++] ?? null;
    }
    resolved.push({
      image,
      mask,
      slot: slot.slot,
      layerNumber: slot.layerNumber,
      inputIndex: slot.inputIndex,
    });
  }
  return resolved;
}

export async function renderDrawNodePreview(node: ComfyNode, baseCanvas: HTMLCanvasElement | null = null): Promise<HTMLCanvasElement> {
  return await renderDrawPreview(node, baseCanvas);
}

export function applyLumaKey(ctx: CanvasRenderingContext2D, W: number, H: number, low: number, high: number, softness: number): void {
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

// W3C composite spec D() helper for soft-light — matches Python's _soft_light_curve.
export function rgbToHsv01(r: number, g: number, b: number): [number, number, number] {
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
  return [hue, sat, max];
}

export function smoothRange01(value: number, low: number, high: number, softness: number): number {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const soft = Math.max(0, softness);
  if (soft <= 0.000001) return value >= lo && value <= hi ? 1 : 0;
  const lower = clamp01((value - (lo - soft)) / soft);
  const upper = clamp01(((hi + soft) - value) / soft);
  const smoothLower = lower * lower * (3 - 2 * lower);
  const smoothUpper = upper * upper * (3 - 2 * upper);
  return clamp01(Math.min(smoothLower, smoothUpper));
}

export function softKeyDistance(distance: number, tolerance: number, softness: number): number {
  const tol = clamp01(tolerance);
  const soft = clamp01(softness);
  if (soft <= 0.000001) return distance <= tol ? 1 : 0;
  const t = clamp01((tol + soft - distance) / soft);
  return t * t * (3 - 2 * t);
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

export function parseKeyColors(value: string | null | undefined): Array<[number, number, number]> {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Array<[number, number, number]> = [];
    for (const item of parsed) {
      if (typeof item === "string") out.push(hexToRgb01(item));
    }
    return out;
  } catch {
    return [];
  }
}

export function renderKeyerCanvases(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
  const width = source.width || 1;
  const height = source.height || 1;
  const image = makeCanvas(width, height);
  const mask = makeCanvas(width, height);
  const ictx = image.getContext("2d", { willReadFrequently: true })!;
  const mctx = mask.getContext("2d", { willReadFrequently: true })!;
  ictx.drawImage(source, 0, 0, width, height);
  const img = ictx.getImageData(0, 0, width, height);
  const data = img.data;
  const sourceAlpha = new Uint8ClampedArray(data.length / 4);
  const maskImg = mctx.createImageData(width, height);
  const maskData = maskImg.data;
  const extMask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const extData = extMask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;
  const keyMode = strAny(node, ["mode", "key_mode"], "color", frameIndex).toLowerCase();
  const keyColors = parseKeyColors(strAny(node, ["key_colors"], "", frameIndex));
  const keyTargets = keyColors.length > 0 ? keyColors : [hexToRgb01(strAny(node, ["key_color"], "#00ff00", frameIndex))];
  const tolerance = numAny(node, ["tolerance"], 0.25, frameIndex);
  const softness = numAny(node, ["softness"], 0.1, frameIndex);
  const gain = Math.max(0, numAny(node, ["gain"], 1.0, frameIndex));
  const blur = Math.max(0, numAny(node, ["blur"], 0.0, frameIndex));
  const invert = boolAny(node, ["invert"], false, frameIndex);
  const LW = getOpsConstants().luma_weights;
  for (let i = 0; i < data.length; i += 4) {
    sourceAlpha[i / 4] = data[i + 3];
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    let distance = 0;
    if (keyMode === "luma" || keyMode === "luminance") distance = luma01(r, g, b, LW);
    else {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const keyColor of keyTargets) {
        minDistance = Math.min(minDistance, Math.hypot(r - keyColor[0], g - keyColor[1], b - keyColor[2]) / Math.sqrt(3));
      }
      distance = Number.isFinite(minDistance) ? minDistance : 0;
    }
    const matte = clamp01((1 - softKeyDistance(distance, tolerance, softness)) * gain);
    maskData[i] = 255;
    maskData[i + 1] = 255;
    maskData[i + 2] = 255;
    maskData[i + 3] = Math.round(matte * 255);
  }
  mctx.putImageData(maskImg, 0, 0);
  const finalMask = blur > 0.001 ? blurMaskCanvas(mask, blur) : mask;
  const finalMaskData = finalMask.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;
  if (finalMaskData) {
    for (let i = 0; i < data.length; i += 4) {
      let matte = finalMaskData[i + 3] / 255;
      if (extData) matte *= extData[i + 3] / 255;
      if (invert) matte = 1 - matte;
      data[i + 3] = Math.round(clamp01((sourceAlpha[i / 4] / 255) * matte) * 255);
    }
  }
  ictx.putImageData(img, 0, 0);
  markPreparedMaskCanvas(finalMask);
  return { image, mask: finalMask };
}

export function srgbToLinear01(value: number): number {
  const v = clamp01(value);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb01(value: number): number {
  const v = clamp01(value);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function normalizeBlendModeName(mode: string): string {
  const normalized = String(mode || "over").toLowerCase().replace(/[-\s]+/g, "_");
  return normalized === "normal" ? "over" : normalized;
}

export function fitMergeForeground(topCanvas: HTMLCanvasElement, width: number, height: number, fitMode: string): HTMLCanvasElement {
  const mode = String(fitMode || "stretch").toLowerCase().replace(/[-\s]+/g, "_");
  const out = makeCanvas(width, height);
  const octx = out.getContext("2d", { willReadFrequently: true })!;
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

export function blend(ctx: CanvasRenderingContext2D, W: number, H: number, topCanvas: HTMLCanvasElement, mode: string, mix: number, foregroundFit: string = "stretch", blendSpace: string = "linear"): void {
  const m=Math.max(0,Math.min(1,mix));
  if (m<=0) return;
  const scaledTop = fitMergeForeground(topCanvas, W, H, foregroundFit);

  const base = getImageData(ctx, W, H);
  const top = scaledTop.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H);
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
      const rr = br * ba + ar * (1 - ba);
      const rg = bg * ba + ag * (1 - ba);
      const rb = bb * ba + ab * (1 - ba);
      const outR = clamp01(ar * (1 - m) + rr * m);
      const outG = clamp01(ag * (1 - m) + rg * m);
      const outB = clamp01(ab * (1 - m) + rb * m);
      const mergedAlpha = ba + aa * (1 - ba);
      const outA = clamp01(aa * (1 - m) + mergedAlpha * m);
      bd[i] = Math.round((linear ? linearToSrgb01(outR) : outR) * 255);
      bd[i + 1] = Math.round((linear ? linearToSrgb01(outG) : outG) * 255);
      bd[i + 2] = Math.round((linear ? linearToSrgb01(outB) : outB) * 255);
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

export function resolveResizeDimensions(node: ComfyNode, sourceWidth: number, sourceHeight: number): { width: number; height: number; mode: string; filter: string; fillColor: string; cropPosition: string } {
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

export function cropRectCanvas(source: HTMLCanvasElement, x: number, y: number, width: number, height: number): HTMLCanvasElement {
  const out = makeCanvas(Math.max(1, width), Math.max(1, height));
  const octx = out.getContext("2d", { willReadFrequently: true })!;
  octx.clearRect(0, 0, out.width, out.height);
  octx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
  return out;
}

export function extractMaskDrivenCrop(source: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null, padding: number, targetWidth: number, targetHeight: number): HTMLCanvasElement {
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

export function parseCropStitchBBox(node: ComfyNode, sourceWidth: number, sourceHeight: number, frameIndex: number = 0): { x: number; y: number; width: number; height: number } | null {
  const raw = resolveConnectedString(node, "crop_bbox") ?? strAny(node, ["crop_bbox", "bbox"], "");
  if (!raw) return null;

  let payload: unknown = raw;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const root = Array.isArray(payload) ? payload[0] : payload;
  if (!root || typeof root !== "object") return null;
  const obj = root as any;
  const frames = Array.isArray(obj.frames) ? obj.frames : null;
  const bbox = frames
    ? frames[Math.max(0, Math.min(frames.length - 1, Math.round(frameIndex)))]
    : obj.bbox;
  if (!bbox || typeof bbox !== "object") return null;

  const width = Math.max(1, Math.min(sourceWidth, Math.round(Number(bbox.width) || sourceWidth)));
  const height = Math.max(1, Math.min(sourceHeight, Math.round(Number(bbox.height) || sourceHeight)));
  const x = Math.max(0, Math.min(sourceWidth - width, Math.round(Number(bbox.x) || 0)));
  const y = Math.max(0, Math.min(sourceHeight - height, Math.round(Number(bbox.y) || 0)));
  return { x, y, width, height };
}

export function cropStitchBBoxFromMask(maskCanvas: HTMLCanvasElement | null, width: number, height: number): { x: number; y: number; width: number; height: number } {
  if (!maskCanvas) return { x: 0, y: 0, width, height };
  const fittedMask = buildMaskAlphaCanvas(maskCanvas, width, height);
  const bounds = computeMaskBounds(fittedMask);
  return bounds ?? { x: 0, y: 0, width, height };
}

export function makeCropStitchRectMask(width: number, height: number, bbox: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const mask = makeCanvas(width, height);
  const mctx = mask.getContext("2d", { willReadFrequently: true })!;
  mctx.clearRect(0, 0, width, height);
  mctx.fillStyle = "#ffffff";
  mctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
  return markPreparedMaskCanvas(mask);
}

export function renderCropStitchCanvases(node: ComfyNode, inputs: HTMLCanvasElement[], frameIndex: number = 0): { image: HTMLCanvasElement; mask: HTMLCanvasElement; crop: HTMLCanvasElement; bbox: { x: number; y: number; width: number; height: number } } {
  const original = inputs[0] ?? makeCanvas(1, 1);
  const crop = inputs[1] ?? original;
  const width = Math.max(1, original.width || 1);
  const height = Math.max(1, original.height || 1);
  const cropMaskInput = inputs[2] ?? null;
  const bbox = parseCropStitchBBox(node, width, height, frameIndex) ?? cropStitchBBoxFromMask(cropMaskInput, width, height);
  const fittedCrop = fitCanvas(crop, bbox.width, bbox.height);

  const stitchLayer = makeCanvas(width, height);
  const layerCtx = stitchLayer.getContext("2d", { willReadFrequently: true })!;
  layerCtx.clearRect(0, 0, width, height);
  layerCtx.drawImage(fittedCrop, bbox.x, bbox.y, bbox.width, bbox.height);

  let mask = cropMaskInput
    ? buildMaskAlphaCanvas(cropMaskInput, width, height)
    : makeCropStitchRectMask(width, height, bbox);
  const feather = Math.max(0, Math.round(numAny(node, ["feather"], 0, frameIndex)));
  if (feather > 0) mask = blurMaskAlphaCanvas(mask, feather);

  const image = boolAny(node, ["bypass"], false, frameIndex)
    ? original
    : compositeProcessedWithMask(original, stitchLayer, mask);
  return { image, mask, crop: fittedCrop, bbox };
}

export function drawCropStitchPanel(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  bbox?: { x: number; y: number; width: number; height: number } | null,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(x, y, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);

  const scale = Math.min(width / Math.max(1, source.width || 1), height / Math.max(1, source.height || 1));
  const drawWidth = Math.max(1, Math.round((source.width || 1) * scale));
  const drawHeight = Math.max(1, Math.round((source.height || 1) * scale));
  const dx = x + Math.round((width - drawWidth) / 2);
  const dy = y + Math.round((height - drawHeight) / 2);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, dx, dy, drawWidth, drawHeight);

  if (bbox) {
    const sx = drawWidth / Math.max(1, source.width || 1);
    const sy = drawHeight / Math.max(1, source.height || 1);
    ctx.strokeStyle = "rgba(235,239,140,0.96)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(dx + bbox.x * sx + 0.5, dy + bbox.y * sy + 0.5, bbox.width * sx, bbox.height * sy);
  }

  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.fillRect(x, y, Math.min(width, 92), 20);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "11px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 7, y + 10);
  ctx.restore();
}

export function composeCropStitchPreview(image: HTMLCanvasElement, crop: HTMLCanvasElement, mask: HTMLCanvasElement, bbox: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
  const maskPreview = maskCanvasToPreviewCanvas(mask);
  const mainW = Math.max(1, image.width || 1);
  const mainH = Math.max(1, image.height || 1);
  const gap = Math.max(8, Math.round(Math.min(mainW, mainH) * 0.025));
  const sideW = Math.max(96, Math.round(mainW * 0.42));
  const sideH = Math.max(64, Math.round((mainH - gap) / 2));
  const output = makeCanvas(mainW + gap + sideW, Math.max(mainH, sideH * 2 + gap));
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.fillStyle = "#111111";
  octx.fillRect(0, 0, output.width, output.height);
  drawCropStitchPanel(octx, image, 0, 0, mainW, output.height, "Stitched", bbox);
  drawCropStitchPanel(octx, crop, mainW + gap, 0, sideW, sideH, "Edited crop");
  drawCropStitchPanel(octx, maskPreview, mainW + gap, sideH + gap, sideW, sideH, "Crop mask");
  return output;
}

export function stitchCanvases(a: HTMLCanvasElement, b: HTMLCanvasElement, direction: string, spacingWidth: number, spacingColor: string, matchSize: boolean): HTMLCanvasElement {
  const normalizedDirection = String(direction || "right").toLowerCase();
  const spacing = Math.max(0, Math.round(spacingWidth));
  const second = matchSize
    ? resizeWithMode(b, normalizedDirection === "up" || normalizedDirection === "down" ? a.width : b.width, normalizedDirection === "right" || normalizedDirection === "left" ? a.height : b.height, "bicubic", "stretch")
    : b;

  const horizontal = normalizedDirection === "right" || normalizedDirection === "left";
  const width = horizontal ? a.width + second.width + spacing : Math.max(a.width, second.width);
  const height = horizontal ? Math.max(a.height, second.height) : a.height + second.height + spacing;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
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

export function extractSplitChannelCanvas(source: HTMLCanvasElement, outputSlot: number | null, mode: string): HTMLCanvasElement {
  const normalizedMode = String(mode || "rgba").toLowerCase();
  const channelIndex = Math.max(0, Math.min(3, outputSlot ?? 0));
  const output = makeCanvas(source.width || 1, source.height || 1);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
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

export function mergeChannelInputs(inputs: HTMLCanvasElement[], mode: string): HTMLCanvasElement | null {
  if (inputs.length < 3) return null;
  const width = inputs[0].width || 1;
  const height = inputs[0].height || 1;
  const channels = inputs.slice(0, 4).map((input) => fitCanvas(input, width, height));
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  const images = channels.map((canvas) => canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data);
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

export function applySpherize(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: string,
  strength: number,
  invert: boolean,
): void {
  const src = ctx.getImageData(0, 0, width, height);
  const dst = ctx.createImageData(width, height);
  const sd = src.data;
  const dd = dst.data;
  const s = Math.max(0, strength);
  const m = String(mode || "spherize").toLowerCase();

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Normalised coords [-1, 1]
      const nx = (px / (width - 1)) * 2 - 1;
      const ny = (py / (height - 1)) * 2 - 1;
      const dstIdx = (py * width + px) * 4;

      // Outside the unit disk → transparent (only for disk-shaped projections).
      const isDiskMode = m !== "latlong" && m !== "unlatlong";
      if (isDiskMode && nx * nx + ny * ny > 1) {
        dd[dstIdx] = 0;
        dd[dstIdx + 1] = 0;
        dd[dstIdx + 2] = 0;
        dd[dstIdx + 3] = 0;
        continue;
      }

      let srcNx: number;
      let srcNy: number;

      if (!invert) {
        [srcNx, srcNy] = _spherizeMapFwd(nx, ny, m, s);
      } else {
        [srcNx, srcNy] = _spherizeMapInv(nx, ny, m, s);
      }

      // Back to pixel coords
      const sx = ((srcNx + 1) * 0.5) * (width - 1);
      const sy = ((srcNy + 1) * 0.5) * (height - 1);

      // Bilinear sample
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;

      // Clamp to image borders
      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      for (let c = 0; c < 4; c++) {
        const v00 = sd[(cy0 * width + cx0) * 4 + c];
        const v10 = sd[(cy0 * width + cx1) * 4 + c];
        const v01 = sd[(cy1 * width + cx0) * 4 + c];
        const v11 = sd[(cy1 * width + cx1) * 4 + c];
        dd[dstIdx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy,
        );
      }
    }
  }
  ctx.putImageData(dst, 0, 0);
}

export function _spherizeMapFwd(nx: number, ny: number, mode: string, s: number): [number, number] {
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r < 1e-7) return [0, 0];

  if (mode === "spherize") {
    const t = r * Math.PI * 0.5;
    const scale = (Math.sin(t) / r) * s + (1 - s);
    return [nx * scale, ny * scale];
  }
  if (mode === "fisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rSrc = Math.sin(angle);
    return [nx / r * rSrc, ny / r * rSrc];
  }
  if (mode === "defisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rDst = Math.tan(Math.min(angle, 1.5)) / (Math.PI * 0.5 * s + 1e-8);
    const scale = rDst / (r + 1e-8);
    return [nx * scale, ny * scale];
  }
  if (mode === "latlong") {
    // Equirectangular → rectilinear: barrel-like, no tan singularity.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const lon = Math.atan(nx * fovTan);
    const lat = Math.atan(ny * fovTan);
    return [lon / atanFov, lat / atanFov];
  }
  if (mode === "unlatlong") {
    // Rectilinear → equirectangular: pincushion-like, inverse of latlong.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const clamp = atanFov * 0.9999;
    const srcX = Math.tan(Math.max(-clamp, Math.min(clamp, nx * atanFov))) / fovTan;
    const srcY = Math.tan(Math.max(-clamp, Math.min(clamp, ny * atanFov))) / fovTan;
    return [srcX, srcY];
  }
  return [nx, ny];
}

export function _spherizeMapInv(nx: number, ny: number, mode: string, s: number): [number, number] {
  const r = Math.sqrt(nx * nx + ny * ny);
  if (r < 1e-7) return [0, 0];

  if (mode === "spherize") {
    const rClamped = Math.min(r, 1);
    const scale = (Math.asin(rClamped) / (Math.PI * 0.5 * r + 1e-8)) * s + (1 - s);
    return [nx * scale, ny * scale];
  }
  if (mode === "fisheye") {
    // inverse fisheye = defisheye
    return _spherizeMapFwd(nx, ny, "defisheye", s);
  }
  if (mode === "defisheye") {
    return _spherizeMapFwd(nx, ny, "fisheye", s);
  }
  if (mode === "latlong") {
    return _spherizeMapFwd(nx, ny, "unlatlong", s);
  }
  if (mode === "unlatlong") {
    return _spherizeMapFwd(nx, ny, "latlong", s);
  }
  return [nx, ny];
}

export const ops = {
  colorAjust(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyColorCorrectReference(effectCtx, width, height,
          numAny(node, ["temperature"], 0, frameIndex),
          numAny(node, ["tint"], 0, frameIndex),
          numAny(node, ["hue", "hue_deg"], 0, frameIndex),
          numAny(node, ["brightness"], 0, frameIndex),
          numAny(node, ["contrast"], 0, frameIndex),
          numAny(node, ["saturation", "sat"], 0, frameIndex),
          numAny(node, ["vibrance"], 0, frameIndex),
          numAny(node, ["gamma"], 1, frameIndex),
          numAny(node, ["shadows_hue"], 0, frameIndex),
          numAny(node, ["shadows_amount"], 0, frameIndex),
          numAny(node, ["midtones_hue"], 0, frameIndex),
          numAny(node, ["midtones_amount"], 0, frameIndex),
          numAny(node, ["highlights_hue"], 0, frameIndex),
          numAny(node, ["highlights_amount"], 0, frameIndex),
          {
            shadowsTemperature: numAny(node, ["shadows_temperature"], 0, frameIndex),
            shadowsTint: numAny(node, ["shadows_tint"], 0, frameIndex),
            shadowsContrast: numAny(node, ["shadows_contrast"], 0, frameIndex),
            shadowsSaturation: numAny(node, ["shadows_saturation"], 0, frameIndex),
            shadowsVibrance: numAny(node, ["shadows_vibrance"], 0, frameIndex),
            shadowsGamma: numAny(node, ["shadows_gamma"], 1, frameIndex),
            shadowsBrightness: numAny(node, ["shadows_brightness"], 0, frameIndex),
            midtonesTemperature: numAny(node, ["midtones_temperature"], 0, frameIndex),
            midtonesTint: numAny(node, ["midtones_tint"], 0, frameIndex),
            midtonesContrast: numAny(node, ["midtones_contrast"], 0, frameIndex),
            midtonesSaturation: numAny(node, ["midtones_saturation"], 0, frameIndex),
            midtonesVibrance: numAny(node, ["midtones_vibrance"], 0, frameIndex),
            midtonesGamma: numAny(node, ["midtones_gamma"], 1, frameIndex),
            midtonesBrightness: numAny(node, ["midtones_brightness"], 0, frameIndex),
            highlightsTemperature: numAny(node, ["highlights_temperature"], 0, frameIndex),
            highlightsTint: numAny(node, ["highlights_tint"], 0, frameIndex),
            highlightsContrast: numAny(node, ["highlights_contrast"], 0, frameIndex),
            highlightsSaturation: numAny(node, ["highlights_saturation"], 0, frameIndex),
            highlightsVibrance: numAny(node, ["highlights_vibrance"], 0, frameIndex),
            highlightsGamma: numAny(node, ["highlights_gamma"], 1, frameIndex),
            highlightsBrightness: numAny(node, ["highlights_brightness"], 0, frameIndex),
          },
        );
      }),
      { frameIndex },
    );
  },
  colorCorrect(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    return ops.colorAjust(ctx, W, node, inputs, frameIndex);
  },
  blur(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const radius = numAny(node, ["radius", "blur", "blur_radius"], 0, frameIndex);
    const blurType = strAny(node, ["blur_type"], "gaussian", frameIndex);

    // sigma: for gaussian = std-dev; for surface = colour threshold.
    // Fallback: radius/3 gives a natural Gaussian that matches the backend auto-sigma.
    const sigmaFallback = radius > 0 ? Math.max(0.1, radius / 3) : 0;
    const sigma = numAny(node, ["sigma"], sigmaFallback, frameIndex);

    // Effective CSS blur sigma per type:
    //   gaussian  → sigma (or radius/3 if sigma=0)
    //   box       → approximate Gaussian with same area: sigma ≈ radius/√3
    //   defocus   → disk radius maps to approximately radius/2 sigma
    //   surface   → same apparent softness as Gaussian of same radius
    let cssSigma: number;
    if (blurType === "box") {
      cssSigma = radius > 0 ? Math.max(0.1, radius / Math.sqrt(3)) : 0;
    } else if (blurType === "defocus") {
      cssSigma = radius > 0 ? Math.max(0.1, radius * 0.6) : 0;
    } else {
      // gaussian or surface: use sigma or auto fallback
      cssSigma = sigma > 0 ? sigma : sigmaFallback;
    }

    const blurFn = (input: HTMLCanvasElement) =>
      applyEffectToCanvas(input, (effectCtx, width, height) => {
        applyBlur(effectCtx, width, height, radius, cssSigma);
      });

    if (!rawMask) return blurFn(source);

    const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
    if (!mask) return blurFn(source);

    // GPU-accelerated mask blend: result = source * (1-mask) + blurred * mask.
    // Done with canvas2D compositing instead of a JS pixel loop \u2014 the browser
    // executes drawImage + composite ops on the GPU on most platforms, and we
    // skip three full ImageData round-trips (source/blurred/mask).
    const sw = source.width || 1;
    const sh = source.height || 1;
    const blurred = blurFn(source);
    const fittedMask = buildMaskAlphaCanvas(mask, sw, sh);

    const output = makeCanvas(sw, sh);
    const outCtx = output.getContext("2d", { willReadFrequently: true })!;

    // Step 1: "blurred * mask" goes into a pooled tmp canvas.
    const blurredMasked = acquireCanvas(sw, sh);
    try {
      const bmCtx = blurredMasked.getContext("2d", { willReadFrequently: true })!;
      bmCtx.clearRect(0, 0, sw, sh);
      bmCtx.globalCompositeOperation = "source-over";
      bmCtx.drawImage(blurred, 0, 0);
      bmCtx.globalCompositeOperation = "destination-in";
      bmCtx.drawImage(fittedMask, 0, 0);
      bmCtx.globalCompositeOperation = "source-over";

      // Step 2: lay down source, erase the masked region, then add blurred*mask.
      outCtx.clearRect(0, 0, sw, sh);
      outCtx.drawImage(source, 0, 0);
      outCtx.globalCompositeOperation = "destination-out";
      outCtx.drawImage(fittedMask, 0, 0);
      outCtx.globalCompositeOperation = "source-over";
      outCtx.drawImage(blurredMasked, 0, 0);
    } finally {
      releaseCanvas(blurredMasked);
    }
    return output;
  },
  channel(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot?: number | null, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const splitMode = strAny(node, ["mode"], "RGBA", frameIndex);
    const hasSingleChannelWidget = !!wAny(node, ["channel"]);
    if (!hasSingleChannelWidget && outputSlot != null) {
      return extractSplitChannelCanvas(source, outputSlot, splitMode);
    }
    const extracted = applyEffectToCanvas(source, (effectCtx, width, height) => {
      applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red", frameIndex));
    });
    const ectx = extracted.getContext("2d", { willReadFrequently: true })!;
    const img = ectx.getImageData(0, 0, extracted.width, extracted.height);
    const data = img.data;
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    ectx.putImageData(img, 0, 0);
    return extracted;
  },
  crop,
  cropStitch,
  padOut,
  cornerPin,
  cropGeneric,
  transform,
  cameraShake,
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
  invert(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applyInvert(effectCtx, width, height, boolAny(node, ["invert_alpha"], false, frameIndex));
    });
  },
  clamp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0, frameIndex), numAny(node, ["max_v", "max"], 1, frameIndex));
    });
  },
  grain,
  text,
  keyer,
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
  cropReformat,
  lumaKey(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyLumaKey(ctx,width,height, numAny(node,["low"],0.1), numAny(node,["high"],0.9), numAny(node,["softness"],0.05));
  },
  merge,
  resize,
  pad,
  flipRotate,
  desaturate(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    const factor = numAny(node, ["factor", "amount"], 1);
    applyDesaturate(ctx, width, height, factor);
  },
  composite,
  stitch,
  channelSplit,
  channelMerge,
  channelApply,
  comp,
  distort,
  spherize,
  constant,
  ramp,
  noise,
  draw,
  drawMask,
  imageOpsMask,
};
