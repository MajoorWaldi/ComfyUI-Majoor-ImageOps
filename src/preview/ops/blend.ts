import type { ComfyNode, CornerPinHandle } from "../../types.js";
import { computeCompRect, getCompLayerOutputCorners, getCompSlots, hasCompLayerCornerPin, syncCompLayers } from "../comp.js";
import { getOpsConstants } from "../constants.js";
import { bool, boolAny, num, numAny, str, strAny, w } from "../graph.js";
import { applyEffectToCanvas, getImageData, makeCanvas, putImageData } from "../renderer.js";
import { blendChannel01 } from "../shared/blend-modes.js";
import { setWidgetValue } from "../shared/widgets.js";
import { clamp01, linearToSrgb01, luma01, parseHexColor, srgbToLinear01 } from "./color.js";
import { fitCanvas, warpCanvasToQuad } from "./geometry.js";
import { compositeProcessedWithMask, invertMaskCanvas, premultLayerWithMask, resolvePreviewMaskCanvas } from "./masks.js";
export { blendChannel01 } from "../shared/blend-modes.js";

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

export const blendOps = { merge, composite, comp };

export function compositeAt(base: HTMLCanvasElement, top: HTMLCanvasElement, mode: string, opacity: number, x: number, y: number, width: number, height: number): HTMLCanvasElement {
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

export function renderCompPreview(node: ComfyNode, inputLayers: Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number; sourceWidth?: number; sourceHeight?: number }>): {
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

export function resolveCompPreviewInputs(node: ComfyNode, inputs: HTMLCanvasElement[]): Array<{ image: HTMLCanvasElement; mask?: HTMLCanvasElement | null; slot: string; layerNumber: number; inputIndex: number }> {
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
    const m = Math.max(0,Math.min(1,mix));
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

export function applyGlow(ctx: CanvasRenderingContext2D, W: number, H: number, threshold: number, intensity: number, blurPx: number): void {
    const { luma_weights: LW } = getOpsConstants();
    const base = getImageData(ctx,W,H);
    const d = base.data;
    const hi = new Uint8ClampedArray(d.length);
    for (let i=0;i<d.length;i+=4){
    const l=luma01(d[i]/255, d[i+1]/255, d[i+2]/255, LW);
    if (l>=threshold){
      hi[i]=d[i]; hi[i+1]=d[i+1]; hi[i+2]=d[i+2]; hi[i+3]=d[i+3];
    }
    }

    const tmp = document.createElement("canvas");
    tmp.width=W;
    tmp.height=H;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.putImageData(new ImageData(hi,W,H),0,0);
    const blur = document.createElement("canvas");
    blur.width=W;
    blur.height=H;
    const bctx = blur.getContext("2d", { willReadFrequently: true })!;
    bctx.filter=`blur(${Math.max(0,blurPx)}px)`;
    bctx.drawImage(tmp,0,0);
    bctx.filter="none";
    ctx.save();
    ctx.globalAlpha=Math.max(0,Math.min(1,intensity));
    ctx.globalCompositeOperation="lighter";
    ctx.drawImage(blur,0,0);
    ctx.restore();
}
