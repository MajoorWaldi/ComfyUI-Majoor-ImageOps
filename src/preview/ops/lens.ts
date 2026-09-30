import type { ComfyNode } from "../../types.js";
import { makeCanvas } from "../draw.js";
import { boolAny, numAny, strAny } from "../graph.js";
import { clamp01, hexToRgb01 } from "./color.js";
import { grainRandom01 } from "./procedural.js";
import { resolvePreviewMaskCanvas } from "./masks.js";

function smoothstep01(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function renderVignetteCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  const img = octx.getImageData(0, 0, width, height);
  const data = img.data;

  const amount = Math.max(0, Math.min(1, numAny(node, ["amount"], 0.5, frameIndex)));
  if (amount <= 0) return output;
  const size = numAny(node, ["size"], 1.0, frameIndex);
  const softness = Math.max(1e-4, numAny(node, ["softness"], 0.6, frameIndex));
  const centerX = numAny(node, ["center_x"], 0.5, frameIndex);
  const centerY = numAny(node, ["center_y"], 0.5, frameIndex);
  const [tr, tg, tb] = hexToRgb01(strAny(node, ["color"], "#000000", frameIndex));
  const aspect = width / Math.max(1, height);
  const inner = Math.max(0, size - softness);
  const outer = Math.max(size, inner + 1e-4);
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const maskData = mask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;

  for (let y = 0; y < height; y++) {
    const ny = height > 1 ? y / (height - 1) : 0;
    for (let x = 0; x < width; x++) {
      const nx = width > 1 ? x / (width - 1) : 0;
      const i = (y * width + x) * 4;
      const weight = maskData ? maskData[i + 3] / 255 : 1;
      if (weight <= 0) continue;
      const dx = aspect >= 1 ? (nx - centerX) * aspect : nx - centerX;
      const dy = aspect >= 1 ? ny - centerY : (ny - centerY) / Math.max(1e-6, aspect);
      const dist = Math.hypot(dx, dy);
      const t = smoothstep01((dist - inner) / (outer - inner));
      const falloff = t * amount * weight;
      if (falloff <= 0) continue;
      data[i] = Math.round((data[i] / 255 * (1 - falloff) + tr * falloff) * 255);
      data[i + 1] = Math.round((data[i + 1] / 255 * (1 - falloff) + tg * falloff) * 255);
      data[i + 2] = Math.round((data[i + 2] / 255 * (1 - falloff) + tb * falloff) * 255);
    }
  }

  octx.putImageData(img, 0, 0);
  return output;
}

export function renderChromaticAberrationCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);

  const amount = numAny(node, ["amount"], 2.0, frameIndex);
  if (amount === 0) return output;
  const centerX = numAny(node, ["center_x"], 0.5, frameIndex);
  const centerY = numAny(node, ["center_y"], 0.5, frameIndex);
  const cxPx = centerX * Math.max(0, width - 1);
  const cyPx = centerY * Math.max(0, height - 1);
  const halfDiag = Math.hypot(width / 2, height / 2) || 1;
  const k = amount / halfDiag;

  const src = octx.getImageData(0, 0, width, height);
  const srcData = src.data;
  const out = octx.createImageData(width, height);
  const outData = out.data;
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const maskData = mask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;

  const sampleChannel = (sx: number, sy: number, channel: number): number => {
    const cx = Math.max(0, Math.min(width - 1, sx));
    const cy = Math.max(0, Math.min(height - 1, sy));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const x1 = Math.min(width - 1, x0 + 1);
    const y1 = Math.min(height - 1, y0 + 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const p00 = srcData[(y0 * width + x0) * 4 + channel];
    const p10 = srcData[(y0 * width + x1) * 4 + channel];
    const p01 = srcData[(y1 * width + x0) * 4 + channel];
    const p11 = srcData[(y1 * width + x1) * 4 + channel];
    return (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const weight = maskData ? maskData[i + 3] / 255 : 1;
      if (weight <= 0) {
        outData[i] = srcData[i];
        outData[i + 1] = srcData[i + 1];
        outData[i + 2] = srcData[i + 2];
        outData[i + 3] = srcData[i + 3];
        continue;
      }
      const rx = (x - cxPx) * (1 + k) + cxPx;
      const ry = (y - cyPx) * (1 + k) + cyPx;
      const bx = (x - cxPx) * (1 - k) + cxPx;
      const by = (y - cyPx) * (1 - k) + cyPx;
      const r = sampleChannel(rx, ry, 0);
      const bch = sampleChannel(bx, by, 2);
      outData[i] = Math.round(srcData[i] * (1 - weight) + r * weight);
      outData[i + 1] = srcData[i + 1];
      outData[i + 2] = Math.round(srcData[i + 2] * (1 - weight) + bch * weight);
      outData[i + 3] = srcData[i + 3];
    }
  }

  octx.putImageData(out, 0, 0);
  return output;
}

