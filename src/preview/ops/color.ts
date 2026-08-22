import { ops } from "./implementation.js";
export { applyColorCorrectGL, isWebGLColorAvailable } from "../shared/webgl-color.js";
export type { ColorCorrectParams } from "../shared/webgl-color.js";

export const colorOps = {
  colorAjust: ops.colorAjust,
  colorCorrect: ops.colorCorrect,
  levels: ops.levels,
  hueSat: ops.hueSat,
  desaturate: ops.desaturate,
  invert: ops.invert,
  clamp: ops.clamp,
  channel: ops.channel,
  lumaKey: ops.lumaKey,
  sharpen: ops.sharpen,
  edgeDetect: ops.edgeDetect,
  glow: ops.glow,
};
