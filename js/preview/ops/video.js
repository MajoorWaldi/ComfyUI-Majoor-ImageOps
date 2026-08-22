import {
  extractSplitChannelCanvas,
  mergeChannelInputs,
  strAny
} from "./implementation.js";
function channelSplit(ctx, W, node, outputSlot) {
  return extractSplitChannelCanvas(ctx.canvas, outputSlot, strAny(node, ["mode"], "RGBA"));
}
function channelMerge(ctx, W, node, inputs) {
  return mergeChannelInputs(inputs, strAny(node, ["mode"], "RGBA")) ?? (inputs[0] ?? ctx.canvas);
}
const videoOps = { channelSplit, channelMerge };
export {
  channelMerge,
  channelSplit,
  videoOps
};
