import type { ComfyNode } from "../../types.js";
import { makeCanvas, renderDrawPreview, resolveDrawOverlayCanvas } from "../draw.js";
import { boolAny, numAny, resolveConnectedString, strAny } from "../graph.js";
import { clamp01, hexToRgb01, parseHexColor, renderKeyerCanvases } from "./color.js";
import { stitchCanvases } from "./geometry.js";
import { invertMaskCanvas, markPreparedMaskCanvas, resolvePreviewMaskCanvas } from "./masks.js";

// Extracted with ts-morph

export function grain(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderGrainCanvas(node, source, inputs[1] ?? null, frameIndex);
  }

export function text(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderTextCanvas(node, source, inputs[1] ?? null, frameIndex);
  }

export function keyer(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderKeyerCanvases(node, source, inputs[1] ?? null, frameIndex).image;
  }

export function stitch(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
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
  }

export function constant(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    return renderConstantCanvas(node, false);
  }

export function ramp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    return renderRampCanvas(node, false);
  }

export function noise(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, frameIndex: number = 0): HTMLCanvasElement {
    return renderNoiseCanvas(node, false, frameIndex, W);
  }

export async function draw(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    return await renderDrawPreview(node, inputs[0] ?? null);
  }

export async function drawMask(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    const base = inputs[0] ?? null;
    const width = base?.width || Math.max(1, Math.round(numAny(node, ["width"], 1024)));
    const height = base?.height || Math.max(1, Math.round(numAny(node, ["height"], 1024)));
    const overlay = await resolveDrawOverlayCanvas(node, width, height);
    // Backend draw.py returns overlay_alpha[..., 0] as the mask (alpha channel
    // only, brush colour is irrelevant). buildMaskAlphaCanvas applies luma*alpha
    // which would dim the preview mask whenever the user paints with a non-white
    // colour — that diverges from the backend. Build an alpha-only matte instead.
    const ow = overlay.width || 1;
    const oh = overlay.height || 1;
    const matte = makeCanvas(ow, oh);
    const mctx = matte.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(overlay, 0, 0);
    const img = mctx.getImageData(0, 0, ow, oh);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
    mctx.putImageData(img, 0, 0);
    const mask = markPreparedMaskCanvas(matte);
    return boolAny(node, ["invert_mask"], false) ? invertMaskCanvas(mask) : mask;
  }

export const proceduralOps = { constant, ramp, noise, grain, text };

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

export function sampleNoiseBasis(basis: string, sampleX: number, sampleY: number, sampleZ: number, rawX: number, rawY: number, rawZ: number, seed: number, periodX: number = 0, periodY: number = 0): number {
    const normalized = String(basis || "perlin").toLowerCase();
    if (normalized === "value") return sampleValueNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
    if (normalized === "white") return sampleWhiteNoise(rawX, rawY, rawZ, seed, periodX > 0 ? Math.max(1, Math.round(periodX)) : 0, periodY > 0 ? Math.max(1, Math.round(periodY)) : 0);
    return samplePerlinNoise(sampleX, sampleY, sampleZ, seed, periodX, periodY);
}

export function buildNoiseField(width: number, height: number, options: {
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
    }): Float32Array {
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

export function renderNoiseFieldCanvas(width: number, height: number, grayValues: Float32Array, low: [number, number, number], high: [number, number, number], maskOnly: boolean = false): HTMLCanvasElement {
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

export function renderNoiseCanvas(node: ComfyNode, maskOnly: boolean = false, frameIndex: number = 0, canvasSize: number = 512): HTMLCanvasElement {
    const fullWidth = Math.max(1, Math.round(numAny(node, ["width"], 1024)));
    const fullHeight = Math.max(1, Math.round(numAny(node, ["height"], 1024)));
    const scaleFactor = Math.min(1, Math.max(1, Math.min(canvasSize, NOISE_CANVAS_MAX)) / Math.max(fullWidth, fullHeight));
    const width = Math.max(1, Math.round(fullWidth * scaleFactor));
    const height = Math.max(1, Math.round(fullHeight * scaleFactor));
    const batchSize = Math.max(1, Math.round(numAny(node, ["batch_size"], 1)));
    const frameLength = Math.max(0, Math.round(numAny(node, ["frame_length"], 0)));
    const frameCount = frameLength > 0 ? frameLength : batchSize;
    const resolvedFrameIndex = ((Math.max(0, Math.round(frameIndex)) % frameCount) + frameCount) % frameCount;
    const low = hexToRgb01(strAny(node, ["low_color"], "#ffffff", resolvedFrameIndex));
    const high = hexToRgb01(strAny(node, ["high_color"], "#000000", resolvedFrameIndex));
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

export async function renderDrawNodePreview(node: ComfyNode, baseCanvas: HTMLCanvasElement | null = null): Promise<HTMLCanvasElement> {
    return await renderDrawPreview(node, baseCanvas);
}

const NOISE_GRAD3_X = new Float32Array([ 1,-1, 1,-1,  1,-1, 1,-1,  0, 0, 0, 0,  1,-1, 0, 0]);
const NOISE_GRAD3_Y = new Float32Array([ 1, 1,-1,-1,  0, 0, 0, 0,  1,-1, 1,-1,  1, 1,-1, 1]);
const NOISE_GRAD3_Z = new Float32Array([ 0, 0, 0, 0,  1, 1,-1,-1,  1, 1,-1,-1,  0, 0, 1,-1]);
const NOISE_CANVAS_MAX = 256;
