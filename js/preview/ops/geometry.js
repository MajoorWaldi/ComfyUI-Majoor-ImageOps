import { setWidgetValue } from "../shared/widgets.js";
import {
  applyCrop,
  applyCropReformat,
  applyEffectToCanvas,
  applySpherize,
  applyTransform,
  boolAny,
  composeCropStitchPreview,
  computeMaskBounds,
  cropRectCanvas,
  extractMaskDrivenCrop,
  fitCanvas,
  flipCanvas,
  getCanvasDimensions,
  makeCanvas,
  normalizeFilterName,
  num,
  numAny,
  parseHexColor,
  renderCornerPinCanvases,
  renderCropStitchCanvases,
  renderDistortCanvas,
  renderMaskedEffectPreview,
  renderPadOutCanvases,
  resizeWithMode,
  resolveResizeDimensions,
  rotateDiscrete,
  setResampleMode,
  smoothShakeValue,
  str,
  strAny,
  w,
  wAny
} from "./implementation.js";
export * from "../shared/geometry.js";
function crop(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const rawMask = inputs[1] ?? null;
  return renderMaskedEffectPreview(
    node,
    source,
    rawMask,
    (input) => applyEffectToCanvas(input, (effectCtx, width, height) => applyCrop(
      effectCtx,
      node,
      width,
      height,
      str(node, "aspect_ratio", "custom", frameIndex),
      num(node, "width", width, frameIndex),
      num(node, "height", height, frameIndex)
    )),
    {
      frameIndex,
      premultBeforeProcess: true,
      compositeWithBase: false
    }
  );
}
function cropStitch(ctx, W, node, inputs = [], frameIndex = 0) {
  if (inputs.length < 2) return inputs[0] ?? ctx.canvas;
  const rendered = renderCropStitchCanvases(node, inputs, frameIndex);
  return composeCropStitchPreview(rendered.image, rendered.crop, rendered.mask, rendered.bbox);
}
function padOut(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderPadOutCanvases(node, source, frameIndex).image;
}
function cornerPin(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderCornerPinCanvases(node, source, frameIndex).image;
}
function cropGeneric(ctx, W, node, inputs = [], inputInfos = []) {
  const source = inputs[0] ?? ctx.canvas;
  const sourceWidth = source.width || 1;
  const sourceHeight = source.height || 1;
  let targetWidth = Math.max(1, Math.round(numAny(node, ["width", "target_width", "base_resolution"], sourceWidth)));
  let targetHeight = Math.max(1, Math.round(numAny(node, ["height", "target_height", "base_resolution"], sourceHeight)));
  const maskInput = inputs[1] ?? null;
  if (maskInput) {
    if (!wAny(node, ["width", "target_width", "height", "target_height"]) && !!w(node, "base_resolution")) {
      const fittedMask = fitCanvas(maskInput, sourceWidth, sourceHeight);
      const bounds = computeMaskBounds(fittedMask);
      if (bounds) {
        const aspect = bounds.width / Math.max(1, bounds.height);
        const baseResolution = Math.max(1, Math.round(numAny(node, ["base_resolution"], Math.max(bounds.width, bounds.height))));
        if (aspect >= 1) {
          targetWidth = baseResolution;
          targetHeight = Math.max(1, Math.round(baseResolution / aspect));
        } else {
          targetHeight = baseResolution;
          targetWidth = Math.max(1, Math.round(baseResolution * aspect));
        }
      }
    }
    return extractMaskDrivenCrop(source, maskInput, numAny(node, ["padding"], 0), targetWidth, targetHeight);
  }
  const cropRegion = w(node, "crop_region")?.value;
  const bboxNode = inputInfos[1]?.upstreamNode ?? null;
  const x = Math.max(0, Math.round(cropRegion?.x ?? numAny(bboxNode ?? node, ["x", "x_offset"], 0)));
  const y = Math.max(0, Math.round(cropRegion?.y ?? numAny(bboxNode ?? node, ["y", "y_offset"], 0)));
  const width = Math.max(1, Math.round(cropRegion?.width ?? numAny(bboxNode ?? node, ["width", "crop_w"], sourceWidth)));
  const height = Math.max(1, Math.round(cropRegion?.height ?? numAny(bboxNode ?? node, ["height", "crop_h"], sourceHeight)));
  return cropRectCanvas(source, x, y, Math.min(width, sourceWidth - x), Math.min(height, sourceHeight - y));
}
function transform(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const rawMask = inputs[1] ?? null;
  const transformImage = (input) => {
    let working = input;
    const flip = strAny(node, ["flip", "mirror"], "none", frameIndex).toLowerCase();
    const flipMethod = strAny(node, ["flip_method"], "", frameIndex);
    const horizontal = flip === "horizontal" || flipMethod.startsWith("y");
    const vertical = flip === "vertical" || flipMethod.startsWith("x");
    working = flipCanvas(working, horizontal, vertical);
    const rotationLabel = strAny(node, ["rotation"], "", frameIndex);
    if (rotationLabel.startsWith("90")) working = rotateDiscrete(working, 1);
    else if (rotationLabel.startsWith("180")) working = rotateDiscrete(working, 2);
    else if (rotationLabel.startsWith("270")) working = rotateDiscrete(working, 3);
    const aspectRatio = numAny(node, ["aspect_ratio"], 1, frameIndex);
    if (Math.abs(aspectRatio - 1) > 1e-4) {
      const scaled = makeCanvas(working.width || 1, Math.max(1, Math.round((working.height || 1) * aspectRatio)));
      const sctx = scaled.getContext("2d", { willReadFrequently: true });
      setResampleMode(sctx, normalizeFilterName(strAny(node, ["upscale_method", "interpolation", "transform_method", "filter"], "bilinear", frameIndex)));
      sctx.drawImage(working, 0, 0, scaled.width, scaled.height);
      working = scaled;
    }
    const tx = numAny(node, ["translate_x", "x", "shift_x"], 0, frameIndex);
    const ty = numAny(node, ["translate_y", "y", "shift_y"], 0, frameIndex);
    const rot = numAny(node, ["rotate_deg", "rotate"], 0, frameIndex);
    const scale = numAny(node, ["scale"], 1, frameIndex);
    const filter = normalizeFilterName(strAny(node, ["filter", "upscale_method", "interpolation", "transform_method"], "bilinear", frameIndex));
    const expand = boolAny(node, ["expand"], false, frameIndex);
    const fillMode = strAny(node, ["fill_mode", "edge_mode"], "transparent", frameIndex);
    const fillColor = strAny(node, ["fill_color", "background_color", "color"], "#000000", frameIndex);
    return applyEffectToCanvas(working, (effectCtx, width, height) => {
      return applyTransform(effectCtx, width, height, tx, ty, rot, scale, filter, expand, fillMode, fillColor);
    });
  };
  return renderMaskedEffectPreview(
    node,
    source,
    rawMask,
    transformImage,
    {
      frameIndex,
      premultBeforeProcess: true,
      compositeWithBase: false
    }
  );
}
function cameraShake(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const transformImage = (input) => {
    const translate = Math.max(0, numAny(node, ["translate_px"], 12, frameIndex));
    const rotate = Math.max(0, numAny(node, ["rotate_deg"], 1.5, frameIndex));
    const zoom = Math.max(0, numAny(node, ["zoom"], 0.03, frameIndex));
    const smoothing = numAny(node, ["smoothing"], 0.65, frameIndex);
    const frequency = Math.max(0.01, numAny(node, ["shake_frequency", "frequency"], 1, frameIndex));
    const seed = Math.max(0, Math.round(numAny(node, ["seed"], 12345, frameIndex)));
    const tx = smoothShakeValue(seed + 11, frameIndex, 1, translate, smoothing, frequency);
    const ty = smoothShakeValue(seed + 23, frameIndex, 2, translate, smoothing, frequency);
    const rot = smoothShakeValue(seed + 37, frameIndex, 3, rotate, smoothing, frequency);
    const scale = Math.max(0.01, 1 + smoothShakeValue(seed + 53, frameIndex, 4, zoom, smoothing, frequency));
    return applyEffectToCanvas(input, (effectCtx, width, height) => {
      return applyTransform(
        effectCtx,
        width,
        height,
        tx,
        ty,
        rot,
        scale,
        strAny(node, ["filter"], "bilinear", frameIndex),
        false,
        strAny(node, ["fill_mode"], "mirror", frameIndex),
        strAny(node, ["fill_color"], "#000000", frameIndex)
      );
    });
  };
  return renderMaskedEffectPreview(node, source, inputs[1] ?? null, transformImage, {
    frameIndex,
    premultBeforeProcess: true,
    compositeWithBase: false
  });
}
function cropReformat(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  applyCropReformat(
    ctx,
    width,
    height,
    numAny(node, ["x"], 0),
    numAny(node, ["y"], 0),
    numAny(node, ["crop_w", "width"], width),
    numAny(node, ["crop_h", "height"], height),
    numAny(node, ["padding"], 0),
    numAny(node, ["out_w", "target_width"], 0),
    numAny(node, ["out_h", "target_height"], 0),
    strAny(node, ["mode", "method"], "fit")
  );
}
function resize(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  const resolved = resolveResizeDimensions(node, width, height);
  return resizeWithMode(ctx.canvas, resolved.width, resolved.height, resolved.filter, resolved.mode, resolved.fillColor, resolved.cropPosition);
}
function pad(ctx, W, node, inputs = []) {
  const source = inputs[0] ?? ctx.canvas;
  const top = Math.max(0, Math.round(numAny(node, ["top"], 0)));
  const bottom = Math.max(0, Math.round(numAny(node, ["bottom"], 0)));
  const left = Math.max(0, Math.round(numAny(node, ["left"], 0)));
  const right = Math.max(0, Math.round(numAny(node, ["right"], 0)));
  const output = makeCanvas((source.width || 1) + left + right, (source.height || 1) + top + bottom);
  const octx = output.getContext("2d", { willReadFrequently: true });
  octx.fillStyle = parseHexColor(strAny(node, ["color", "background_color", "pad_color", "padding_color"], "#808080"));
  octx.fillRect(0, 0, output.width, output.height);
  octx.drawImage(source, left, top, source.width || 1, source.height || 1);
  return output;
}
function flipRotate(ctx, W, node) {
  const flipMethod = strAny(node, ["flip_method"], "");
  const horizontal = flipMethod.startsWith("y");
  const vertical = flipMethod.startsWith("x");
  let working = flipCanvas(ctx.canvas, horizontal, vertical);
  const rotation = strAny(node, ["rotation"], "");
  if (rotation.startsWith("90")) working = rotateDiscrete(working, 1);
  else if (rotation.startsWith("180")) working = rotateDiscrete(working, 2);
  else if (rotation.startsWith("270")) working = rotateDiscrete(working, 3);
  return working;
}
function distort(ctx, W, node, inputs, frameIndex = 0) {
  return renderDistortCanvas(node, inputs, frameIndex).image;
}
function spherize(ctx, W, node, inputs = [], frameIndex = 0) {
  let source = inputs[0] ?? ctx.canvas;
  const sizeMode = strAny(node, ["size_mode"], "from_input", frameIndex).toLowerCase().trim();
  if (sizeMode === "custom") {
    const tw = Math.max(64, Math.round(numAny(node, ["width"], 512, frameIndex)));
    const th = Math.max(64, Math.round(numAny(node, ["height"], 512, frameIndex)));
    if (tw !== source.width || th !== source.height) {
      const resized = makeCanvas(tw, th);
      resized.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, tw, th);
      source = resized;
    }
  } else {
    const ww = w(node, "width");
    const hw = w(node, "height");
    setWidgetValue(ww, Math.max(64, source.width));
    setWidgetValue(hw, Math.max(64, source.height));
  }
  return applyEffectToCanvas(source, (effectCtx, width, height) => {
    applySpherize(
      effectCtx,
      width,
      height,
      strAny(node, ["mode"], "spherize", frameIndex),
      numAny(node, ["strength"], 1, frameIndex),
      boolAny(node, ["invert"], false, frameIndex)
    );
  });
}
const geometryOps = {
  crop,
  cropGeneric,
  cropReformat,
  cropStitch,
  pad,
  padOut,
  resize,
  transform,
  flipRotate,
  cornerPin,
  cameraShake,
  distort,
  spherize
};
export {
  cameraShake,
  cornerPin,
  crop,
  cropGeneric,
  cropReformat,
  cropStitch,
  distort,
  flipRotate,
  geometryOps,
  pad,
  padOut,
  resize,
  spherize,
  transform
};
