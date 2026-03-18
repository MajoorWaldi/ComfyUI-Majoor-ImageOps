import { ops } from "../ops.js";
function hasInputSlot(node, index) {
  if (Array.isArray(node?.inputs) && node.inputs.length > index) return true;
  return !!node?.getInputLink?.(index);
}
function genericAdapters() {
  return [
    {
      name: "generic:color_correct_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some((w) => w?.name === k);
        return has("temperature") && has("hue") && has("brightness") && has("contrast") && has("saturation") && has("gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) {
        ops.colorCorrect(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:levels_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some((w) => w?.name === k);
        return has("in_min") && has("in_max") && has("gamma");
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) {
        ops.levels(ctx, canvasSize, node, { generic: true });
      }
    },
    {
      name: "generic:huesat_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some((w) => w?.name === k);
        return (has("hue") || has("hue_deg")) && (has("saturation") || has("sat"));
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) {
        ops.hueSat(ctx, canvasSize, node, { generic: true });
      }
    },
    {
      name: "generic:blend_like",
      match(node) {
        const ws = node?.widgets ?? [];
        const has = (k) => ws.some((w) => w?.name === k);
        const cls = String(node?.comfyClass ?? "").toLowerCase();
        const looksLikeBlendClass = /blend|merge|composite|mix/.test(cls);
        const hasBlendControl = has("mix") || has("opacity") || has("blend_mode");
        return has("mode") && hasInputSlot(node, 1) && (looksLikeBlendClass || hasBlendControl);
      },
      inputs: 2,
      async apply({ ctx, canvasSize, node, inputs }) {
        ops.merge(ctx, canvasSize, node, inputs[1], { generic: true });
      }
    }
  ];
}
export {
  genericAdapters
};
