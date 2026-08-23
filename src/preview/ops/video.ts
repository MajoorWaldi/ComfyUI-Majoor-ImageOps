import type { ComfyNode } from "../../types.js";
import { getOpsConstants } from "../constants.js";
import { strAny } from "../graph.js";
import { getImageData, makeCanvas, putImageData } from "../renderer.js";
import { clamp01, luma01 } from "./color.js";
import { fitCanvas } from "./geometry.js";
// Extracted with ts-morph

export function channelSplit(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot: number | null): HTMLCanvasElement {
    return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
  }

export function channelMerge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
  }

export const videoOps = { channelSplit, channelMerge };

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