export function renderBloomCanvas(node: ComfyNode, source: HTMLCanvasElement, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);

  const threshold = numAny(node, ["threshold"], 0.8, frameIndex);
  const intensity = Math.max(0, numAny(node, ["intensity"], 0.5, frameIndex));
  const radius = Math.max(0, Math.round(numAny(node, ["radius"], 12, frameIndex)));
  if (intensity <= 0) return output;

  const img = octx.getImageData(0, 0, width, height);
  const data = img.data;

  const bright = makeCanvas(width, height);
  const bctx = bright.getContext("2d", { willReadFrequently: true })!;
  const brightImg = bctx.createImageData(width, height);
  const brightData = brightImg.data;
  for (let i = 0; i < data.length; i += 4) {
    brightData[i] = Math.max(0, data[i] - threshold * 255);
    brightData[i + 1] = Math.max(0, data[i + 1] - threshold * 255);
    brightData[i + 2] = Math.max(0, data[i + 2] - threshold * 255);
    brightData[i + 3] = 255;
  }
  bctx.putImageData(brightImg, 0, 0);

  // Canvas's native CSS blur filter approximates the backend's gaussian glow
  // cheaply enough for a live preview.
  const glow = makeCanvas(width, height);
  const gctx = glow.getContext("2d", { willReadFrequently: true })!;
  gctx.filter = radius > 0 ? `blur(${radius}px)` : "none";
  gctx.drawImage(bright, 0, 0, width, height);
  gctx.filter = "none";
  const glowData = gctx.getImageData(0, 0, width, height).data;
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const maskData = mask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;

  for (let i = 0; i < data.length; i += 4) {
    const weight = maskData ? maskData[i + 3] / 255 : 1;
    if (weight <= 0) continue;
    data[i] = Math.min(255, Math.round(data[i] + glowData[i] * intensity * weight));
    data[i + 1] = Math.min(255, Math.round(data[i + 1] + glowData[i + 1] * intensity * weight));
    data[i + 2] = Math.min(255, Math.round(data[i + 2] + glowData[i + 2] * intensity * weight));
  }

  octx.putImageData(img, 0, 0);
  return output;
}

export function vignette(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
  const source = inputs[0] ?? ctx.canvas;
  return renderVignetteCanvas(node, source, inputs[1] ?? null, frameIndex);
}

export function chromaticAberration(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
  const source = inputs[0] ?? ctx.canvas;
  return renderChromaticAberrationCanvas(node, source, inputs[1] ?? null, frameIndex);
}

export function bloom(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
  const source = inputs[0] ?? ctx.canvas;
  return renderBloomCanvas(node, source, inputs[1] ?? null, frameIndex);
}

/**
 * Cheap live-preview approximation of the backend's depth-layered bokeh:
 * a handful of CSS gaussian-blur bands interpolated by per-pixel depth. It
 * ignores bokeh_shape and the highlight bloom (canvas has no native shaped
 * blur) — the real shaped/glowing bokeh only exists once the backend runs.
 */
export function renderDefocusCanvas(node: ComfyNode, source: HTMLCanvasElement, depth: HTMLCanvasElement | null, rawMask: HTMLCanvasElement | null, frameIndex: number): HTMLCanvasElement {
  const width = source.width || 1;
  const height = source.height || 1;
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d", { willReadFrequently: true })!;
  octx.drawImage(source, 0, 0, width, height);
  if (!depth) return output;

  const maxRadius = Math.max(0, Math.round(numAny(node, ["max_blur_radius"], 24, frameIndex)));
  if (maxRadius <= 0) return output;
  const focusDistance = numAny(node, ["focus_distance"], 0.5, frameIndex);
  const focusRange = Math.min(0.99, Math.max(0, numAny(node, ["focus_range"], 0.05, frameIndex)));
  const invertDepth = boolAny(node, ["invert_depth"], false, frameIndex);

  const dctx = makeCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  dctx.drawImage(depth, 0, 0, width, height);
  const depthData = dctx.getImageData(0, 0, width, height).data;

  const BANDS = 4;
  const bandRadii = Array.from({ length: BANDS }, (_, i) => Math.round((i / (BANDS - 1)) * maxRadius));
  const bandData = bandRadii.map((r) => {
    if (r <= 0) return octx.getImageData(0, 0, width, height).data;
    const band = makeCanvas(width, height);
    const bctx = band.getContext("2d", { willReadFrequently: true })!;
    bctx.filter = `blur(${r}px)`;
    bctx.drawImage(source, 0, 0, width, height);
    bctx.filter = "none";
    return bctx.getImageData(0, 0, width, height).data;
  });

  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const maskData = mask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;

  const img = octx.getImageData(0, 0, width, height);
  const data = img.data;
  const step = maxRadius / (BANDS - 1) || 1;

  for (let i = 0; i < data.length; i += 4) {
    const weight = maskData ? maskData[i + 3] / 255 : 1;
    if (weight <= 0) continue;
    let depthValue = depthData[i] / 255;
    if (invertDepth) depthValue = 1 - depthValue;
    const coc = Math.max(0, Math.abs(depthValue - focusDistance) - focusRange) / Math.max(1e-3, 1 - focusRange);
    const radius = Math.min(maxRadius, coc * maxRadius);
    const pos = Math.min(BANDS - 1, radius / step);
    const lo = Math.floor(pos);
    const hi = Math.min(BANDS - 1, lo + 1);
    const frac = pos - lo;
    for (let c = 0; c < 3; c++) {
      const blended = bandData[lo][i + c] * (1 - frac) + bandData[hi][i + c] * frac;
      data[i + c] = Math.round(data[i + c] * (1 - weight) + blended * weight);
    }
  }

  octx.putImageData(img, 0, 0);
  return output;
}

export function defocus(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
  // Input schema order is image, depth, shape_texture, mask; shape_texture is
  // only consumed by the real backend blur (see renderDefocusCanvas's doc
  // comment), so it's skipped here but still needs to advance the cursor.
  const source = inputs[0] ?? ctx.canvas;
  const depthConnected = (node.inputs?.[1]?.link ?? null) != null;
  const shapeConnected = (node.inputs?.[2]?.link ?? null) != null;
  const maskConnected = (node.inputs?.[3]?.link ?? null) != null;
  let cursor = 1;
  const depth = depthConnected ? (inputs[cursor++] ?? null) : null;
  if (shapeConnected) cursor++;
  const mask = maskConnected ? (inputs[cursor] ?? null) : null;
  return renderDefocusCanvas(node, source, depth, mask, frameIndex);
}


export const lensOps = { vignette, chromaticAberration, bloom, defocus };
