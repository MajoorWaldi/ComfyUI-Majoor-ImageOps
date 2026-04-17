const NODE_CLASS = "ImageOpsInvert";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
export {
  NODE_CLASS,
  isNode
};
