import type { ComfyNode, CornerPinHandle, RenderInputInfo } from "../../types.js";
import { getOpsConstants } from "../constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "../crop.js";
import { bool, boolAny, normalizeFilterName, num, numAny, resolveConnectedString, str, strAny, w, wAny } from "../graph.js";
import { applyEffectToCanvas, canvasFieldCache, getCanvasDimensions, makeCanvas } from "../renderer.js";
import { setWidgetValue } from "../shared/widgets.js";
import { clamp01, luma01, parseHexColor } from "./color.js";
import { alphaMaskCanvas, blurMaskAlphaCanvas, buildMaskAlphaCanvas, compositeProcessedWithMask, computeMaskBounds, invertMaskCanvas, isPreparedMaskCanvas, markPreparedMaskCanvas, maskCanvasToPreviewCanvas, renderMaskedEffectPreview, resolvePreviewMaskCanvas } from "./masks.js";
import { noiseLerp, smoothShakeValue } from "./procedural.js";
export * from "../shared/geometry.js";

// Extracted with ts-morph

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

export function cropStitch(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    if (inputs.length < 2) return inputs[0] ?? ctx.canvas;
    const rendered = renderCropStitchCanvases(node, inputs, frameIndex);
    return composeCropStitchPreview(rendered.image, rendered.crop, rendered.mask, rendered.bbox);
  }

export function padOut(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderPadOutCanvases(node, source, frameIndex).image;
  }

export function cornerPin(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderCornerPinCanvases(node, source, frameIndex).image;
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

export function transform(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const rawMask = inputs[1] ?? null;
    const transformImage = (input: HTMLCanvasElement): HTMLCanvasElement => {
      let working = input;
      const flip = strAny(node, ["flip", "mirror"], "none", frameIndex).toLowerCase();
      const flipMethod = strAny(node, ["flip_method"], "", frameIndex);
      const horizontal = flip === "horizontal" || flipMethod.startsWith("y");
      const vertical = flip === "vertical" || flipMethod.startsWith("x");
      working = flipCanvas(working, horizontal, vertical);

      const rotationLabel = strAny(node, ["rotation"], "", frameIndex);
      if (rotationLabel.startsWith("90")) working = rotateDiscrete(working, 1);
      else if (rotationLabel.startsWith("180")) working = rotateDiscrete(working, 2);
      else if (rotationLabel.startsWith("270")) working = rotateDiscrete(working, 3);

      const aspectRatio = numAny(node, ["aspect_ratio"], 1, frameIndex);
      if (Math.abs(aspectRatio - 1) > 0.0001) {
        const scaled = makeCanvas(working.width || 1, Math.max(1, Math.round((working.height || 1) * aspectRatio)));
        const sctx = scaled.getContext("2d", { willReadFrequently: true })!;
        setResampleMode(sctx, normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear", frameIndex)));
        sctx.drawImage(working, 0, 0, scaled.width, scaled.height);
        working = scaled;
      }

      const tx = numAny(node, ["translate_x", "x", "shift_x"], 0, frameIndex);
      const ty = numAny(node, ["translate_y", "y", "shift_y"], 0, frameIndex);
      const rot = numAny(node, ["rotate_deg", "rotate"], 0, frameIndex);
      const scale = numAny(node, ["scale"], 1, frameIndex);
      const filter = normalizeFilterName(strAny(node, ["filter", "upscale_method", "interpolation", "transform_method"], "bilinear", frameIndex));
      const expand = boolAny(node, ["expand"], false, frameIndex);
      const fillMode = strAny(node, ["fill_mode", "edge_mode"], "transparent", frameIndex);
      const fillColor = strAny(node, ["fill_color", "background_color", "color"], "#000000", frameIndex);

      return applyEffectToCanvas(working, (effectCtx, width, height) => {
        return applyTransform(effectCtx, width, height, tx, ty, rot, scale, filter, expand, fillMode, fillColor);
      });
    };

    return renderMaskedEffectPreview(
      node,
      source,
      rawMask,
      transformImage,
      {
        frameIndex,
        premultBeforeProcess: true,
        compositeWithBase: false,
      },
    );
  }

export function cameraShake(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    const transformImage = (input: HTMLCanvasElement): HTMLCanvasElement => {
      const translate = Math.max(0, numAny(node, ["translate_px"], 12, frameIndex));
      const rotate = Math.max(0, numAny(node, ["rotate_deg"], 1.5, frameIndex));
      const zoom = Math.max(0, numAny(node, ["zoom"], 0.03, frameIndex));
      const smoothing = numAny(node, ["smoothing"], 0.65, frameIndex);
      const frequency = Math.max(0.01, numAny(node, ["shake_frequency", "frequency"], 1, frameIndex));
      const seed = Math.max(0, Math.round(numAny(node, ["seed"], 12345, frameIndex)));
      const tx = smoothShakeValue(seed + 11, frameIndex, 1, translate, smoothing, frequency);
      const ty = smoothShakeValue(seed + 23, frameIndex, 2, translate, smoothing, frequency);
      const rot = smoothShakeValue(seed + 37, frameIndex, 3, rotate, smoothing, frequency);
      const scale = Math.max(0.01, 1 + smoothShakeValue(seed + 53, frameIndex, 4, zoom, smoothing, frequency));
      return applyEffectToCanvas(input, (effectCtx, width, height) => {
        return applyTransform(
          effectCtx,
          width,
          height,
          tx,
          ty,
          rot,
          scale,
          strAny(node, ["filter"], "bilinear", frameIndex),
          false,
          strAny(node, ["fill_mode"], "mirror", frameIndex),
          strAny(node, ["fill_color"], "#000000", frameIndex),
        );
      });
    };
    return renderMaskedEffectPreview(node, source, inputs[1] ?? null, transformImage, {
      frameIndex,
      premultBeforeProcess: true,
      compositeWithBase: false,
    });
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

export function distort(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[], frameIndex: number = 0): HTMLCanvasElement {
    return renderDistortCanvas(node, inputs, frameIndex).image;
  }

export function spherize(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    let source = inputs[0] ?? ctx.canvas;

    const sizeMode = strAny(node, ["size_mode"], "from_input", frameIndex).toLowerCase().trim();
    if (sizeMode === "custom") {
      const tw = Math.max(64, Math.round(numAny(node, ["width"], 512, frameIndex)));
      const th = Math.max(64, Math.round(numAny(node, ["height"], 512, frameIndex)));
      if (tw !== source.width || th !== source.height) {
        const resized = makeCanvas(tw, th);
        resized.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, tw, th);
        source = resized;
      }
    } else {
      // from_input: sync width/height widgets to actual source dimensions
      const ww = w(node, "width");
      const hw = w(node, "height");
      setWidgetValue(ww, Math.max(64, source.width));
      setWidgetValue(hw, Math.max(64, source.height));
    }

    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applySpherize(
        effectCtx, width, height,
        strAny(node, ["mode"], "spherize", frameIndex),
        numAny(node, ["strength"], 1.0, frameIndex),
        boolAny(node, ["invert"], false, frameIndex),
      );
    });
  }

