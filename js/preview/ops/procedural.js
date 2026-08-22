import { renderDrawPreview, resolveDrawOverlayCanvas } from "../draw.js";
import {
  boolAny,
  invertMaskCanvas,
  makeCanvas,
  markPreparedMaskCanvas,
  numAny,
  ops,
  renderConstantCanvas,
  renderGrainCanvas,
  renderKeyerCanvases,
  renderNoiseCanvas,
  renderRampCanvas,
  renderTextCanvas,
  stitchCanvases,
  strAny
} from "./implementation.js";
const proceduralOps = {
  constant: ops.constant,
  ramp: ops.ramp,
  noise: ops.noise,
  grain: ops.grain,
  text: ops.text
};
function grain(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderGrainCanvas(node, source, inputs[1] ?? null, frameIndex);
}
function text(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderTextCanvas(node, source, inputs[1] ?? null, frameIndex);
}
function keyer(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderKeyerCanvases(node, source, inputs[1] ?? null, frameIndex).image;
}
function stitch(ctx, W, node, inputs) {
  const first = inputs[0] ?? ctx.canvas;
  const second = inputs[1] ?? null;
  if (!second) return first;
  return stitchCanvases(
    first,
    second,
    strAny(node, ["direction"], "right"),
    numAny(node, ["spacing_width"], 0),
    strAny(node, ["spacing_color"], "black"),
    boolAny(node, ["match_image_size"], true)
  );
}
function constant(ctx, W, node) {
  return renderConstantCanvas(node, false);
}
function ramp(ctx, W, node) {
  return renderRampCanvas(node, false);
}
function noise(ctx, W, node, frameIndex = 0) {
  return renderNoiseCanvas(node, false, frameIndex, W);
}
async function draw(ctx, W, node, inputs) {
  return await renderDrawPreview(node, inputs[0] ?? null);
}
async function drawMask(ctx, W, node, inputs) {
  const base = inputs[0] ?? null;
  const width = base?.width || Math.max(1, Math.round(numAny(node, ["width"], 1024)));
  const height = base?.height || Math.max(1, Math.round(numAny(node, ["height"], 1024)));
  const overlay = await resolveDrawOverlayCanvas(node, width, height);
  const ow = overlay.width || 1;
  const oh = overlay.height || 1;
  const matte = makeCanvas(ow, oh);
  const mctx = matte.getContext("2d", { willReadFrequently: true });
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
export {
  constant,
  draw,
  drawMask,
  grain,
  keyer,
  noise,
  proceduralOps,
  ramp,
  stitch,
  text
};
