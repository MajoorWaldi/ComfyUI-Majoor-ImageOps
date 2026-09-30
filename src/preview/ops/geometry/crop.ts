import type { ComfyNode, RenderInputInfo } from "../../../types.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "../../crop.js";
import { boolAny, num, numAny, str, strAny, w, wAny } from "../../graph.js";
import { applyEffectToCanvas, getCanvasDimensions, makeCanvas } from "../../renderer.js";
import { parseHexColor } from "../color.js";
import { computeMaskBounds, markPreparedMaskCanvas, renderMaskedEffectPreview } from "../masks.js";
import { cropRectCanvas, extractMaskDrivenCrop, fitCanvas, flipCanvas, resizeWithMode, resolveResizeDimensions, rotateDiscrete } from "./canvas-basics.js";

export function crop(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      (input) => applyEffectToCanvas(input, (effectCtx, width, height) => applyCrop(
        effectCtx,
        node,
        width,
        height,
        str(node, "aspect_ratio", "custom", frameIndex),
        num(node, "width", width, frameIndex),
        num(node, "height", height, frameIndex),
      )),
      {
        frameIndex,
        premultBeforeProcess: true,
        compositeWithBase: false,
      },
    );
  }

export function cropGeneric(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], inputInfos: RenderInputInfo[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const sourceWidth = source.width || 1;
    const sourceHeight = source.height || 1;
    let targetWidth = Math.max(1, Math.round(numAny(node, ["width", "target_width", "base_resolution"], sourceWidth)));
    let targetHeight = Math.max(1, Math.round(numAny(node, ["height", "target_height", "base_resolution"], sourceHeight)));

    const maskInput = inputs[1] ?? null;
    if (maskInput) {
      if (!wAny(node, ["width", "target_width", "height", "target_height"]) && !!w(node, "base_resolution")) {
        const fittedMask = fitCanvas(maskInput, sourceWidth, sourceHeight);
        const bounds = computeMaskBounds(fittedMask);
        if (bounds) {
          const aspect = bounds.width / Math.max(1, bounds.height);
          const baseResolution = Math.max(1, Math.round(numAny(node, ["base_resolution"], Math.max(bounds.width, bounds.height))));
          if (aspect >= 1) {
            targetWidth = baseResolution;
            targetHeight = Math.max(1, Math.round(baseResolution / aspect));
          } else {
            targetHeight = baseResolution;
            targetWidth = Math.max(1, Math.round(baseResolution * aspect));
          }
        }
      }
      return extractMaskDrivenCrop(source, maskInput, numAny(node, ["padding"], 0), targetWidth, targetHeight);
    }

    const cropRegion = w(node, "crop_region")?.value as { x?: number; y?: number; width?: number; height?: number } | null;
    const bboxNode = inputInfos[1]?.upstreamNode ?? null;
    const x = Math.max(0, Math.round(cropRegion?.x ?? numAny(bboxNode ?? node, ["x", "x_offset"], 0)));
    const y = Math.max(0, Math.round(cropRegion?.y ?? numAny(bboxNode ?? node, ["y", "y_offset"], 0)));
    const width = Math.max(1, Math.round(cropRegion?.width ?? numAny(bboxNode ?? node, ["width", "crop_w"], sourceWidth)));
    const height = Math.max(1, Math.round(cropRegion?.height ?? numAny(bboxNode ?? node, ["height", "crop_h"], sourceHeight)));
    return cropRectCanvas(source, x, y, Math.min(width, sourceWidth - x), Math.min(height, sourceHeight - y));
  }

export function cropReformat(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): void {
    const { width, height } = getCanvasDimensions(ctx);
    applyCropReformat(ctx,width,height,
      numAny(node,["x"],0), numAny(node,["y"],0),
      numAny(node,["crop_w", "width"],width), numAny(node,["crop_h", "height"],height),
      numAny(node,["padding"],0),
      numAny(node,["out_w", "target_width"],0), numAny(node,["out_h", "target_height"],0),
      strAny(node,["mode", "method"],"fit")
    );
  }

export function resize(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    const { width, height } = getCanvasDimensions(ctx);
    const resolved = resolveResizeDimensions(node, width, height);
    return resizeWithMode(ctx.canvas, resolved.width, resolved.height, resolved.filter, resolved.mode, resolved.fillColor, resolved.cropPosition);
  }

export function pad(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = []): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const top = Math.max(0, Math.round(numAny(node, ["top"], 0)));
    const bottom = Math.max(0, Math.round(numAny(node, ["bottom"], 0)));
    const left = Math.max(0, Math.round(numAny(node, ["left"], 0)));
    const right = Math.max(0, Math.round(numAny(node, ["right"], 0)));
    const output = makeCanvas((source.width || 1) + left + right, (source.height || 1) + top + bottom);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.fillStyle = parseHexColor(strAny(node, ["color", "background_color", "pad_color", "padding_color"], "#808080"));
    octx.fillRect(0, 0, output.width, output.height);
    octx.drawImage(source, left, top, source.width || 1, source.height || 1);
    return output;
  }

export function flipRotate(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    const flipMethod = strAny(node, ["flip_method"], "");
    const horizontal = flipMethod.startsWith("y");
    const vertical = flipMethod.startsWith("x");
    let working = flipCanvas(ctx.canvas, horizontal, vertical);
    const rotation = strAny(node, ["rotation"], "");
    if (rotation.startsWith("90")) working = rotateDiscrete(working, 1);
    else if (rotation.startsWith("180")) working = rotateDiscrete(working, 2);
    else if (rotation.startsWith("270")) working = rotateDiscrete(working, 3);
    return working;
  }

export function applyCropReformat(ctx: CanvasRenderingContext2D, W: number, H: number, x: number, y: number, cw: number, ch: number, padding: number, outW: number, outH: number, mode: string): void {
    const cropW = Math.max(1,Math.round(cw));
    const cropH = Math.max(1,Math.round(ch));
    const pad = Math.max(0,Math.round(padding));
    const tmp = document.createElement("canvas");
    tmp.width=cropW+pad*2;
    tmp.height=cropH+pad*2;
    const tctx = tmp.getContext("2d", { willReadFrequently: true })!;
    tctx.clearRect(0,0,tmp.width,tmp.height);
    tctx.drawImage(ctx.canvas, -Math.round(x)+pad, -Math.round(y)+pad);
    const finalW = outW>0?Math.round(outW):tmp.width;
    const finalH = outH>0?Math.round(outH):tmp.height;
    const dst = document.createElement("canvas");
    dst.width=finalW;
    dst.height=finalH;
    const dctx = dst.getContext("2d", { willReadFrequently: true })!;
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

export function applyCrop(ctx: CanvasRenderingContext2D, node: ComfyNode, sourceWidth: number, sourceHeight: number, aspectRatio: string, outW: number, outH: number): HTMLCanvasElement {
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

export function padOut(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderPadOutCanvases(node, source, frameIndex).image;
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

export function renderPadOutCanvases(node: ComfyNode, source: HTMLCanvasElement, frameIndex: number = 0, applyInvertMask: boolean = true): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
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
