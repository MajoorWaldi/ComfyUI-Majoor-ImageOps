import { ops } from "./implementation.js";
export { blendChannel01 } from "../shared/blend-modes.js";

export const blendOps = {
  merge: ops.merge,
  composite: ops.composite,
  comp: ops.comp,
};
