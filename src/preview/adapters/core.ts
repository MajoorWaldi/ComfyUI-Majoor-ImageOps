// Core + pack exact adapters (v7)
import type { Adapter, AdapterApplyContext, ComfyNode } from "../../types.js";
import { ops } from "../ops.js";

function className(node: ComfyNode): string {
  return String(node?.comfyClass ?? "");
}

function inSet(node: ComfyNode, values: Set<string>): boolean {
  return values.has(className(node));
}

function hasInput(node: ComfyNode, index: number): boolean {
  return (node.inputs?.[index]?.link ?? null) != null || !!node.getInputLink?.(index);
}

function findInputIndex(node: ComfyNode, names: string[]): number | null {
  const lowered = names.map((name) => name.toLowerCase());
  for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const name = String(node.inputs?.[index]?.name ?? "").toLowerCase();
    if (lowered.includes(name)) return index;
  }
  return null;
}

function collectConnectedInputIndexes(node: ComfyNode, groups: string[][], fallback: number[]): number[] {
  const indexes: number[] = [];
  for (const group of groups) {
    const index = findInputIndex(node, group);
    if (index != null && hasInput(node, index)) indexes.push(index);
  }
  return indexes.length > 0 ? indexes : fallback.filter((index) => hasInput(node, index));
}

const INVERT_CLASSES = new Set([
  "ImageInvert",
]);

const SHARPEN_CLASSES = new Set([
  "ImageSharpen",
  "ImageCASharpening+",
]);

const BLUR_CLASSES = new Set([
  "ImageBlur",
  "ImageGaussianBlur",
  "LayerFilter: GaussianBlur",
  "LayerFilter: GaussianBlurV2",
]);

const RESIZE_CLASSES = new Set([
  "ImageScale",
  "ImageScaleBy",
  "ImageScaleToMaxDimension",
  "ImageScaleToTotalPixels",
  "ResizeAndPadImage",
  "ResizeImageMaskNode",
  "ImageResize+",
  "ImageScaleDown",
  "ImageScaleDownBy",
  "ImageScaleDownToSize",
  "ImageScaleToMegapixels",
  "ImageResizeKJ",
  "ImageResizeKJv2",
  "LayerUtility: ImageScaleByAspectRatio",
  "LayerUtility: ImageScaleByAspectRatio V2",
  "LayerUtility: ImageScaleRestore",
  "LayerUtility: ImageScaleRestoreV2",
]);

const CROP_CLASSES = new Set([
  "ImageCrop",
  "ImageCropV2",
  "ImageCrop+",
  "ImageCropByMaskAndResize",
  "ImageCropByMask",
  "ImageCropByMaskBatch",
  "LayerUtility: CropByMask",
  "LayerUtility: CropByMask V2",
]);

const TRANSFORM_CLASSES = new Set([
  "LayerUtility: LayerImageTransform",
  "LayerUtility: ImageShift",
  "ImageRandomTransform+",
]);

const FLIP_ROTATE_CLASSES = new Set([
  "ImageRotate",
  "ImageFlip",
  "ImageFlip+",
]);

const MERGE_CLASSES = new Set([
  "ImageBlend",
  "LayerUtility: ImageBlend",
  "LayerUtility: ImageBlend V2",
  "CrossFadeImages",
  "CrossFadeImagesMulti",
]);

const COMPOSITE_CLASSES = new Set([
  "ImageComposite+",
  "ImageCompositeFromMaskBatch",
  "ImageCompositeFromMaskBatch+",
  "ImageAlphaComposite",
  "LayerUtility: ImageBlendAdvance",
  "LayerUtility: ImageBlendAdvance V2",
]);

const PAD_CLASSES = new Set([
  "ImagePadForOutpaint",
  "ImagePadForOutpaintMasked",
  "ImagePadForOutpaintTargetSize",
  "ImagePrepForICLora",
  "ImagePadKJ",
  "LayerUtility: ExtendCanvas",
  "LayerUtility: ExtendCanvasV2",
]);

const CHANNEL_SPLIT_CLASSES = new Set([
  "ImageExtractChannel",
  "SplitImageChannels",
  "LayerUtility: ImageChannelSplit",
]);

const CHANNEL_MERGE_CLASSES = new Set([
  "MergeImageChannels",
  "LayerUtility: ImageChannelMerge",
]);

const CHANNEL_APPLY_CLASSES = new Set([
  "ImageApplyChannel",
]);

const DESATURATE_CLASSES = new Set([
  "ImageDesaturate+",
]);

const STITCH_CLASSES = new Set([
  "ImageStitch",
  "ImageConcanate",
  "ImageConcatFromBatch",
  "ImageConcatMulti",
]);

