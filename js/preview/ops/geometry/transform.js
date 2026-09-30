import { boolAny, normalizeFilterName, numAny, strAny } from "../../graph.js";
import { applyEffectToCanvas, makeCanvas } from "../../renderer.js";
import { clamp01, parseHexColor } from "../color.js";
import { renderMaskedEffectPreview } from "../masks.js";
import { smoothShakeValue } from "../procedural.js";
import { flipCanvas, reflectCoord, rotateDiscrete } from "./canvas-basics.js";
import { sampleChannelBilinear, sampleChannelNearest, setResampleMode } from "./sampling.js";
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
function normalizeAffineFillMode(value) {
  const normalized = String(value || "transparent").trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (normalized === "border" || normalized === "expand" || normalized === "edge" || normalized === "edge_extend" || normalized === "replicate" || normalized === "extend") return "expand";
  if (normalized === "reflect" || normalized === "reflection" || normalized === "mirror") return "mirror";
  if (normalized === "stretch" || normalized === "fill" || normalized === "cover") return "stretch";
  if (normalized === "color" || normalized === "colour" || normalized === "constant" || normalized === "solid") return "color";
  return "transparent";
}
function applyTransform(ctx, W, H, tx, ty, rotDeg, scale, filter, expand, fillMode = "transparent", fillColor = "#000000") {
  void expand;
  const safeScale = Math.max(0.01, scale || 1);
  const normalizedFill = normalizeAffineFillMode(fillMode);
  const rad = rotDeg * Math.PI / 180;
  const needsScale = Math.abs(safeScale - 1) > 1e-4;
  const needsRotate = Math.abs(rotDeg) > 1e-4;
  const needsTranslate = tx !== 0 || ty !== 0;
  if (!needsScale && !needsRotate && !needsTranslate) return;
  const sourceCtx = ctx.canvas.getContext("2d", { willReadFrequently: true });
  if (!sourceCtx) return;
  const output = makeCanvas(W, H);
  const octx = output.getContext("2d", { willReadFrequently: true });
  setResampleMode(octx, filter);
  octx.clearRect(0, 0, W, H);
  if (normalizedFill === "color") {
    octx.fillStyle = parseHexColor(fillColor);
    octx.fillRect(0, 0, W, H);
  } else if (normalizedFill === "stretch") {
    octx.drawImage(ctx.canvas, 0, 0, W, H);
  }
  const srcImage = sourceCtx.getImageData(0, 0, W, H);
  const srcData = srcImage.data;
  const outImage = octx.getImageData(0, 0, W, H);
  const outData = outImage.data;
  const useNearest = filter === "nearest" || filter === "nearest-exact";
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const centerX = W / 2;
  const centerY = H / 2;
  const invScale = 1 / safeScale;
  for (let y = 0; y < H; y++) {
    const py = y + 0.5 - (centerY + ty);
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - (centerX + tx);
      let sx = (cos * px + sin * py) * invScale + centerX - 0.5;
      let sy = (-sin * px + cos * py) * invScale + centerY - 0.5;
      const inside = sx >= 0 && sx <= W - 1 && sy >= 0 && sy <= H - 1;
      if (!inside) {
        if (normalizedFill === "expand") {
          sx = Math.max(0, Math.min(W - 1, sx));
          sy = Math.max(0, Math.min(H - 1, sy));
        } else if (normalizedFill === "mirror") {
          sx = reflectCoord(sx, W - 1);
          sy = reflectCoord(sy, H - 1);
        } else {
          continue;
        }
      }
      const offset = (y * W + x) * 4;
      const sr = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 0) : sampleChannelBilinear(srcData, W, H, sx, sy, 0);
      const sg = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 1) : sampleChannelBilinear(srcData, W, H, sx, sy, 1);
      const sb = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 2) : sampleChannelBilinear(srcData, W, H, sx, sy, 2);
      const sa = useNearest ? sampleChannelNearest(srcData, W, H, sx, sy, 3) : sampleChannelBilinear(srcData, W, H, sx, sy, 3);
      const fgA = clamp01(sa / 255);
      const bgA = clamp01(outData[offset + 3] / 255);
      const outA = fgA + bgA * (1 - fgA);
      const bgR = outData[offset] / 255;
      const bgG = outData[offset + 1] / 255;
      const bgB = outData[offset + 2] / 255;
      const premulR = sr / 255 * fgA + bgR * bgA * (1 - fgA);
      const premulG = sg / 255 * fgA + bgG * bgA * (1 - fgA);
      const premulB = sb / 255 * fgA + bgB * bgA * (1 - fgA);
      outData[offset] = outA > 1e-6 ? Math.round(clamp01(premulR / outA) * 255) : 0;
      outData[offset + 1] = outA > 1e-6 ? Math.round(clamp01(premulG / outA) * 255) : 0;
      outData[offset + 2] = outA > 1e-6 ? Math.round(clamp01(premulB / outA) * 255) : 0;
      outData[offset + 3] = Math.round(clamp01(outA) * 255);
    }
  }
  octx.putImageData(outImage, 0, 0);
  return output;
}
export {
  applyTransform,
  cameraShake,
  normalizeAffineFillMode,
  transform
};