export const geometryOps = {
  crop, cropGeneric, cropReformat, cropStitch, pad, padOut, resize,
  transform, flipRotate, cornerPin, cameraShake, distort, spherize,
};

export function resizeWithMode(source: HTMLCanvasElement, width: number, height: number, filter: string, mode: string, fillColor: string = "#000000", cropPosition: string = "center"): HTMLCanvasElement {
    const targetWidth = Math.max(1, Math.round(width));
    const targetHeight = Math.max(1, Math.round(height));
    const output = makeCanvas(targetWidth, targetHeight);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    const normalizedMode = String(mode || "stretch").toLowerCase();
    const srcW = Math.max(1, source.width || 1);
    const srcH = Math.max(1, source.height || 1);
    setResampleMode(octx, filter);
    if (normalizedMode.includes("pad") || normalizedMode.includes("pillarbox")) {
    octx.fillStyle = parseHexColor(fillColor);
    octx.fillRect(0, 0, targetWidth, targetHeight);
    } else {
    octx.clearRect(0, 0, targetWidth, targetHeight);
    }

    if (
    normalizedMode === "stretch" ||
    normalizedMode === "disabled" ||
    normalizedMode === "scale dimensions"
    ) {
    octx.drawImage(source, 0, 0, targetWidth, targetHeight);
    return output;
    }

    const fitScale = Math.min(targetWidth / srcW, targetHeight / srcH);
    const fillScale = Math.max(targetWidth / srcW, targetHeight / srcH);
    const useFill = normalizedMode.includes("fill") || normalizedMode.includes("crop") || normalizedMode === "center";
    const scale = useFill ? fillScale : fitScale;
    const drawWidth = Math.max(1, Math.round(srcW * scale));
    const drawHeight = Math.max(1, Math.round(srcH * scale));
    let dx = Math.round((targetWidth - drawWidth) / 2);
    let dy = Math.round((targetHeight - drawHeight) / 2);
    if (cropPosition === "top") dy = 0;
    if (cropPosition === "bottom") dy = targetHeight - drawHeight;
    if (cropPosition === "left") dx = 0;
    if (cropPosition === "right") dx = targetWidth - drawWidth;
    octx.drawImage(source, dx, dy, drawWidth, drawHeight);
    return output;
}

export function fitCanvas(source: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
    if ((source.width || 1) === Math.max(1, Math.round(width)) && (source.height || 1) === Math.max(1, Math.round(height))) {
    return source;
    }

    const output = makeCanvas(width, height);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    setResampleMode(octx, "bicubic");
    octx.clearRect(0, 0, output.width, output.height);
    octx.drawImage(source, 0, 0, output.width, output.height);
    if (isPreparedMaskCanvas(source)) {
    markPreparedMaskCanvas(output);
    }

    return output;
}

export function flipCanvas(source: HTMLCanvasElement, horizontal: boolean, vertical: boolean): HTMLCanvasElement {
    if (!horizontal && !vertical) return source;
    const output = makeCanvas(source.width || 1, source.height || 1);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.save();
    octx.translate(horizontal ? output.width : 0, vertical ? output.height : 0);
    octx.scale(horizontal ? -1 : 1, vertical ? -1 : 1);
    octx.drawImage(source, 0, 0, output.width, output.height);
    octx.restore();
    return output;
}

export function rotateDiscrete(source: HTMLCanvasElement, quarterTurns: number): HTMLCanvasElement {
    const turns = ((quarterTurns % 4) + 4) % 4;
    if (turns === 0) return source;
    const swap = turns % 2 === 1;
    const output = makeCanvas(swap ? source.height : source.width, swap ? source.width : source.height);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.translate(output.width / 2, output.height / 2);
    octx.rotate(turns * Math.PI / 2);
    octx.drawImage(source, -source.width / 2, -source.height / 2);
    return output;
}

export function reflectCoordinate(value: number, size: number): number {
    if (size <= 1) return 0;
    let coord = value;
    const max = size - 1;
    while (coord < 0 || coord > max) {
    if (coord < 0) coord = -coord;
    if (coord > max) coord = max - (coord - max);
    }

    return coord;
}

export function reflectCoord(value: number, maxInclusive: number): number {
    if (maxInclusive <= 0) return 0;
    const period = maxInclusive * 2;
    let x = value % period;
    if (x < 0) x += period;
    if (x > maxInclusive) x = period - x;
    return x;
}

export function resolveResizeDimensions(node: ComfyNode, sourceWidth: number, sourceHeight: number): { width: number; height: number; mode: string; filter: string; fillColor: string; cropPosition: string } {
    let width = Math.round(numAny(node, ["target_width", "width", "largest_size"], 0));
    let height = Math.round(numAny(node, ["target_height", "height", "largest_size"], 0));
    const scaleBy = numAny(node, ["scale_by", "multiplier"], 0);
    const megapixels = numAny(node, ["megapixels"], 0);
    const size = Math.round(numAny(node, ["size", "longer_size", "shorter_size"], 0));
    const filter = normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear"));
    const crop = strAny(node, ["crop", "crop_method"], "disabled");
    const method = strAny(node, ["keep_proportion", "method", "resize_type"], crop === "center" ? "crop" : "stretch");
    const keepProportion = boolAny(node, ["keep_proportion"], false);
    const fillColor = strAny(node, ["pad_color", "padding_color", "background_color", "color"], "#000000");
    const cropPosition = strAny(node, ["crop_position"], "center");
    if (scaleBy > 0) {
    width = Math.max(1, Math.round(sourceWidth * scaleBy));
    height = Math.max(1, Math.round(sourceHeight * scaleBy));
    } else if (size > 0) {
    const useLonger = !w(node, "mode") || bool(node, "mode", true) || String(strAny(node, ["resize_type"], "")).includes("longer");
    const dominant = useLonger ? Math.max(sourceWidth, sourceHeight) : Math.min(sourceWidth, sourceHeight);
    const ratio = size / Math.max(1, dominant);
    width = Math.max(1, Math.round(sourceWidth * ratio));
    height = Math.max(1, Math.round(sourceHeight * ratio));
    } else if (megapixels > 0) {
    const total = megapixels * 1024 * 1024;
    const ratio = sourceWidth / Math.max(1, sourceHeight);
    height = Math.max(1, Math.round(Math.sqrt(total / Math.max(0.0001, ratio))));
    width = Math.max(1, Math.round(height * ratio));
    } else if (width === 0 && height === 0) {
    width = sourceWidth;
    height = sourceHeight;
    } else if (width === 0) {
    width = Math.max(1, Math.round(sourceWidth * (height / Math.max(1, sourceHeight))));
    } else if (height === 0) {
    height = Math.max(1, Math.round(sourceHeight * (width / Math.max(1, sourceWidth))));
    }

    const multiple = Math.round(numAny(node, ["multiple_of", "divisible_by", "resolution_steps"], 0));
    if (multiple > 1) {
    width = Math.max(1, width - (width % multiple));
    height = Math.max(1, height - (height % multiple));
    }

    let mode = "stretch";
    const normalizedMethod = String(method).toLowerCase();
    if (keepProportion && normalizedMethod === "stretch" && crop !== "center") mode = "fit";
    else if (normalizedMethod.includes("pad") || normalizedMethod.includes("pillarbox")) mode = "pad";
    else if (normalizedMethod.includes("keep proportion") || normalizedMethod === "resize" || normalizedMethod.includes("fit")) mode = "fit";
    else if (normalizedMethod.includes("fill") || normalizedMethod.includes("crop") || crop === "center") mode = "crop";
    return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    mode,
    filter,
    fillColor,
    cropPosition,
    };
}

