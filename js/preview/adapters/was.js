// WAS Node Suite adapters (best-effort) (v6)
import { ops } from "../ops.js";

function isWAS(node) {
  const n = String(node?.comfyClass ?? "");
  return n.toLowerCase().includes("was") || n.startsWith("WAS_");
}

export function wasAdapters() {
  return [
    {
      name: "was:levels",
      match(node) {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        if (n.includes("levels")) return true;
        // widget signature fallback
        return (node.widgets ?? []).some(w => w?.name === "in_min") &&
               (node.widgets ?? []).some(w => w?.name === "in_max") &&
               (node.widgets ?? []).some(w => w?.name === "gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.levels(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:huesat",
      match(node) {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        if (n.includes("hue")) return true;
        return (node.widgets ?? []).some(w => w?.name === "hue" || w?.name === "hue_deg");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.hueSat(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:invert",
      match(node) {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        return n.includes("invert");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.invert(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:blend",
      match(node) {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        return n.includes("blend") || n.includes("merge") || (node.widgets ?? []).some(w => w?.name === "mode");
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }) { ops.merge(ctx, canvasSize, node, inputs[1], { wasCompat: true }); }
    },
  ];
}
