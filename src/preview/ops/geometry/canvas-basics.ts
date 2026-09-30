import type { ComfyNode } from "../../../types.js";
import { bool, boolAny, normalizeFilterName, numAny, strAny, w } from "../../graph.js";
import { makeCanvas } from "../../renderer.js";
import { parseHexColor } from "../color.js";
import { computeMaskBounds, isPreparedMaskCanvas, markPreparedMaskCanvas } from "../masks.js";
import { setResampleMode } from "./sampling.js";

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
