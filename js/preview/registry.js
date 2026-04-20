import { imageOpsAdapter } from "./adapters/imageops.js";
import { coreAdapters } from "./adapters/core.js";
import { wasAdapters } from "./adapters/was.js";
import { vhsAdapters } from "./adapters/vhs.js";
import { genericAdapters } from "./adapters/generic.js";
function buildAdapterRegistry() {
  const adapters = [
    ...coreAdapters(),
    ...wasAdapters(),
    ...vhsAdapters(),
    ...genericAdapters(),
    imageOpsAdapter()
    // keep last so ImageOps classes are exact
  ];
  return {
    pick(node) {
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
export {
  buildAdapterRegistry
};