export function cropRectCanvas(source: HTMLCanvasElement, x: number, y: number, width: number, height: number): HTMLCanvasElement {
    const out = makeCanvas(Math.max(1, width), Math.max(1, height));
    const octx = out.getContext("2d", { willReadFrequently: true })!;
    octx.clearRect(0, 0, out.width, out.height);
    octx.drawImage(source, x, y, width, height, 0, 0, out.width, out.height);
    return out;
}

export function extractMaskDrivenCrop(source: HTMLCanvasElement, maskCanvas: HTMLCanvasElement | null, padding: number, targetWidth: number, targetHeight: number): HTMLCanvasElement {
    if (!maskCanvas) return resizeWithMode(source, targetWidth, targetHeight, "bicubic", "crop");
    const fittedMask = fitCanvas(maskCanvas, source.width || 1, source.height || 1);
    const bounds = computeMaskBounds(fittedMask);
    if (!bounds) return resizeWithMode(source, targetWidth, targetHeight, "bicubic", "crop");
    const pad = Math.max(0, Math.round(padding));
    const x = Math.max(0, bounds.x - pad);
    const y = Math.max(0, bounds.y - pad);
    const right = Math.min(source.width, bounds.x + bounds.width + pad);
    const bottom = Math.min(source.height, bounds.y + bounds.height + pad);
    const cropped = cropRectCanvas(source, x, y, Math.max(1, right - x), Math.max(1, bottom - y));
    return resizeWithMode(cropped, targetWidth, targetHeight, "bicubic", "crop");
}

export function parseCropStitchBBox(node: ComfyNode, sourceWidth: number, sourceHeight: number, frameIndex: number = 0): { x: number; y: number; width: number; height: number } | null {
    const raw = resolveConnectedString(node, "crop_bbox") ?? strAny(node, ["crop_bbox", "bbox"], "");
    if (!raw) return null;
    let payload: unknown = raw;
    try {
    payload = JSON.parse(raw);
    } catch {
    return null;
    }

    const root = Array.isArray(payload) ? payload[0] : payload;
    if (!root || typeof root !== "object") return null;
    const obj = root as any;
    const frames = Array.isArray(obj.frames) ? obj.frames : null;
    const bbox = frames
            ? frames[Math.max(0, Math.min(frames.length - 1, Math.round(frameIndex)))]
            : obj.bbox;
    if (!bbox || typeof bbox !== "object") return null;
    const width = Math.max(1, Math.min(sourceWidth, Math.round(Number(bbox.width) || sourceWidth)));
    const height = Math.max(1, Math.min(sourceHeight, Math.round(Number(bbox.height) || sourceHeight)));
    const x = Math.max(0, Math.min(sourceWidth - width, Math.round(Number(bbox.x) || 0)));
    const y = Math.max(0, Math.min(sourceHeight - height, Math.round(Number(bbox.y) || 0)));
    return { x, y, width, height };
}

export function cropStitchBBoxFromMask(maskCanvas: HTMLCanvasElement | null, width: number, height: number): { x: number; y: number; width: number; height: number } {
    if (!maskCanvas) return { x: 0, y: 0, width, height };
    const fittedMask = buildMaskAlphaCanvas(maskCanvas, width, height);
    const bounds = computeMaskBounds(fittedMask);
    return bounds ?? { x: 0, y: 0, width, height };
}

export function makeCropStitchRectMask(width: number, height: number, bbox: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
    const mask = makeCanvas(width, height);
    const mctx = mask.getContext("2d", { willReadFrequently: true })!;
    mctx.clearRect(0, 0, width, height);
    mctx.fillStyle = "#ffffff";
    mctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);
    return markPreparedMaskCanvas(mask);
}

export function renderCropStitchCanvases(node: ComfyNode, inputs: HTMLCanvasElement[], frameIndex: number = 0): { image: HTMLCanvasElement; mask: HTMLCanvasElement; crop: HTMLCanvasElement; bbox: { x: number; y: number; width: number; height: number } } {
    const original = inputs[0] ?? makeCanvas(1, 1);
    const crop = inputs[1] ?? original;
    const width = Math.max(1, original.width || 1);
    const height = Math.max(1, original.height || 1);
    const cropMaskInput = inputs[2] ?? null;
    const bbox = parseCropStitchBBox(node, width, height, frameIndex) ?? cropStitchBBoxFromMask(cropMaskInput, width, height);
    const fittedCrop = fitCanvas(crop, bbox.width, bbox.height);
    const stitchLayer = makeCanvas(width, height);
    const layerCtx = stitchLayer.getContext("2d", { willReadFrequently: true })!;
    layerCtx.clearRect(0, 0, width, height);
    layerCtx.drawImage(fittedCrop, bbox.x, bbox.y, bbox.width, bbox.height);
    let mask = cropMaskInput
            ? buildMaskAlphaCanvas(cropMaskInput, width, height)
            : makeCropStitchRectMask(width, height, bbox);
    const feather = Math.max(0, Math.round(numAny(node, ["feather"], 0, frameIndex)));
    if (feather > 0) mask = blurMaskAlphaCanvas(mask, feather);
    const image = boolAny(node, ["bypass"], false, frameIndex)
            ? original
            : compositeProcessedWithMask(original, stitchLayer, mask);
    return { image, mask, crop: fittedCrop, bbox };
}

