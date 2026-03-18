// VideoHelperSuite / VHS adapters placeholder (v6)
// We generally treat VHS nodes as SOURCES, not ops. This file is kept to extend interop if needed.
import type { Adapter, ComfyNode } from "../../types.js";

export function vhsAdapters(): Adapter[] {
  return [
    {
      name: "vhs:passthrough",
      match(node: ComfyNode): boolean {
        const n = String(node?.comfyClass ?? "");
        return n.startsWith("VHS_");
      },
      inputs: 1,
      async apply(): Promise<void> { /* no-op */ }
    },
  ];
}
