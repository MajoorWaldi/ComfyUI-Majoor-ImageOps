import {
  extractSplitChannelCanvas,
  mergeChannelInputs,
  ops,
  strAny
} from "./implementation.js";
const videoOps = {
  draw: ops.draw,
  drawMask: ops.drawMask,
  keyer: ops.keyer,
  stitch: ops.stitch,
  channelSplit: ops.channelSplit,
  channelMerge: ops.channelMerge
};
function channelSplit(ctx, W, node, outputSlot) {
  return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
}
function channelMerge(ctx, W, node, inputs) {
  return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
}
export {
  channelMerge,
  channelSplit,
  videoOps
};
