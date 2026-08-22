import { ops } from "./implementation.js";
import { blendChannel01 } from "../shared/blend-modes.js";
const blendOps = {
  merge: ops.merge,
  composite: ops.composite,
  comp: ops.comp
};
export {
  blendChannel01,
  blendOps
};
