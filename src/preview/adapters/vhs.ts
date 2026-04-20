// VideoHelperSuite / VHS adapters placeholder (v6)
// VHS nodes are treated as SOURCES, not ops — the renderer traverses upstream through them.
// Returning null from apply lets the renderer fall through to the upstream result unchanged.
import type { Adapter, ComfyNode } from "../../types.js";

export function vhsAdapters(): Adapter[] {
  return [
    {
      name: "vhs:passthrough",
      match(node: ComfyNode): boolean {
        return String(node?.comfyClass ?? "").startsWith("VHS_");
      },
      inputs: 1,
      apply(): void { /* passthrough — renderer uses upstream input unchanged */ }
    },
  ];
}
