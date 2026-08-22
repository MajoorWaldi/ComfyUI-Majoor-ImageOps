import {
    extractSplitChannelCanvas,
    mergeChannelInputs,
    strAny
} from "./implementation.js";
import type { ComfyNode } from "../../types.js";

// Extracted with ts-morph

export function channelSplit(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot: number | null): HTMLCanvasElement {
    return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
  }

export function channelMerge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
  }

export const videoOps = { channelSplit, channelMerge };

