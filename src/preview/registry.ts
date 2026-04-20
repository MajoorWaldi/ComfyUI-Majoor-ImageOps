// Adapter registry (ImageOps + interop) (v6)
import type { Adapter, AdapterRegistry, ComfyNode } from "../types.js";
import { imageOpsAdapter } from "./adapters/imageops.js";
import { coreAdapters } from "./adapters/core.js";
import { wasAdapters } from "./adapters/was.js";
import { vhsAdapters } from "./adapters/vhs.js";
import { genericAdapters } from "./adapters/generic.js";

export function buildAdapterRegistry(): AdapterRegistry {
  const adapters: Adapter[] = [
    ...coreAdapters(),
    ...wasAdapters(),
    ...vhsAdapters(),
    ...genericAdapters(),
    imageOpsAdapter(), // keep last so ImageOps classes are exact
  ];

  return {
    pick(node: ComfyNode): Adapter | null {
      for (const a of adapters) {
        try {
          if (a.match(node)) return a;
        } catch (err) {
          console.warn("[ImageOps] adapter match error (", a.name ?? "unnamed", "):", err);
        }
      }
      return null;
    }
  };
}
