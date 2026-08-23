import { initOpsConstants } from "../constants.js";
import { comp, composite, merge } from "./blend.js";
import { cameraShake, cornerPin, crop, cropGeneric, cropReformat, cropStitch, distort, flipRotate, pad, padOut, resize, spherize, transform } from "./geometry.js";
import { channelApply, imageOpsMask } from "./masks.js";
import { constant, draw, drawMask, grain, keyer, noise, ramp, stitch, text } from "./procedural.js";
import { channelMerge, channelSplit } from "./video.js";
import { colorAjust, colorCorrect, blur, channel, levels, hueSat, invert, clamp, sharpen, edgeDetect, glow, lumaKey, desaturate } from "./color.js";
initOpsConstants();
const ops = {
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
  colorAjust,
  colorCorrect,
  blur,
  channel,
  levels,
  hueSat,
  invert,
  clamp,
  sharpen,
  edgeDetect,
  glow,
  lumaKey,
  desaturate
};
export {
  ops
};
