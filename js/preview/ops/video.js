import { ops } from "./implementation.js";
const videoOps = {
  draw: ops.draw,
  drawMask: ops.drawMask,
  keyer: ops.keyer,
  stitch: ops.stitch,
  channelSplit: ops.channelSplit,
  channelMerge: ops.channelMerge
};
export {
  videoOps
};
