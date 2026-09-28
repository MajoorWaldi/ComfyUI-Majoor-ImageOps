import type { ComfyNode } from "../../types.js";
import { makeCanvas } from "../draw.js";
import { getRotoKeyFrame, getRotoSourceSize } from "../nodes/roto.js";
import { evalShape, parseDoc, type RotoPoint } from "../shared/roto-shapes.js";
import { widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
import { fitWithinMaxSize } from "../source.js";

const TINT = "rgb(255, 59, 92)";

function tracePath(ctx: CanvasRenderingContext2D, pts: RotoPoint[], closed: boolean, width: number, height: number): void {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[0][0] * width, pts[0][1] * height);
  const segments = closed ? n : n - 1;
  for (let i = 0; i < segments; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    ctx.bezierCurveTo((a[0] + a[4]) * width, (a[1] + a[5]) * height, (b[0] + b[2]) * width, (b[1] + b[3]) * height, b[0] * width, b[1] * height);
  }
  ctx.closePath();
}

function drawBlurred(target: CanvasRenderingContext2D, source: HTMLCanvasElement, sigma: number): void {
  target.filter = sigma > 0 ? `blur(${sigma}px)` : "none";
  target.drawImage(source, 0, 0);
  target.filter = "none";
}

// White canvas whose alpha channel is the composited matte.
export function renderMatteCanvas(node: ComfyNode, width: number, height: number, scale: number): HTMLCanvasElement {
  const frame = getRotoKeyFrame(node);
  const expand = widgetNumber(node, "expand", 0) * scale;
  const feather = widgetNumber(node, "feather", 0) * scale;
  const opacity = Math.min(1, Math.max(0, widgetNumber(node, "opacity", 1)));
  const invert = widgetBoolean(node, "invert", false);
  const matte = makeCanvas(width, height);
  const mctx = matte.getContext("2d")!;
  const layer = makeCanvas(width, height);
  const lctx = layer.getContext("2d")!;
  for (const shape of parseDoc(widgetString(node, "shapes", "")).shapes) {
    if (!shape.visible) continue;
    const pts = evalShape(shape, frame);
    if (pts.length < 2) continue;
    const shapeExpand = shape.op === "subtract" ? -expand : expand;
    lctx.clearRect(0, 0, width, height);
    lctx.globalCompositeOperation = "source-over";
    lctx.fillStyle = "#fff";
    lctx.strokeStyle = "#fff";
    tracePath(lctx, pts, shape.closed, width, height);
    lctx.fill();
    if (shapeExpand !== 0) {
      lctx.globalCompositeOperation = shapeExpand > 0 ? "source-over" : "destination-out";
      lctx.lineWidth = Math.abs(shapeExpand) * 2;
      lctx.lineJoin = "round";
      lctx.stroke();
      lctx.globalCompositeOperation = "source-over";
    }
    mctx.globalAlpha = shape.opacity;
    mctx.globalCompositeOperation = shape.op === "subtract" ? "destination-out" : shape.op === "intersect" ? "destination-in" : "source-over";
    drawBlurred(mctx, layer, shape.feather * 0.5 * scale);
    mctx.globalAlpha = 1;
    mctx.globalCompositeOperation = "source-over";
  }
  const out = makeCanvas(width, height);
  const octx = out.getContext("2d")!;
  if (invert) {
    octx.fillStyle = "#fff";
    octx.fillRect(0, 0, width, height);
    octx.globalCompositeOperation = "destination-out";
  }
  octx.globalAlpha = opacity;
  drawBlurred(octx, matte, feather * 0.5);
  return out;
}

function toGray(matte: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(matte.width, matte.height);
  const octx = out.getContext("2d")!;
  octx.fillStyle = "#000";
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(matte, 0, 0);
  return out;
}

function cutout(source: HTMLCanvasElement, matte: HTMLCanvasElement): HTMLCanvasElement {
  const out = makeCanvas(matte.width, matte.height);
  const octx = out.getContext("2d")!;
  octx.drawImage(source, 0, 0, out.width, out.height);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(matte, 0, 0);
  return out;
}

function drawChecker(octx: CanvasRenderingContext2D, width: number, height: number): void {
  const cell = 12;
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      octx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#3a3a3a" : "#2a2a2a";
      octx.fillRect(x, y, cell, cell);
    }
  }
}

// outputSlot: null renders the node's own preview (honours `view`), 0 the IMAGE output, 1 the MASK output.
export function roto(_ctx: CanvasRenderingContext2D, canvasSize: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], _tick = 0, outputSlot: number | null = null): HTMLCanvasElement {
  const source = inputs[0] ?? null;
  let width: number;
  let height: number;
  if (source) {
    width = source.width || 1;
    height = source.height || 1;
  } else {
    const fit = fitWithinMaxSize(widgetNumber(node, "width", 1024), widgetNumber(node, "height", 1024), canvasSize);
    width = fit.width;
    height = fit.height;
  }
  const sourceWidth = getRotoSourceSize(node, width, height).width;
  const matte = renderMatteCanvas(node, width, height, width / Math.max(1, sourceWidth));
  if (outputSlot === 1) return toGray(matte);
  if (outputSlot != null) return source ? cutout(source, matte) : toGray(matte);
  const view = widgetString(node, "view", "overlay");
  if (view === "matte") return toGray(matte);
  const out = makeCanvas(width, height);
  const octx = out.getContext("2d")!;
  if (view === "result") {
    drawChecker(octx, width, height);
    octx.drawImage(source ? cutout(source, matte) : toGray(matte), 0, 0);
    return out;
  }
  if (source) {
    octx.drawImage(source, 0, 0, width, height);
  } else {
    octx.fillStyle = "#1a1a1a";
    octx.fillRect(0, 0, width, height);
  }
  const tint = makeCanvas(width, height);
  const tctx = tint.getContext("2d")!;
  tctx.drawImage(matte, 0, 0);
  tctx.globalCompositeOperation = "source-in";
  tctx.fillStyle = TINT;
  tctx.fillRect(0, 0, width, height);
  octx.globalAlpha = 0.5;
  octx.drawImage(tint, 0, 0);
  octx.globalAlpha = 1;
  return out;
}
