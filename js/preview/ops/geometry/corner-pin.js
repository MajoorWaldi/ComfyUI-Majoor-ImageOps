import { boolAny, numAny, strAny } from "../../graph.js";
import { makeCanvas } from "../../renderer.js";
import { clamp01, parseHexColor } from "../color.js";
import { markPreparedMaskCanvas } from "../masks.js";
import { fitCanvas, reflectCoord } from "./canvas-basics.js";
import { sampleChannelBicubic, sampleChannelBilinear, sampleChannelNearest } from "./sampling.js";
import { normalizeAffineFillMode } from "./transform.js";
function solveLinear8x8(matrix, vector) {
  const n = 8;
  const A = matrix.map((row) => row.slice());
  const b = vector.slice();
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let pivotAbs = Math.abs(A[col][col]);
    for (let row = col + 1; row < n; row++) {
      const valueAbs = Math.abs(A[row][col]);
      if (valueAbs > pivotAbs) {
        pivot = row;
        pivotAbs = valueAbs;
      }
    }
    if (pivotAbs < 1e-10) return null;
    if (pivot !== col) {
      const tmp = A[col];
      A[col] = A[pivot];
      A[pivot] = tmp;
      const vb = b[col];
      b[col] = b[pivot];
      b[pivot] = vb;
    }
    const inv = 1 / A[col][col];
    for (let c = col; c < n; c++) A[col][c] *= inv;
    b[col] *= inv;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = A[row][col];
      if (Math.abs(factor) < 1e-12) continue;
      for (let c = col; c < n; c++) A[row][c] -= factor * A[col][c];
      b[row] -= factor * b[col];
    }
  }
  return b;
}
function invert3x3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-10) return null;
  const invDet = 1 / det;
  return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
}
function solveCornerPinInverseHomography(node, width, height, frameIndex = 0) {
  const src = [
    [0, 0],
    [Math.max(0, width - 1), 0],
    [0, Math.max(0, height - 1)],
    [Math.max(0, width - 1), Math.max(0, height - 1)]
  ];
  const dst = [
    [numAny(node, ["tl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["tl_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["tr_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["tr_y"], 0, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["bl_x"], 0, frameIndex) * Math.max(0, width - 1), numAny(node, ["bl_y"], 1, frameIndex) * Math.max(0, height - 1)],
    [numAny(node, ["br_x"], 1, frameIndex) * Math.max(0, width - 1), numAny(node, ["br_y"], 1, frameIndex) * Math.max(0, height - 1)]
  ];
  const A = [];
  const b = [];
  for (let idx = 0; idx < 4; idx++) {
    const x = src[idx][0];
    const y = src[idx][1];
    const u = dst[idx][0];
    const v = dst[idx][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const solved = solveLinear8x8(A, b);
  if (!solved) return null;
  const H = [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1];
  return invert3x3(H);
}
function solveInverseHomographyFromCorners(sourceWidth, sourceHeight, corners) {
  const src = [
    [0, 0],
    [Math.max(0, sourceWidth - 1), 0],
    [0, Math.max(0, sourceHeight - 1)],
    [Math.max(0, sourceWidth - 1), Math.max(0, sourceHeight - 1)]
  ];
  const dst = [
    [corners.tl.x, corners.tl.y],
    [corners.tr.x, corners.tr.y],
    [corners.bl.x, corners.bl.y],
    [corners.br.x, corners.br.y]
  ];
  const A = [];
  const b = [];
  for (let idx = 0; idx < 4; idx++) {
    const x = src[idx][0];
    const y = src[idx][1];
    const u = dst[idx][0];
    const v = dst[idx][1];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const solved = solveLinear8x8(A, b);
  if (!solved) return null;
  return invert3x3([solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1]);
}
function warpCanvasToQuad(source, outputWidth, outputHeight, corners, filter = "bilinear") {
  const width = source.width || 1;
  const height = source.height || 1;
  const inverse = solveInverseHomographyFromCorners(width, height, corners);
  const image = makeCanvas(outputWidth, outputHeight);
  const mask = makeCanvas(outputWidth, outputHeight);
  if (!inverse) {
    markPreparedMaskCanvas(mask);
    return { image, mask };
  }
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const srcImage = sourceCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;
  const imageCtx = image.getContext("2d", { willReadFrequently: true });
  const outImage = imageCtx.createImageData(outputWidth, outputHeight);
  const outData = outImage.data;
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  const outMask = maskCtx.createImageData(outputWidth, outputHeight);
  const outMaskData = outMask.data;
  const useNearest = filter === "nearest";
  const useBicubic = filter === "bicubic";
  for (let y = 0; y < outputHeight; y++) {
    for (let x = 0; x < outputWidth; x++) {
      const outOffset = (y * outputWidth + x) * 4;
      const denom = inverse[6] * x + inverse[7] * y + inverse[8];
      const safeDenom = Math.abs(denom) < 1e-8 ? denom < 0 ? -1e-8 : 1e-8 : denom;
      const sx = (inverse[0] * x + inverse[1] * y + inverse[2]) / safeDenom;
      const sy = (inverse[3] * x + inverse[4] * y + inverse[5]) / safeDenom;
      const inside = sx >= 0 && sx <= width - 1 && sy >= 0 && sy <= height - 1;
      if (!inside) continue;
      const r = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 0) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 0) : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
      const g = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 1) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 1) : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
      const b = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 2) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 2) : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
      const a = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 3) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 3) : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
      outData[outOffset] = Math.round(clamp01(r / 255) * 255);
      outData[outOffset + 1] = Math.round(clamp01(g / 255) * 255);
      outData[outOffset + 2] = Math.round(clamp01(b / 255) * 255);
      outData[outOffset + 3] = Math.round(clamp01(a / 255) * 255);
      const alpha = Math.round(clamp01(a / 255) * 255);
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = alpha;
    }
  }
  imageCtx.putImageData(outImage, 0, 0);
  maskCtx.putImageData(outMask, 0, 0);
  markPreparedMaskCanvas(mask);
  return { image, mask };
}
function renderCornerPinCanvases(node, source, frameIndex = 0) {
  const width = source.width || 1;
  const height = source.height || 1;
  const filter = strAny(node, ["filter"], "bilinear", frameIndex).toLowerCase();
  const fillMode = normalizeAffineFillMode(strAny(node, ["fill_mode", "edge_mode"], "transparent", frameIndex));
  const fillColor = parseHexColor(strAny(node, ["fill_color"], "#000000", frameIndex));
  const supersample = Math.max(1, Math.min(4, Math.round(numAny(node, ["supersample"], 1, frameIndex))));
  const invertMask = boolAny(node, ["invert_mask"], false, frameIndex);
  const bypass = boolAny(node, ["bypass"], false, frameIndex);
  if (bypass) {
    const image2 = fitCanvas(source, width, height);
    const mask2 = makeCanvas(width, height);
    const maskCtx2 = mask2.getContext("2d", { willReadFrequently: true });
    if (!invertMask) {
      maskCtx2.fillStyle = "#FFFFFF";
      maskCtx2.fillRect(0, 0, width, height);
    }
    markPreparedMaskCanvas(mask2);
    return { image: image2, mask: mask2 };
  }
  const inverse = solveCornerPinInverseHomography(node, width, height, frameIndex);
  if (!inverse) {
    const image2 = fitCanvas(source, width, height);
    const mask2 = makeCanvas(width, height);
    const maskCtx2 = mask2.getContext("2d", { willReadFrequently: true });
    if (invertMask) {
      maskCtx2.fillStyle = "#FFFFFF";
      maskCtx2.fillRect(0, 0, width, height);
    }
    markPreparedMaskCanvas(mask2);
    return { image: image2, mask: mask2 };
  }
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  const srcImage = sourceCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;
  const image = makeCanvas(width, height);
  const imageCtx = image.getContext("2d", { willReadFrequently: true });
  if (fillMode === "color") {
    imageCtx.fillStyle = fillColor;
    imageCtx.fillRect(0, 0, width, height);
  } else if (fillMode === "stretch") {
    imageCtx.drawImage(source, 0, 0, width, height);
  }
  const outImage = imageCtx.getImageData(0, 0, width, height);
  const outData = outImage.data;
  const mask = makeCanvas(width, height);
  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  const outMask = maskCtx.createImageData(width, height);
  const outMaskData = outMask.data;
  const useNearest = filter === "nearest";
  const useBicubic = filter === "bicubic";
  const sampleCount = supersample * supersample;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const outOffset = (y * width + x) * 4;
      let premulR = 0;
      let premulG = 0;
      let premulB = 0;
      let alphaSum = 0;
      let insideSum = 0;
      let coveredAlphaSum = 0;
      for (let subY = 0; subY < supersample; subY++) {
        const dstY = supersample === 1 ? y : y + (subY + 0.5) / supersample - 0.5;
        for (let subX = 0; subX < supersample; subX++) {
          const dstX = supersample === 1 ? x : x + (subX + 0.5) / supersample - 0.5;
          const denom = inverse[6] * dstX + inverse[7] * dstY + inverse[8];
          const safeDenom = Math.abs(denom) < 1e-8 ? denom < 0 ? -1e-8 : 1e-8 : denom;
          let sx = (inverse[0] * dstX + inverse[1] * dstY + inverse[2]) / safeDenom;
          let sy = (inverse[3] * dstX + inverse[4] * dstY + inverse[5]) / safeDenom;
          const inside = sx >= 0 && sx <= width - 1 && sy >= 0 && sy <= height - 1;
          if (inside) insideSum += 1;
          if (!inside) {
            if (fillMode === "expand") {
              sx = Math.max(0, Math.min(width - 1, sx));
              sy = Math.max(0, Math.min(height - 1, sy));
            } else if (fillMode === "mirror") {
              sx = reflectCoord(sx, width - 1);
              sy = reflectCoord(sy, height - 1);
            } else {
              continue;
            }
          }
          const r = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 0) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 0) : sampleChannelBilinear(srcData, width, height, sx, sy, 0);
          const g = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 1) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 1) : sampleChannelBilinear(srcData, width, height, sx, sy, 1);
          const b = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 2) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 2) : sampleChannelBilinear(srcData, width, height, sx, sy, 2);
          const a = useNearest ? sampleChannelNearest(srcData, width, height, sx, sy, 3) : useBicubic ? sampleChannelBicubic(srcData, width, height, sx, sy, 3) : sampleChannelBilinear(srcData, width, height, sx, sy, 3);
          premulR += r * (a / 255);
          premulG += g * (a / 255);
          premulB += b * (a / 255);
          alphaSum += a;
          if (inside) coveredAlphaSum += a;
        }
      }
      const alpha = alphaSum / sampleCount;
      const alpha01 = alpha / 255;
      const fgR = alpha01 > 1e-6 ? clamp01(premulR / sampleCount / alpha01 / 255) : 0;
      const fgG = alpha01 > 1e-6 ? clamp01(premulG / sampleCount / alpha01 / 255) : 0;
      const fgB = alpha01 > 1e-6 ? clamp01(premulB / sampleCount / alpha01 / 255) : 0;
      const bgA = clamp01(outData[outOffset + 3] / 255);
      const bgR = outData[outOffset] / 255;
      const bgG = outData[outOffset + 1] / 255;
      const bgB = outData[outOffset + 2] / 255;
      const outA = alpha01 + bgA * (1 - alpha01);
      const premulOutR = fgR * alpha01 + bgR * bgA * (1 - alpha01);
      const premulOutG = fgG * alpha01 + bgG * bgA * (1 - alpha01);
      const premulOutB = fgB * alpha01 + bgB * bgA * (1 - alpha01);
      outData[outOffset] = outA > 1e-6 ? Math.round(clamp01(premulOutR / outA) * 255) : 0;
      outData[outOffset + 1] = outA > 1e-6 ? Math.round(clamp01(premulOutG / outA) * 255) : 0;
      outData[outOffset + 2] = outA > 1e-6 ? Math.round(clamp01(premulOutB / outA) * 255) : 0;
      outData[outOffset + 3] = Math.round(clamp01(outA) * 255);
      const maskValue = fillMode === "transparent" ? Math.round(clamp01(coveredAlphaSum / sampleCount / 255) * 255) : 255;
      const finalMask = invertMask ? 255 - maskValue : maskValue;
      outMaskData[outOffset] = 255;
      outMaskData[outOffset + 1] = 255;
      outMaskData[outOffset + 2] = 255;
      outMaskData[outOffset + 3] = finalMask;
    }
  }
  imageCtx.putImageData(outImage, 0, 0);
  maskCtx.putImageData(outMask, 0, 0);
  markPreparedMaskCanvas(mask);
  return { image, mask };
}
function cornerPin(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return renderCornerPinCanvases(node, source, frameIndex).image;
}
export {
  cornerPin,
  invert3x3,
  renderCornerPinCanvases,
  solveCornerPinInverseHomography,
  solveInverseHomographyFromCorners,
  solveLinear8x8,
  warpCanvasToQuad
};
