import {
    extractSplitChannelCanvas,
    mergeChannelInputs,
    ops,
    strAny
} from "./implementation.js";
import type { ComfyNode } from "../../types.js";

export const videoOps = {
  draw: ops.draw,
  drawMask: ops.drawMask,
  keyer: ops.keyer,
  stitch: ops.stitch,
  channelSplit: ops.channelSplit,
  channelMerge: ops.channelMerge,
};


// Extracted with ts-morph

export function channelSplit(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot: number | null): HTMLCanvasElement {
    return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
  }

export function channelMerge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
  }

