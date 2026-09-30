import type { ComfyNode } from "../../../types.js";
import { resolveConnectedString, strAny, numAny, boolAny } from "../../graph.js";
import { makeCanvas } from "../../renderer.js";
import { parseHexColor } from "../color.js";
import { blurMaskAlphaCanvas, buildMaskAlphaCanvas, compositeProcessedWithMask, computeMaskBounds, maskCanvasToPreviewCanvas, markPreparedMaskCanvas } from "../masks.js";
import { fitCanvas, resizeWithMode } from "./canvas-basics.js";

export function cropStitch(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    if (inputs.length < 2) return inputs[0] ?? ctx.canvas;
    const rendered = renderCropStitchCanvases(node, inputs, frameIndex);
    return composeCropStitchPreview(rendered.image, rendered.crop, rendered.mask, rendered.bbox);
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
