const NODE_CLASS = "ImageOpsChannel";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
export {
  NODE_CLASS,
  isNode
};
