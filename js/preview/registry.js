// Adapter registry (ImageOps + interop) (v6)
import { imageOpsAdapter } from "./adapters/imageops.js";
import { coreAdapters } from "./adapters/core.js";
import { wasAdapters } from "./adapters/was.js";
import { vhsAdapters } from "./adapters/vhs.js";
import { genericAdapters } from "./adapters/generic.js";

export function buildAdapterRegistry() {
  const adapters = [
    ...coreAdapters(),
    ...wasAdapters(),
    ...vhsAdapters(),
    ...genericAdapters(),
    imageOpsAdapter(), // keep last so ImageOps classes are exact
  ];

  return {
    pick(node) {
      for (const a of adapters) {
        try {
          if (a.match(node)) return a;
        } catch {}
      }
      return null;
    }
  };
}