export function drawCropStitchPanel(ctx: CanvasRenderingContext2D, source: HTMLCanvasElement, x: number, y: number, width: number, height: number, label: string, bbox?: { x: number; y: number; width: number; height: number } | null): void {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    const scale = Math.min(width / Math.max(1, source.width || 1), height / Math.max(1, source.height || 1));
    const drawWidth = Math.max(1, Math.round((source.width || 1) * scale));
    const drawHeight = Math.max(1, Math.round((source.height || 1) * scale));
    const dx = x + Math.round((width - drawWidth) / 2);
    const dy = y + Math.round((height - drawHeight) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, dx, dy, drawWidth, drawHeight);
    if (bbox) {
    const sx = drawWidth / Math.max(1, source.width || 1);
    const sy = drawHeight / Math.max(1, source.height || 1);
    ctx.strokeStyle = "rgba(235,239,140,0.96)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(dx + bbox.x * sx + 0.5, dy + bbox.y * sy + 0.5, bbox.width * sx, bbox.height * sy);
    }

    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(0,0,0,0.62)";
    ctx.fillRect(x, y, Math.min(width, 92), 20);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 7, y + 10);
    ctx.restore();
}

export function composeCropStitchPreview(image: HTMLCanvasElement, crop: HTMLCanvasElement, mask: HTMLCanvasElement, bbox: { x: number; y: number; width: number; height: number }): HTMLCanvasElement {
    const maskPreview = maskCanvasToPreviewCanvas(mask);
    const mainW = Math.max(1, image.width || 1);
    const mainH = Math.max(1, image.height || 1);
    const gap = Math.max(8, Math.round(Math.min(mainW, mainH) * 0.025));
    const sideW = Math.max(96, Math.round(mainW * 0.42));
    const sideH = Math.max(64, Math.round((mainH - gap) / 2));
    const output = makeCanvas(mainW + gap + sideW, Math.max(mainH, sideH * 2 + gap));
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.fillStyle = "#111111";
    octx.fillRect(0, 0, output.width, output.height);
    drawCropStitchPanel(octx, image, 0, 0, mainW, output.height, "Stitched", bbox);
    drawCropStitchPanel(octx, crop, mainW + gap, 0, sideW, sideH, "Edited crop");
    drawCropStitchPanel(octx, maskPreview, mainW + gap, sideH + gap, sideW, sideH, "Crop mask");
    return output;
}

export function stitchCanvases(a: HTMLCanvasElement, b: HTMLCanvasElement, direction: string, spacingWidth: number, spacingColor: string, matchSize: boolean): HTMLCanvasElement {
    const normalizedDirection = String(direction || "right").toLowerCase();
    const spacing = Math.max(0, Math.round(spacingWidth));
    const second = matchSize
            ? resizeWithMode(b, normalizedDirection === "up" || normalizedDirection === "down" ? a.width : b.width, normalizedDirection === "right" || normalizedDirection === "left" ? a.height : b.height, "bicubic", "stretch")
            : b;
    const horizontal = normalizedDirection === "right" || normalizedDirection === "left";
    const width = horizontal ? a.width + second.width + spacing : Math.max(a.width, second.width);
    const height = horizontal ? Math.max(a.height, second.height) : a.height + second.height + spacing;
    const output = makeCanvas(width, height);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    octx.fillStyle = parseHexColor(spacingColor);
    octx.fillRect(0, 0, width, height);
    if (normalizedDirection === "left") {
    octx.drawImage(second, 0, 0);
    octx.drawImage(a, second.width + spacing, 0);
    } else if (normalizedDirection === "up") {
    octx.drawImage(second, 0, 0);
    octx.drawImage(a, 0, second.height + spacing);
    } else if (normalizedDirection === "down") {
    octx.drawImage(a, 0, 0);
    octx.drawImage(second, 0, a.height + spacing);
    } else {
    octx.drawImage(a, 0, 0);
    octx.drawImage(second, a.width + spacing, 0);
    }

    return output;
}

export function normalizeAffineFillMode(value: string): string {
    const normalized = String(value || "transparent").trim().toLowerCase().replace(/[-\s]+/g, "_");
    if (normalized === "border" || normalized === "expand" || normalized === "edge" || normalized === "edge_extend" || normalized === "replicate" || normalized === "extend") return "expand";
    if (normalized === "reflect" || normalized === "reflection" || normalized === "mirror") return "mirror";
    if (normalized === "stretch" || normalized === "fill" || normalized === "cover") return "stretch";
    if (normalized === "color" || normalized === "colour" || normalized === "constant" || normalized === "solid") return "color";
    return "transparent";
}

export function applyTransform(ctx: CanvasRenderingContext2D, W: number, H: number, tx: number, ty: number, rotDeg: number, scale: number, filter: string, expand: boolean, fillMode: string = "transparent", fillColor: string = "#000000"): HTMLCanvasElement | void {
    void expand;
    const safeScale = Math.max(0.01, scale || 1);
    const normalizedFill = normalizeAffineFillMode(fillMode);
    const rad = rotDeg * Math.PI / 180;
    const needsScale = Math.abs(safeScale - 1) > 0.0001;
    const needsRotate = Math.abs(rotDeg) > 0.0001;
    const needsTranslate = tx !== 0 || ty !== 0;
    if (!needsScale && !needsRotate && !needsTranslate) return;
    const sourceCtx = ctx.canvas.getContext("2d", { willReadFrequently: true });
    if (!sourceCtx) return;
    const output = makeCanvas(W, H);
    const octx = output.getContext("2d", { willReadFrequently: true })!;
    setResampleMode(octx, filter);
    octx.clearRect(0, 0, W, H);
    if (normalizedFill === "color") {
    octx.fillStyle = parseHexColor(fillColor);
    octx.fillRect(0, 0, W, H);
    } else if (normalizedFill === "stretch") {
    octx.drawImage(ctx.canvas, 0, 0, W, H);
    }

    const srcImage = sourceCtx.getImageData(0, 0, W, H);
    const srcData = srcImage.data;
    const outImage = octx.getImageData(0, 0, W, H);
    const outData = outImage.data;
    const useNearest = filter === "nearest" || filter === "nearest-exact";
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const centerX = W / 2;
    const centerY = H / 2;
    const invScale = 1 / safeScale;
    for (let y = 0; y < H; y++) {
    const py = y + 0.5 - (centerY + ty);
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - (centerX + tx);
      let sx = (cos * px + sin * py) * invScale + centerX - 0.5;
      let sy = (-sin * px + cos * py) * invScale + centerY - 0.5;
      const inside = sx >= 0 && sx <= (W - 1) && sy >= 0 && sy <= (H - 1);
      if (!inside) {
        if (normalizedFill === "expand") {
          sx = Math.max(0, Math.min(W - 1, sx));
          sy = Math.max(0, Math.min(H - 1, sy));
        } else if (normalizedFill === "mirror") {
          sx = reflectCoord(sx, W - 1);
          sy = reflectCoord(sy, H - 1);
        } else {
          continue;
        }
      }

      const offset = (y * W + x) * 4;
      const sr = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 0) : sampleChannelBilinear(srcData, W, H, sx, sy, 0);
      const sg = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 1) : sampleChannelBilinear(srcData, W, H, sx, sy, 1);
      const sb = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 2) : sampleChannelBilinear(srcData, W, H, sx, sy, 2);
      const sa = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 3) : sampleChannelBilinear(srcData, W, H, sx, sy, 3);

      const fgA = clamp01(sa / 255);
      const bgA = clamp01(outData[offset + 3] / 255);
      const outA = fgA + bgA * (1 - fgA);
      const bgR = outData[offset] / 255;
      const bgG = outData[offset + 1] / 255;
      const bgB = outData[offset + 2] / 255;
      const premulR = (sr / 255) * fgA + bgR * bgA * (1 - fgA);
      const premulG = (sg / 255) * fgA + bgG * bgA * (1 - fgA);
      const premulB = (sb / 255) * fgA + bgB * bgA * (1 - fgA);

      outData[offset] = outA > 1e-6 ? Math.round(clamp01(premulR / outA) * 255) : 0;
      outData[offset + 1] = outA > 1e-6 ? Math.round(clamp01(premulG / outA) * 255) : 0;
      outData[offset + 2] = outA > 1e-6 ? Math.round(clamp01(premulB / outA) * 255) : 0;
      outData[offset + 3] = Math.round(clamp01(outA) * 255);
    }
    }

    octx.putImageData(outImage, 0, 0);
    return output;
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

