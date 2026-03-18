// Generic heuristics for popular packs (best-effort) (v6)
import type { Adapter, AdapterApplyContext, ComfyNode, ComfyWidget } from "../../types.js";
import { ops } from "../ops.js";

function hasInputSlot(node: ComfyNode, index: number): boolean {
  if (Array.isArray(node?.inputs) && node.inputs.length > index) return true;
  return !!node?.getInputLink?.(index);
}

export function genericAdapters(): Adapter[] {
  return [
    {
      name: "generic:color_correct_like",
      match(node: ComfyNode): boolean {
        const ws = node?.widgets ?? [];
        const has = (k: string) => ws.some((w: ComfyWidget) => w?.name === k);
        return has("temperature") && has("hue") && has("brightness") && has("contrast") && has("saturation") && has("gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.colorCorrect(ctx, canvasSize, node); }
    },
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
        const cls = String(node?.comfyClass ?? "").toLowerCase();
        const looksLikeBlendClass = /blend|merge|composite|mix/.test(cls);
        const hasBlendControl = has("mix") || has("opacity") || has("blend_mode");
        return has("mode") && hasInputSlot(node, 1) && (looksLikeBlendClass || hasBlendControl);
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<void> { ops.merge(ctx, canvasSize, node, inputs[1], { generic: true }); }
    },
  ];
}
