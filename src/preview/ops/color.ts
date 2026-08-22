import { ops } from "./implementation.js";
export { applyColorCorrectGL, isWebGLColorAvailable } from "../shared/webgl-color.js";
export type { ColorCorrectParams } from "../shared/webgl-color.js";

export const colorOps = {
  colorAjust: ops.colorAjust,
  colorCorrect: ops.colorCorrect,
  levels: ops.levels,
  hueSat: ops.hueSat,
  desaturate: ops.desaturate,
  invert: ops.invert,
  clamp: ops.clamp,
  channel: ops.channel,
  lumaKey: ops.lumaKey,
  sharpen: ops.sharpen,
  edgeDetect: ops.edgeDetect,
  glow: ops.glow,
};


// Extracted with ts-morph

export function colorAjust(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
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
  }

export function colorCorrect(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    return ops.colorAjust(ctx, W, node, inputs, frameIndex);
  }

export function channel(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, outputSlot?: number | null, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
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
  }

export function levels(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, _opts?: any): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyLevels(ctx,width,height,
      numAny(node, ["in_min", "min"], 0),
      numAny(node, ["in_max", "max"], 1),
      numAny(node, ["gamma", "mid"], 1),
      numAny(node, ["out_min"], 0),
      numAny(node, ["out_max"], 1),
    );
  }

export function hueSat(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, _opts?: any): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyHueSat(ctx,width,height,
      numAny(node, ["hue_deg", "hue"], 0),
      numAny(node, ["saturation", "sat"], 1),
      numAny(node, ["value", "val"], 1),
    );
  }

export function invert(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applyInvert(effectCtx, width, height, boolAny(node, ["invert_alpha"], false, frameIndex));
    });
  }

export function clamp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0, frameIndex), numAny(node, ["max_v", "max"], 1, frameIndex));
    });
  }

export function sharpen(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyUnsharp(ctx,width,height, numAny(node,["amount", "strength", "factor"],1));
  }

export function edgeDetect(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyEdgeDetect(ctx,width,height, numAny(node,["strength"],1));
  }

export function glow(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyGlow(ctx,width,height, numAny(node,["threshold"],0.8), numAny(node,["intensity"],0.75), Math.round(numAny(node,["blur_px", "blur", "radius"],6)));
  }

export function lumaKey(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyLumaKey(ctx,width,height, numAny(node,["low"],0.1), numAny(node,["high"],0.9), numAny(node,["softness"],0.05));
  }

export function desaturate(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    const factor = numAny(node, ["factor", "amount"], 1);
    applyDesaturate(ctx, width, height, factor);
  }

