// VideoHelperSuite / VHS adapters placeholder (v6)
// We generally treat VHS nodes as SOURCES, not ops. This file is kept to extend interop if needed.
export function vhsAdapters() {
  return [
    {
      name: "vhs:passthrough",
      match(node) {
        const n = String(node?.comfyClass ?? "");
        return n.startsWith("VHS_");
      },
      inputs: 1,
      async apply() { /* no-op */ }
    },
  ];
}