export function coreAdapters(): Adapter[] {
  return [
    {
      name: "core:invert",
      match(node: ComfyNode): boolean { return inSet(node, INVERT_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.invert(ctx, canvasSize, node); }
    },
    {
      name: "core:sharpen",
      match(node: ComfyNode): boolean { return inSet(node, SHARPEN_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.sharpen(ctx, canvasSize, node); }
    },
    {
      name: "core:blur",
      match(node: ComfyNode): boolean { return inSet(node, BLUR_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.blur(ctx, canvasSize, node); }
    },
    {
      name: "core:resize",
      match(node: ComfyNode): boolean { return inSet(node, RESIZE_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.resize(ctx, canvasSize, node); }
    },
    {
      name: "core:crop",
      match(node: ComfyNode): boolean { return inSet(node, CROP_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["image", "images"], ["mask", "crop_region", "bbox"]], [0, 1]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["image", "images"], ["mask", "crop_region", "bbox"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs, inputInfos }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.cropGeneric(ctx, canvasSize, node, inputs, inputInfos); }
    },
    {
      name: "core:transform",
      match(node: ComfyNode): boolean { return inSet(node, TRANSFORM_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<HTMLCanvasElement | void> { return ops.transform(ctx, canvasSize, node); }
    },
    {
      name: "core:flip_rotate",
      match(node: ComfyNode): boolean { return inSet(node, FLIP_ROTATE_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.flipRotate(ctx, canvasSize, node); }
    },
    {
      name: "core:merge",
      match(node: ComfyNode): boolean { return inSet(node, MERGE_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["image1", "images_1", "background_image"], ["image2", "images_2", "layer_image", "image_2"], ["layer_mask", "mask"]], [0, 1, 2]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["image1", "images_1", "background_image"], ["image2", "images_2", "layer_image", "image_2"], ["layer_mask", "mask"]], [0, 1, 2]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement | void> {
        if (inputs[2]) return ops.composite(ctx, canvasSize, node, inputs);
        if (inputs[1]) ops.merge(ctx, canvasSize, node, inputs[1]);
      }
    },
    {
      name: "core:composite",
      match(node: ComfyNode): boolean { return inSet(node, COMPOSITE_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["destination", "image_from", "image_1"], ["source", "image_to", "image_2"], ["mask", "layer_mask"]], [0, 1, 2]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["destination", "image_from", "image_1"], ["source", "image_to", "image_2"], ["mask", "layer_mask"]], [0, 1, 2]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.composite(ctx, canvasSize, node, inputs); }
    },
    {
      name: "core:pad",
      match(node: ComfyNode): boolean { return inSet(node, PAD_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["image", "images"], ["mask"]], [0, 1]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["image", "images"], ["mask"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.pad(ctx, canvasSize, node, inputs); }
    },
    {
      name: "core:channel_split",
      match(node: ComfyNode): boolean { return inSet(node, CHANNEL_SPLIT_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node, outputSlot }: AdapterApplyContext): Promise<HTMLCanvasElement | void> {
        if (className(node) === "ImageExtractChannel") {
          ops.channel(ctx, canvasSize, node);
          return;
        }
        return ops.channelSplit(ctx, canvasSize, node, outputSlot ?? 0);
      }
    },
    {
      name: "core:channel_merge",
      match(node: ComfyNode): boolean { return inSet(node, CHANNEL_MERGE_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["red", "channel_1"], ["green", "channel_2"], ["blue", "channel_3"], ["alpha", "channel_4"]], [0, 1, 2, 3]).length || 3,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["red", "channel_1"], ["green", "channel_2"], ["blue", "channel_3"], ["alpha", "channel_4"]], [0, 1, 2, 3]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.channelMerge(ctx, canvasSize, node, inputs); }
    },
    {
      name: "core:channel_apply",
      match(node: ComfyNode): boolean { return inSet(node, CHANNEL_APPLY_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["images", "image"], ["channel_data"]], [0, 1]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["images", "image"], ["channel_data"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.channelApply(ctx, canvasSize, node, inputs); }
    },
    {
      name: "core:desaturate",
      match(node: ComfyNode): boolean { return inSet(node, DESATURATE_CLASSES); },
      inputs: 1,
      async apply({ ctx, canvasSize, node }: AdapterApplyContext): Promise<void> { ops.desaturate(ctx, canvasSize, node); }
    },
    {
      name: "core:stitch",
      match(node: ComfyNode): boolean { return inSet(node, STITCH_CLASSES); },
      inputs: (node: ComfyNode): number => collectConnectedInputIndexes(node, [["image1"], ["image2"]], [0, 1]).length || 1,
      inputIndexes: (node: ComfyNode): number[] => collectConnectedInputIndexes(node, [["image1"], ["image2"]], [0, 1]),
      async apply({ ctx, canvasSize, node, inputs }: AdapterApplyContext): Promise<HTMLCanvasElement> { return ops.stitch(ctx, canvasSize, node, inputs); }
    },
  ];
}
