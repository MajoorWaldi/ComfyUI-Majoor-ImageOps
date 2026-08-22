import { ops } from "./implementation.js";
export * from "../shared/geometry.js";

export const geometryOps = {
  crop: ops.crop,
  cropGeneric: ops.cropGeneric,
  cropReformat: ops.cropReformat,
  cropStitch: ops.cropStitch,
  pad: ops.pad,
  padOut: ops.padOut,
  resize: ops.resize,
  transform: ops.transform,
  flipRotate: ops.flipRotate,
  cornerPin: ops.cornerPin,
  cameraShake: ops.cameraShake,
  distort: ops.distort,
  spherize: ops.spherize,
};
