// Generic heuristics for popular packs (best-effort) (v6)
import { ops } from "../ops.js";

export function genericAdapters() {
  return [
    {
      name: "generic:levels_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some(w => w?.name === k);
        return has("in_min") && has("in_max") && has("gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.levels(ctx, canvasSize, node, { generic: true }); }
    },
    {
      name: "generic:huesat_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some(w => w?.name === k);
        return (has("hue") || has("hue_deg")) && (has("saturation") || has("sat"));
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) { ops.hueSat(ctx, canvasSize, node, { generic: true }); }
    },
    {
      name: "generic:blend_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some(w => w?.name === k);
        // if has mode and has 2 inputs
        return has("mode");
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }) { ops.merge(ctx, canvasSize, node, inputs[1], { generic: true }); }
    },
  ];
}
