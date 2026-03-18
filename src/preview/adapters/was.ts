// WAS Node Suite adapters (best-effort) (v6)
import type { Adapter, AdapterApplyContext, ComfyNode, ComfyWidget } from "../../types.js";
import { ops } from "../ops.js";

function isWAS(node: ComfyNode): boolean {
  const n = String(node?.comfyClass ?? "");
  return n.toLowerCase().includes("was") || n.startsWith("WAS_");
}

export function wasAdapters(): Adapter[] {
  return [
    {
      name: "was:levels",
      match(node: ComfyNode): boolean {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        if (n.includes("levels")) return true;
        return (node.widgets ?? []).some((w: ComfyWidget) => w?.name === "in_min") &&
               (node.widgets ?? []).some((w: ComfyWidget) => w?.name === "in_max") &&
               (node.widgets ?? []).some((w: ComfyWidget) => w?.name === "gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.levels(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:huesat",
      match(node: ComfyNode): boolean {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        if (n.includes("hue")) return true;
        return (node.widgets ?? []).some((w: ComfyWidget) => w?.name === "hue" || w?.name === "hue_deg");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.hueSat(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:invert",
      match(node: ComfyNode): boolean {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        return n.includes("invert");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.invert(ctx, canvasSize, node, { wasCompat: true }); }
    },
    {
      name: "was:blend",
      match(node: ComfyNode): boolean {
        if (!isWAS(node)) return false;
        const n = String(node.comfyClass).toLowerCase();
        return n.includes("blend") || n.includes("merge") || (node.widgets ?? []).some((w: ComfyWidget) => w?.name === "mode");
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<void> { ops.merge(ctx, canvasSize, node, inputs[1], { wasCompat: true }); }
    },
  ];
}
