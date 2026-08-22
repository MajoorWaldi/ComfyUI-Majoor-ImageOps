import { ops } from "./implementation.js";
export { blendChannel01 } from "../shared/blend-modes.js";

export const blendOps = {
  merge: ops.merge,
  composite: ops.composite,
  comp: ops.comp,
};


// Extracted with ts-morph

export function merge(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, topCanvasOrInputs: HTMLCanvasElement | HTMLCanvasElement[], _opts?: any, frameIndex: number = 0): HTMLCanvasElement {
    const inputs = Array.isArray(topCanvasOrInputs)
      ? topCanvasOrInputs
      : [ctx.canvas, topCanvasOrInputs];
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
  }

export function composite(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
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
  }

export function comp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    return renderCompPreview(
      node,
      resolveCompPreviewInputs(node, inputs),
    ).canvas;
  }

