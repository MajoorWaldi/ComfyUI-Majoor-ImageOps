// Shared ops implementation for live preview (v6)
// IMPORTANT: this module is the single place implementing preview ops. Nodes must not duplicate preview code.
import type { ComfyNode } from "../../types.js";
import { initOpsConstants } from "../constants.js";
import { makeCanvas } from "../draw.js";
import { boolAny, numAny, strAny, wAny } from "../graph.js";
import { applyEffectToCanvas, getCanvasDimensions } from "../renderer.js";
import { acquireCanvas, releaseCanvas } from "../shared/canvas-pool.js";
import { applyGlow, comp, composite, merge } from "./blend.js";
import { applyBlur, applyClamp, applyColorCorrectReference, applyDesaturate, applyEdgeDetect, applyHueSat, applyInvert, applyLevels, applyLumaKey, applyUnsharp } from "./color.js";
import { cameraShake, cornerPin, crop, cropGeneric, cropReformat, cropStitch, distort, flipRotate, pad, padOut, resize, spherize, transform } from "./geometry.js";
import { buildMaskAlphaCanvas, channelApply, imageOpsMask, renderMaskedEffectPreview, resolvePreviewMaskCanvas } from "./masks.js";
import { constant, draw, drawMask, grain, keyer, noise, ramp, stitch, text } from "./procedural.js";
import { applyChannel, channelMerge, channelSplit, extractSplitChannelCanvas } from "./video.js";
import { colorAjust, colorCorrect, blur, channel, levels, hueSat, invert, clamp, sharpen, edgeDetect, glow, lumaKey, desaturate } from "./color.js";

initOpsConstants();
// Follow a STRING input connection to read the upstream widget's current value.
// Returns null if the input is not connected or no string widget found upstream.
// Precomputed 3D gradient table — 16 entries (padded from Perlin's 12 unit vectors).
// Using a table eliminates Math.cos, Math.sin, Math.sqrt per gradient evaluation
// (previously called twice per lattice corner). With 5 Perlin octaves this saves
// ~80 trig/sqrt calls per pixel.
// CPU pixel loop runs synchronously on the main thread, so cap lower than general canvasSize.
// Approximate gaussian blur with 3 separable box passes (mirror padding).
// W3C composite spec D() helper for soft-light — matches Python's _soft_light_curve.
export const ops = {
  crop,
  cropStitch,
  padOut,
  cornerPin,
  cropGeneric,
  transform,
  cameraShake,
  grain,
  text,
  keyer,
  cropReformat,
  merge,
  resize,
  pad,
  flipRotate,
  composite,
  stitch,
  channelSplit,
  channelMerge,
  channelApply,
  comp,
  distort,
  spherize,
  constant,
  ramp,
  noise,
  draw,
  drawMask,
  imageOpsMask,
    colorAjust: colorAjust,
    colorCorrect: colorCorrect,
    blur: blur,
    channel: channel,
    levels: levels,
    hueSat: hueSat,
    invert: invert,
    clamp: clamp,
    sharpen: sharpen,
    edgeDetect: edgeDetect,
    glow: glow,
    lumaKey: lumaKey,
    desaturate: desaturate
};
