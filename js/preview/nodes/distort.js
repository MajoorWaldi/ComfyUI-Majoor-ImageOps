const NODE_CLASS = "ImageOpsDistort";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
export {
  NODE_CLASS,
  isNode
};
