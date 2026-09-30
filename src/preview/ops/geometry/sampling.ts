import { noiseLerp } from "../procedural.js";
import { reflectCoordinate } from "./canvas-basics.js";

export function setResampleMode(ctx: CanvasRenderingContext2D, filter: string): void {
    const mode = String(filter || "bilinear").toLowerCase();
    ctx.imageSmoothingEnabled = mode !== "nearest";
    if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
    }
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