export function solveLinear8x8(matrix: number[][], vector: number[]): number[] | null {
    const n = 8;
    const A = matrix.map((row) => row.slice());
    const b = vector.slice();
    for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const valueAbs = Math.abs(A[row][col]);
      if (valueAbs > pivotAbs) {
        pivot = row;
        pivotAbs = valueAbs;
      }
    }
    if (pivotAbs < 1e-10) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
      const vb = b[col];
      b[col] = b[pivot];
      b[pivot] = vb;
    }
    const inv = 1 / A[col][col];
    for (let c = col; c < n; c++) A[col][c] *= inv;
    b[col] *= inv;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c < n; c++) A[row][c] -= factor * A[col][c];
      b[row] -= factor * b[col];
    }
    }

    return b;
}

export function invert3x3(m: number[]): number[] | null {
    const a = m[0], b = m[1], c = m[2];
    const d = m[3], e = m[4], f = m[5];
    const g = m[6], h = m[7], i = m[8];
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const D = -(b * i - c * h);
    const E = a * i - c * g;
    const F = -(a * h - b * g);
    const G = b * f - c * e;
    const H = -(a * f - c * d);
    const I = a * e - b * d;
    const det = a * A + b * B + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-10) return null;
    const invDet = 1 / det;
    return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
}

