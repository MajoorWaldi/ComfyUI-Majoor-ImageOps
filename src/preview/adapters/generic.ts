// Generic heuristics for popular packs (best-effort) (v6)
import type { Adapter, AdapterApplyContext, ComfyNode, ComfyWidget } from "../../types.js";
import { ops } from "../ops.js";

export function genericAdapters(): Adapter[] {
  return [
    {
      name: "generic:levels_like",
      match(node: ComfyNode): boolean {
        const ws = node?.widgets ?? [];
        const has = (k: string) => ws.some((w: ComfyWidget) => w?.name === k);
        return has("in_min") && has("in_max") && has("gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.levels(ctx, canvasSize, node, { generic: true }); }
    },
    {
      name: "generic:huesat_like",
      match(node: ComfyNode): boolean {
        const ws = node?.widgets ?? [];
        const has = (k: string) => ws.some((w: ComfyWidget) => w?.name === k);
        return (has("hue") || has("hue_deg")) && (has("saturation") || has("sat"));
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.hueSat(ctx, canvasSize, node, { generic: true }); }
    },
    {
      name: "generic:blend_like",
      match(node: ComfyNode): boolean {
        const ws = node?.widgets ?? [];
        const has = (k: string) => ws.some((w: ComfyWidget) => w?.name === k);
        return has("mode");
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<void> { ops.merge(ctx, canvasSize, node, inputs[1], { generic: true }); }
    },
  ];
}
