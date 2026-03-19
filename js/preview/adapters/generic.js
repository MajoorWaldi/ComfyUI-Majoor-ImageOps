import { ops } from "../ops.js";
function className(node) {
  return String(node?.comfyClass ?? "");
}
function classLower(node) {
  return className(node).toLowerCase();
}
function isImageOps(node) {
  return className(node).startsWith("ImageOps");
}
function widgetNames(node) {
  return (node?.widgets ?? []).map((widget) => String(widget?.name ?? "").toLowerCase());
}
function hasWidget(node, name) {
  return (node?.widgets ?? []).some((widget) => widget?.name === name);
}
function hasAnyWidget(node, names) {
  return names.some((name) => hasWidget(node, name));
}
function hasInputSlot(node, index) {
  if (Array.isArray(node?.inputs) && node.inputs.length > index) return true;
  return !!node?.getInputLink?.(index);
}
function hasConnectedInput(node, index) {
  return (node.inputs?.[index]?.link ?? null) != null || !!node.getInputLink?.(index);
}
function findInputIndex(node, names) {
  const lowered = names.map((name) => name.toLowerCase());
  for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const name = String(node.inputs?.[index]?.name ?? "").toLowerCase();
    if (lowered.includes(name)) return index;
  }
  return null;
}
function collectIndexes(node, groups, fallback) {
  const indexes = [];
  for (const group of groups) {
    const index = findInputIndex(node, group);
    if (index != null && hasConnectedInput(node, index)) indexes.push(index);
  }
  if (indexes.length > 0) return indexes;
  return fallback.filter((index) => hasConnectedInput(node, index));
}
function defaultImageIndexes(node, maxCount = 2) {
  const indexes = [];
  for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const slot = node.inputs?.[index];
    const name = String(slot?.name ?? "").toLowerCase();
    const type = String(slot?.type ?? "").toLowerCase();
    if (/mask|bbox|box|region/.test(name) || /mask|bbox|box/.test(type)) continue;
    if (!hasConnectedInput(node, index)) continue;
    if (/image|video|images|source|destination|background|foreground|layer|input|red|green|blue|channel/.test(name) || /image|video/.test(type)) {
      indexes.push(index);
    }
  }
  if (indexes.length > 0) return indexes.slice(0, maxCount);
  return [...Array(maxCount).keys()].filter((index) => hasConnectedInput(node, index));
}
function genericAdapters() {
  return [
    {
      name: "generic:color_correct_like",
      match(node) {
        if (isImageOps(node)) return false;
        const ws = widgetNames(node);
        const has = (name) => ws.includes(name);
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
        if (isImageOps(node)) return false;
        const ws = widgetNames(node);
        const has = (name) => ws.includes(name);
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
        if (isImageOps(node)) return false;
        const ws = widgetNames(node);
        const has = (name) => ws.includes(name);
        return (has("hue") || has("hue_deg")) && (has("saturation") || has("sat"));
      },
      inputs: 1,
      async apply({ ctx, canvasSize, node }) {
        ops.hueSat(ctx, canvasSize, node, { generic: true });
      }
    },
    {
      name: "generic:resize_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /resize|scale|upscale|downscale|megapixel|total pixels/.test(cls) && !/mask|latent/.test(cls) || hasAnyWidget(node, ["width", "height", "target_width", "target_height", "scale_by", "multiplier", "largest_size", "megapixels"]);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        return ops.resize(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:crop_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /crop/.test(cls) || hasAnyWidget(node, ["crop_region", "crop_w", "crop_h"]);
      },
      inputs: (node) => collectIndexes(node, [["image", "images"], ["mask", "crop_region", "bbox"]], [0, 1]).length || 1,
      inputIndexes: (node) => collectIndexes(node, [["image", "images"], ["mask", "crop_region", "bbox"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs, inputInfos }) {
        return ops.cropGeneric(ctx, canvasSize, node, inputs, inputInfos);
      }
    },
    {
      name: "generic:transform_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /transform|shift/.test(cls) || hasAnyWidget(node, ["translate_x", "translate_y", "rotate_deg", "rotate", "mirror", "shift_x", "shift_y", "scale"]);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        return ops.transform(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:flip_rotate_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /flip|mirror|rotate/.test(cls) || hasAnyWidget(node, ["flip_method", "rotation"]);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        return ops.flipRotate(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:blur_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /blur/.test(cls) || hasAnyWidget(node, ["radius", "blur", "blur_radius", "sigma"]);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        ops.blur(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:sharpen_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /sharpen|cas/.test(cls);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        ops.sharpen(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:blend_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        const looksLikeBlendClass = /blend|merge|mix/.test(cls);
        const hasBlendControl = hasAnyWidget(node, ["mix", "opacity", "blend_mode", "mode", "blend_factor"]);
        return hasInputSlot(node, 1) && (looksLikeBlendClass || hasBlendControl);
      },
      inputs: (node) => collectIndexes(node, [["background_image", "image1", "images_1", "destination"], ["layer_image", "image2", "images_2", "source"], ["layer_mask", "mask"]], [0, 1, 2]).length || 1,
      inputIndexes: (node) => collectIndexes(node, [["background_image", "image1", "images_1", "destination"], ["layer_image", "image2", "images_2", "source"], ["layer_mask", "mask"]], [0, 1, 2]),
      async apply({ ctx, canvasSize, node, inputs }) {
        if (!inputs[1]) return;
        if (inputs.length >= 3) return ops.composite(ctx, canvasSize, node, inputs);
        ops.merge(ctx, canvasSize, node, inputs[1], { generic: true });
      }
    },
    {
      name: "generic:composite_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /composite|crossfade/.test(cls) && hasInputSlot(node, 1);
      },
      inputs: (node) => collectIndexes(node, [["destination", "image_from", "image_1"], ["source", "image_to", "image_2"], ["mask", "layer_mask"]], [0, 1, 2]).length || 1,
      inputIndexes: (node) => collectIndexes(node, [["destination", "image_from", "image_1"], ["source", "image_to", "image_2"], ["mask", "layer_mask"]], [0, 1, 2]),
      async apply({ ctx, canvasSize, node, inputs }) {
        return ops.composite(ctx, canvasSize, node, inputs);
      }
    },
    {
      name: "generic:channel_split_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /extract channel|channelsplit|splitimagechannels|channel split/.test(cls) || /channel/.test(cls) && hasAnyWidget(node, ["channel"]);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node, outputSlot }) {
        if (hasWidget(node, "channel")) {
          ops.channel(ctx, canvasSize, node);
          return;
        }
        return ops.channelSplit(ctx, canvasSize, node, outputSlot ?? 0);
      }
    },
    {
      name: "generic:channel_merge_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /channelmerge|mergeimagechannels|channel merge/.test(cls);
      },
      inputs: (node) => collectIndexes(node, [["red", "channel_1"], ["green", "channel_2"], ["blue", "channel_3"], ["alpha", "channel_4"]], [0, 1, 2, 3]).length || 3,
      inputIndexes: (node) => collectIndexes(node, [["red", "channel_1"], ["green", "channel_2"], ["blue", "channel_3"], ["alpha", "channel_4"]], [0, 1, 2, 3]),
      async apply({ ctx, canvasSize, node, inputs }) {
        return ops.channelMerge(ctx, canvasSize, node, inputs);
      }
    },
    {
      name: "generic:channel_apply_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /apply channel|channel apply/.test(cls);
      },
      inputs: (node) => collectIndexes(node, [["image", "images"], ["channel_data", "mask"]], [0, 1]).length || 1,
      inputIndexes: (node) => collectIndexes(node, [["image", "images"], ["channel_data", "mask"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs }) {
        return ops.channelApply(ctx, canvasSize, node, inputs);
      }
    },
    {
      name: "generic:desaturate_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /desaturate|grayscale|greyscale/.test(cls);
      },
      inputs: 1,
      inputIndexes: (node) => defaultImageIndexes(node, 1),
      async apply({ ctx, canvasSize, node }) {
        ops.desaturate(ctx, canvasSize, node);
      }
    },
    {
      name: "generic:stitch_like",
      match(node) {
        if (isImageOps(node)) return false;
        const cls = classLower(node);
        return /stitch|concatenate|concat|join/.test(cls) && hasInputSlot(node, 1);
      },
      inputs: (node) => collectIndexes(node, [["image1"], ["image2"]], [0, 1]).length || 1,
      inputIndexes: (node) => collectIndexes(node, [["image1"], ["image2"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs }) {
        return ops.stitch(ctx, canvasSize, node, inputs);
      }
    }
  ];
}
export {
  genericAdapters
};