export function solveCornerPinInverseHomography(node: ComfyNode, width: number, height: number, frameIndex: number = 0): number[] | null {
    const src = [
            [0, 0],
            [Math.max(0, width - 1), 0],
            [0, Math.max(0, height - 1)],
            [Math.max(0, width - 1), Math.max(0, height - 1)],
          ];
    const dst = [
            [numAny(node, ["tl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["tl_y"], 0, frameIndex) * Math.max(0, height - 1)],
            [numAny(node, ["tr_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["tr_y"], 0, frameIndex) * Math.max(0, height - 1)],
            [numAny(node, ["bl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["bl_y"], 1, frameIndex) * Math.max(0, height - 1)],
            [numAny(node, ["br_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["br_y"], 1, frameIndex) * Math.max(0, height - 1)],
          ];
    const A: number[][] = [];
    const b: number[] = [];
    for (let idx = 0; idx < 4; idx++) {
    const x = src[idx][0];
    const y = src[idx][1];
    const u = dst[idx][0];
    const v = dst[idx][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
    }

    const solved = solveLinear8x8(A, b);
    if (!solved) return null;
    const H = [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1];
    return invert3x3(H);
}

export function solveInverseHomographyFromCorners(sourceWidth: number, sourceHeight: number, corners: Record<CornerPinHandle, { x: number; y: number }>): number[] | null {
    const src = [
            [0, 0],
            [Math.max(0, sourceWidth - 1), 0],
            [0, Math.max(0, sourceHeight - 1)],
            [Math.max(0, sourceWidth - 1), Math.max(0, sourceHeight - 1)],
          ];
    const dst = [
            [corners.tl.x, corners.tl.y],
            [corners.tr.x, corners.tr.y],
            [corners.bl.x, corners.bl.y],
            [corners.br.x, corners.br.y],
          ];
    const A: number[][] = [];
    const b: number[] = [];
    for (let idx = 0; idx < 4; idx++) {
    const x = src[idx][0];
    const y = src[idx][1];
    const u = dst[idx][0];
    const v = dst[idx][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
    }

    const solved = solveLinear8x8(A, b);
    if (!solved) return null;
    return invert3x3([solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1]);
}

export function warpCanvasToQuad(source: HTMLCanvasElement, outputWidth: number, outputHeight: number, corners: Record<CornerPinHandle, { x: number; y: number }>, filter: string = "bilinear"): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
    const width = source.width || 1;
    const height = source.height || 1;
    const inverse = solveInverseHomographyFromCorners(width, height, corners);
    const image = makeCanvas(outputWidth, outputHeight);
    const mask = makeCanvas(outputWidth, outputHeight);
    if (!inverse) {
    markPreparedMaskCanvas(mask);
    return { image, mask };
    }

    const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
    const srcImage = sourceCtx.getImageData(0, 0, width, height);
    const srcData = srcImage.data;
    const imageCtx = image.getContext("2d", { willReadFrequently: true })!;
    const outImage = imageCtx.createImageData(outputWidth, outputHeight);
    const outData = outImage.data;
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    const outMask = maskCtx.createImageData(outputWidth, outputHeight);
    const outMaskData = outMask.data;
    const useNearest = filter === "nearest";
    const useBicubic = filter === "bicubic";
    for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const outOffset = (y * outputWidth + x) * 4;
      const denom = inverse[6] * x + inverse[7] * y + inverse[8];
      const safeDenom = Math.abs(denom) < 1e-8 ? (denom < 0 ? -1e-8 : 1e-8) : denom;
      const sx = (inverse[0] * x + inverse[1] * y + inverse[2]) / safeDenom;
      const sy = (inverse[3] * x + inverse[4] * y + inverse[5]) / safeDenom;
      const inside = sx >= 0 && sx <= (width - 1) && sy >= 0 && sy <= (height - 1);
      if (!inside) continue;

      const r = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 0)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 0)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
      const g = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 1)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 1)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
      const b = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 2)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 2)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
      const a = useNearest
        ? sampleChannelNearest(srcData, width, height, sx, sy, 3)
        : useBicubic
          ? sampleChannelBicubic(srcData, width, height, sx, sy, 3)
          : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
      outData[outOffset] = Math.round(clamp01(r / 255) * 255);
      outData[outOffset + 1] = Math.round(clamp01(g / 255) * 255);
      outData[outOffset + 2] = Math.round(clamp01(b / 255) * 255);
      outData[outOffset + 3] = Math.round(clamp01(a / 255) * 255);
      const alpha = Math.round(clamp01(a / 255) * 255);
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = alpha;
    }
    }

    imageCtx.putImageData(outImage, 0, 0);
    maskCtx.putImageData(outMask, 0, 0);
    markPreparedMaskCanvas(mask);
    return { image, mask };
}

export function renderCornerPinCanvases(node: ComfyNode, source: HTMLCanvasElement, frameIndex: number = 0): { image: HTMLCanvasElement; mask: HTMLCanvasElement } {
    const width = source.width || 1;
    const height = source.height || 1;
    const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
    const fillMode = normalizeAffineFillMode(strAny(node, ["fill_mode", "edge_mode"], "transparent", frameIndex));
    const fillColor = parseHexColor(strAny(node, ["fill_color"], "#000000", frameIndex));
    const supersample = Math.max(1, Math.min(4, Math.round(numAny(node, ["supersample"], 1, frameIndex))));
    const invertMask = boolAny(node, ["invert_mask"], false, frameIndex);
    const bypass = boolAny(node, ["bypass"], false, frameIndex);
    if (bypass) {
    const image = fitCanvas(source, width, height);
    const mask = makeCanvas(width, height);
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    if (!invertMask) {
      // mask=1 everywhere (white opaque) — new canvas is already transparent so only fill when mask=1
      maskCtx.fillStyle = "#FFFFFF";
      maskCtx.fillRect(0, 0, width, height);
    }
    // else mask=0 everywhere → canvas stays transparent (A=0)
    markPreparedMaskCanvas(mask);
    return { image, mask };
    }

    const inverse = solveCornerPinInverseHomography(node, width, height, frameIndex);
    if (!inverse) {
    const image = fitCanvas(source, width, height);
    const mask = makeCanvas(width, height);
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    if (invertMask) {
      // inverted + no valid transform → mask=1 everywhere
      maskCtx.fillStyle = "#FFFFFF";
      maskCtx.fillRect(0, 0, width, height);
    }
    // else mask=0 everywhere → canvas stays transparent (A=0)
    markPreparedMaskCanvas(mask);
    return { image, mask };
    }

    const sourceCtx = source.getContext("2d", { willReadFrequently: true })!;
    const srcImage = sourceCtx.getImageData(0, 0, width, height);
    const srcData = srcImage.data;
    const image = makeCanvas(width, height);
    const imageCtx = image.getContext("2d", { willReadFrequently: true })!;
    if (fillMode === "color") {
    imageCtx.fillStyle = fillColor;
    imageCtx.fillRect(0, 0, width, height);
    } else if (fillMode === "stretch") {
    imageCtx.drawImage(source, 0, 0, width, height);
    }

    const outImage = imageCtx.getImageData(0, 0, width, height);
    const outData = outImage.data;
    const mask = makeCanvas(width, height);
    const maskCtx = mask.getContext("2d", { willReadFrequently: true })!;
    const outMask = maskCtx.createImageData(width, height);
    const outMaskData = outMask.data;
    const useNearest = filter === "nearest";
    const useBicubic = filter === "bicubic";
    const sampleCount = supersample * supersample;
    for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outOffset = (y * width + x) * 4;
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;
      let alphaSum = 0;
      let insideSum = 0;
      // Track per-subsample coverage*alpha so the mask edge is supersampled
      // in lockstep with the colour: avg(cov_i * alpha_i) is more faithful than
      // avg(cov_i) * avg(alpha_i) on transparent or semi-covered edges.
      let coveredAlphaSum = 0;

      for (let subY = 0; subY < supersample; subY++) {
        const dstY = supersample === 1 ? y : y + (subY + 0.5) / supersample - 0.5;
        for (let subX = 0; subX < supersample; subX++) {
          const dstX = supersample === 1 ? x : x + (subX + 0.5) / supersample - 0.5;
          const denom = inverse[6] * dstX + inverse[7] * dstY + inverse[8];
          const safeDenom = Math.abs(denom) < 1e-8 ? (denom < 0 ? -1e-8 : 1e-8) : denom;
          let sx = (inverse[0] * dstX + inverse[1] * dstY + inverse[2]) / safeDenom;
          let sy = (inverse[3] * dstX + inverse[4] * dstY + inverse[5]) / safeDenom;
          const inside = sx >= 0 && sx <= (width - 1) && sy >= 0 && sy <= (height - 1);
          if (inside) insideSum += 1;
          if (!inside) {
            if (fillMode === "expand") {
              sx = Math.max(0, Math.min(width - 1, sx));
              sy = Math.max(0, Math.min(height - 1, sy));
            } else if (fillMode === "mirror") {
              sx = reflectCoord(sx, width - 1);
              sy = reflectCoord(sy, height - 1);
            } else {
              continue;
            }
          }

          const r = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 0)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 0)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
          const g = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 1)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 1)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
          const b = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 2)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 2)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
          const a = useNearest
            ? sampleChannelNearest(srcData, width, height, sx, sy, 3)
            : useBicubic
              ? sampleChannelBicubic(srcData, width, height, sx, sy, 3)
              : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
          premulR += r * (a / 255);
          premulG += g * (a / 255);
          premulB += b * (a / 255);
          alphaSum += a;
          if (inside) coveredAlphaSum += a;
        }
      }

      const alpha = alphaSum / sampleCount;
      const alpha01 = alpha / 255;
      const fgR = alpha01 > 1e-6 ? clamp01((premulR / sampleCount) / alpha01 / 255) : 0;
      const fgG = alpha01 > 1e-6 ? clamp01((premulG / sampleCount) / alpha01 / 255) : 0;
      const fgB = alpha01 > 1e-6 ? clamp01((premulB / sampleCount) / alpha01 / 255) : 0;
      const bgA = clamp01(outData[outOffset + 3] / 255);
      const bgR = outData[outOffset] / 255;
      const bgG = outData[outOffset + 1] / 255;
      const bgB = outData[outOffset + 2] / 255;
      const outA = alpha01 + bgA * (1 - alpha01);
      const premulOutR = fgR * alpha01 + bgR * bgA * (1 - alpha01);
      const premulOutG = fgG * alpha01 + bgG * bgA * (1 - alpha01);
      const premulOutB = fgB * alpha01 + bgB * bgA * (1 - alpha01);
      outData[outOffset] = outA > 1e-6 ? Math.round(clamp01(premulOutR / outA) * 255) : 0;
      outData[outOffset + 1] = outA > 1e-6 ? Math.round(clamp01(premulOutG / outA) * 255) : 0;
      outData[outOffset + 2] = outA > 1e-6 ? Math.round(clamp01(premulOutB / outA) * 255) : 0;
      outData[outOffset + 3] = Math.round(clamp01(outA) * 255);

      const maskValue = fillMode === "transparent"
        ? Math.round(clamp01(coveredAlphaSum / sampleCount / 255) * 255)
        : 255;
      const finalMask = invertMask ? 255 - maskValue : maskValue;
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = finalMask;
    }
    }

    imageCtx.putImageData(outImage, 0, 0);
    maskCtx.putImageData(outMask, 0, 0);
    markPreparedMaskCanvas(mask);
    return { image, mask };
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

