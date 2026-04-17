const NODE_CLASS = "ImageOpsBlur";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
export {
  NODE_CLASS,
  isNode
};
