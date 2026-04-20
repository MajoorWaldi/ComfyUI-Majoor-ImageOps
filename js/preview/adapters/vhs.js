function vhsAdapters() {
  return [
    {
      name: "vhs:passthrough",
      match(node) {
        return String(node?.comfyClass ?? "").startsWith("VHS_");
      },
      inputs: 1,
      apply() {
      }
    }
  ];
}
export {
  vhsAdapters
};