export function applySpherize(ctx: CanvasRenderingContext2D, width: number, height: number, mode: string, strength: number, invert: boolean): void {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;
    const s = Math.max(0, strength);
    const m = String(mode || "spherize").toLowerCase();
    for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Normalised coords [-1, 1]
      const nx = (px / (width - 1)) * 2 - 1;
      const ny = (py / (height - 1)) * 2 - 1;
      const dstIdx = (py * width + px) * 4;

      // Outside the unit disk → transparent (only for disk-shaped projections).
      const isDiskMode = m !== "latlong" && m !== "unlatlong";
      if (isDiskMode && nx * nx + ny * ny > 1) {
        dd[dstIdx] = 0;
        dd[dstIdx + 1] = 0;
        dd[dstIdx + 2] = 0;
        dd[dstIdx + 3] = 0;
        continue;
      }

      let srcNx: number;
      let srcNy: number;

      if (!invert) {
        [srcNx, srcNy] = _spherizeMapFwd(nx, ny, m, s);
      } else {
        [srcNx, srcNy] = _spherizeMapInv(nx, ny, m, s);
      }

      // Back to pixel coords
      const sx = ((srcNx + 1) * 0.5) * (width - 1);
      const sy = ((srcNy + 1) * 0.5) * (height - 1);

      // Bilinear sample
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;

      // Clamp to image borders
      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      for (let c = 0; c < 4; c++) {
        const v00 = sd[(cy0 * width + cx0) * 4 + c];
        const v10 = sd[(cy0 * width + cx1) * 4 + c];
        const v01 = sd[(cy1 * width + cx0) * 4 + c];
        const v11 = sd[(cy1 * width + cx1) * 4 + c];
        dd[dstIdx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy,
        );
      }
    }
    }

    ctx.putImageData(dst, 0, 0);
}

export function _spherizeMapFwd(nx: number, ny: number, mode: string, s: number): [number, number] {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r < 1e-7) return [0, 0];
    if (mode === "spherize") {
    const t = r * Math.PI * 0.5;
    const scale = (Math.sin(t) / r) * s + (1 - s);
    return [nx * scale, ny * scale];
    }

    if (mode === "fisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rSrc = Math.sin(angle);
    return [nx / r * rSrc, ny / r * rSrc];
    }

    if (mode === "defisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rDst = Math.tan(Math.min(angle, 1.5)) / (Math.PI * 0.5 * s + 1e-8);
    const scale = rDst / (r + 1e-8);
    return [nx * scale, ny * scale];
    }

    if (mode === "latlong") {
    // Equirectangular → rectilinear: barrel-like, no tan singularity.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const lon = Math.atan(nx * fovTan);
    const lat = Math.atan(ny * fovTan);
    return [lon / atanFov, lat / atanFov];
    }

    if (mode === "unlatlong") {
    // Rectilinear → equirectangular: pincushion-like, inverse of latlong.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const clamp = atanFov * 0.9999;
    const srcX = Math.tan(Math.max(-clamp, Math.min(clamp, nx * atanFov))) / fovTan;
    const srcY = Math.tan(Math.max(-clamp, Math.min(clamp, ny * atanFov))) / fovTan;
    return [srcX, srcY];
    }

    return [nx, ny];
}

export function _spherizeMapInv(nx: number, ny: number, mode: string, s: number): [number, number] {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r < 1e-7) return [0, 0];
    if (mode === "spherize") {
    const rClamped = Math.min(r, 1);
    const scale = (Math.asin(rClamped) / (Math.PI * 0.5 * r + 1e-8)) * s + (1 - s);
    return [nx * scale, ny * scale];
    }

    if (mode === "fisheye") {
    // inverse fisheye = defisheye
    return _spherizeMapFwd(nx, ny, "defisheye", s);
    }

    if (mode === "defisheye") {
    return _spherizeMapFwd(nx, ny, "fisheye", s);
    }

    if (mode === "latlong") {
    return _spherizeMapFwd(nx, ny, "unlatlong", s);
    }

    if (mode === "unlatlong") {
    return _spherizeMapFwd(nx, ny, "latlong", s);
    }

    return [nx, ny];
}

export function distortConnectedInputs(node: ComfyNode, inputs: HTMLCanvasElement[]): { source: HTMLCanvasElement; displacement: HTMLCanvasElement | null; mask: HTMLCanvasElement | null } {
    const source = inputs[0];
    const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
    const maskConnected = (node.inputs?.[2]?.link ?? null) != null;
    let cursor = 1;
    const displacement = displacementConnected ? (inputs[cursor++] ?? null) : null;
    const mask = maskConnected ? (inputs[cursor] ?? null) : null;
    return { source, displacement, mask };
}

