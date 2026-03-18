function vhsAdapters() {
  return [
    {
      name: "vhs:passthrough",
      match(node) {
        const n = String(node?.comfyClass ?? "");
        return n.startsWith("VHS_");
      },
      inputs: 1,
      async apply() {
      }
    }
  ];
}
export {
  vhsAdapters
};
