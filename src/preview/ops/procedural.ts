import { renderDrawPreview, resolveDrawOverlayCanvas } from "../draw.js";
import {
    boolAny,
    buildMaskAlphaCanvas,
    getImageData,
    invertMaskCanvas,
    makeCanvas,
    markPreparedMaskCanvas,
    numAny,
    putImageData,
    renderConstantCanvas,
    renderGrainCanvas,
    renderKeyerCanvases,
    renderNoiseCanvas,
    renderRampCanvas,
    renderTextCanvas,
    stitchCanvases,
    strAny
} from "./implementation.js";
import type { ComfyNode } from "../../types.js";

// Extracted with ts-morph

export function grain(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderGrainCanvas(node, source, inputs[1] ?? null, frameIndex);
  }

export function text(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderTextCanvas(node, source, inputs[1] ?? null, frameIndex);
  }

export function keyer(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    const source = inputs[0] ?? ctx.canvas;
    return renderKeyerCanvases(node, source, inputs[1] ?? null, frameIndex).image;
  }

export function stitch(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): HTMLCanvasElement {
    const first = inputs[0] ?? ctx.canvas;
    const second = inputs[1] ?? null;
    if (!second) return first;
    return stitchCanvases(
      first,
      second,
      strAny(node, ["direction"], "right"),
      numAny(node, ["spacing_width"], 0),
      strAny(node, ["spacing_color"], "black"),
      boolAny(node, ["match_image_size"], true),
    );
  }

export function constant(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    return renderConstantCanvas(node, false);
  }

export function ramp(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode): HTMLCanvasElement {
    return renderRampCanvas(node, false);
  }

export function noise(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, frameIndex: number = 0): HTMLCanvasElement {
    return renderNoiseCanvas(node, false, frameIndex, W);
  }

export async function draw(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    return await renderDrawPreview(node, inputs[0] ?? null);
  }

export async function drawMask(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[]): Promise<HTMLCanvasElement> {
    const base = inputs[0] ?? null;
    const width = base?.width || Math.max(1, Math.round(numAny(node, ["width"], 1024)));
    const height = base?.height || Math.max(1, Math.round(numAny(node, ["height"], 1024)));
    const overlay = await resolveDrawOverlayCanvas(node, width, height);
    // Backend draw.py returns overlay_alpha[..., 0] as the mask (alpha channel
    // only, brush colour is irrelevant). buildMaskAlphaCanvas applies luma*alpha
    // which would dim the preview mask whenever the user paints with a non-white
    // colour — that diverges from the backend. Build an alpha-only matte instead.
    const ow = overlay.width || 1;
    const oh = overlay.height || 1;
    const matte = makeCanvas(ow, oh);
    const mctx = matte.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(overlay, 0, 0);
    const img = mctx.getImageData(0, 0, ow, oh);
    const data = img.data;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = a;
    }
    mctx.putImageData(img, 0, 0);
    const mask = markPreparedMaskCanvas(matte);
    return boolAny(node, ["invert_mask"], false) ? invertMaskCanvas(mask) : mask;
  }

export const proceduralOps = { constant, ramp, noise, grain, text };