export function renderDistortCanvas(node: ComfyNode, inputs: HTMLCanvasElement[], frameIndex: number = 0): { image: HTMLCanvasElement; mask: HTMLCanvasElement | null } {
    const { source, displacement, mask: rawMask } = distortConnectedInputs(node, inputs);
    const width = source.width || 1;
    const height = source.height || 1;
    const mapSource = strAny(node, ["map_source"], "source_channel", frameIndex).toLowerCase();
    const centeredMap = boolAny(node, ["centered_map"], true, frameIndex);
    const invertMap = boolAny(node, ["invert_map"], false, frameIndex);
    const effectMask = mapSource === "mask" ? null : resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
    let previewMask: HTMLCanvasElement | null = null;
    let xField: Float32Array;
    let yField: Float32Array;
    if (mapSource === "mask") {
    if (rawMask) {
      const maskCanvas = buildMaskAlphaCanvas(rawMask, width, height);
      previewMask = invertMap ? invertMaskCanvas(maskCanvas) : maskCanvas;
      xField = extractCanvasField(previewMask, width, height, "red");
      yField = xField;
    } else {
      xField = neutralField(width, height, centeredMap);
      yField = xField;
    }
    } else {
    const driver = mapSource === "displacement_channel" && displacement ? displacement : source;
    const xChannel = strAny(node, ["x_channel"], "Red", frameIndex);
    const yChannel = strAny(node, ["y_channel"], "Green", frameIndex);
    xField = extractCanvasField(driver, width, height, xChannel);
    yField = String(xChannel).toLowerCase() === String(yChannel).toLowerCase()
      ? xField
      : extractCanvasField(driver, width, height, yChannel);
    }

    const blurRadius = Math.max(0, Math.round(numAny(node, ["blur_map"], 0, frameIndex)));
    if (blurRadius > 0) {
    xField = blurField(xField, width, height, blurRadius);
    yField = xField === yField ? xField : blurField(yField, width, height, blurRadius);
    }

    const sourceCanvas = source;
    const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true })!;
    const sourceData = sourceCtx.getImageData(0, 0, width, height);
    const output = makeCanvas(width, height);
    const outCtx = output.getContext("2d", { willReadFrequently: true })!;
    const outImage = outCtx.createImageData(width, height);
    const outData = outImage.data;
    const strengthX = numAny(node, ["strength_x"], 40, frameIndex);
    const strengthY = numAny(node, ["strength_y"], 40, frameIndex);
    const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
    const edgeMode = strAny(node, ["edge_mode"], "border", frameIndex).toLowerCase();
    const useNearest = filter === "nearest";
    for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      let fx = xField[index];
      let fy = yField[index];
      if (invertMap && mapSource !== "mask") {
        fx = 1 - fx;
        fy = 1 - fy;
      }
      if (centeredMap) {
        fx = fx * 2 - 1;
        fy = fy * 2 - 1;
      }
      const sampleX = x - fx * strengthX;
      const sampleY = y - fy * strengthY;
      const rgba = useNearest
        ? sampleChannel(sourceData.data, width, height, Math.round(sampleX), Math.round(sampleY), edgeMode)
        : bilinearSample(sourceData.data, width, height, sampleX, sampleY, edgeMode);
      const offset = index * 4;
      outData[offset] = Math.round(clamp01(rgba[0] / 255) * 255);
      outData[offset + 1] = Math.round(clamp01(rgba[1] / 255) * 255);
      outData[offset + 2] = Math.round(clamp01(rgba[2] / 255) * 255);
      outData[offset + 3] = Math.round(clamp01(rgba[3] / 255) * 255);
    }
    }

    outCtx.putImageData(outImage, 0, 0);
    const finalImage = effectMask ? compositeProcessedWithMask(sourceCanvas, output, effectMask) : output;
    if (effectMask) return { image: finalImage, mask: effectMask };
    if (previewMask) return { image: finalImage, mask: previewMask };
    return { image: finalImage, mask: alphaMaskCanvas(finalImage) };
}

export function extractCanvasField(canvas: HTMLCanvasElement, width: number, height: number, channel: string): Float32Array {
    const normalized = String(channel || "red").toLowerCase();
    const cacheKey = `${Math.max(1, width)}x${Math.max(1, height)}:${normalized}`;
    const cachedField = canvasFieldCache.get(canvas)?.get(cacheKey);
    if (cachedField) return cachedField;
    const fitted = (canvas.width || 1) === width && (canvas.height || 1) === height
            ? canvas
            : fitCanvas(canvas, width, height);
    const data = fitted.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
    const field = new Float32Array(width * height);
    const weights = getOpsConstants().luma_weights;
    const preparedMask = isPreparedMaskCanvas(fitted);
    for (let index = 0; index < field.length; index++) {
    const offset = index * 4;
    const r = data[offset] / 255;
    const g = data[offset + 1] / 255;
    const b = data[offset + 2] / 255;
    const a = data[offset + 3] / 255;
    if (preparedMask) {
      field[index] = a;
      continue;
    }
    if (normalized === "green") field[index] = g;
    else if (normalized === "blue") field[index] = b;
    else if (normalized === "alpha") field[index] = a;
    else if (normalized === "luma") field[index] = clamp01(luma01(r, g, b, weights));
    else field[index] = r;
    }

    const cache = canvasFieldCache.get(canvas) ?? new Map<string, Float32Array>();
    cache.set(cacheKey, field);
    canvasFieldCache.set(canvas, cache);
    return field;
}

export function neutralField(width: number, height: number, centered: boolean): Float32Array {
    const field = new Float32Array(width * height);
    field.fill(centered ? 0.5 : 0);
    return field;
}

export function blurField(field: Float32Array, width: number, height: number, radiusPx: number): Float32Array {
    const r = Math.max(0, Math.round(radiusPx));
    if (r <= 0 || width < 2 || height < 2) return field;
    const passes = 3;
    let src = new Float32Array(field);
    let dst = new Float32Array(field.length);
    const win = 2 * r + 1;
    for (let p = 0; p < passes; p++) {
    // Horizontal
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const xi = i < 0 ? -i : i;
        sum += src[row + Math.min(width - 1, xi)];
      }
      dst[row] = sum / win;
      for (let x = 1; x < width; x++) {
        const addX = x + r;
        const remX = x - r - 1;
        const addCoord = addX >= width ? (2 * (width - 1) - addX) : addX;
        const remCoord = remX < 0 ? -remX : remX;
        sum += src[row + Math.max(0, Math.min(width - 1, addCoord))];
        sum -= src[row + Math.max(0, Math.min(width - 1, remCoord))];
        dst[row + x] = sum / win;
      }
    }
    [src, dst] = [dst, src];
    // Vertical
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let i = -r; i <= r; i++) {
        const yi = i < 0 ? -i : i;
        sum += src[Math.min(height - 1, yi) * width + x];
      }
      dst[x] = sum / win;
      for (let y = 1; y < height; y++) {
        const addY = y + r;
        const remY = y - r - 1;
        const addCoord = addY >= height ? (2 * (height - 1) - addY) : addY;
        const remCoord = remY < 0 ? -remY : remY;
        sum += src[Math.max(0, Math.min(height - 1, addCoord)) * width + x];
        sum -= src[Math.max(0, Math.min(height - 1, remCoord)) * width + x];
        dst[y * width + x] = sum / win;
      }
    }
    [src, dst] = [dst, src];
    }

    return src;
}

export function setResampleMode(ctx: CanvasRenderingContext2D, filter: string): void {
    const mode = String(filter || "bilinear").toLowerCase();
    ctx.imageSmoothingEnabled = mode !== "nearest";
    if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
    }
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
