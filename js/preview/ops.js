import { getOpsConstants, initOpsConstants } from "./constants.js";
import { clampCropCenter, clampCropScale, computeCropRect, resolveCropAspectRatio } from "./crop.js";
import { computeCompRect, getCompSlots, syncCompLayers } from "./comp.js";
import { renderDrawPreview } from "./draw.js";
initOpsConstants();
function w(node, name) {
  return node?.widgets?.find((x) => x?.name === name) ?? null;
}
function num(node, name, fallback = 0) {
  const v = w(node, name)?.value;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function str(node, name, fallback = "") {
  const v = w(node, name)?.value;
  return typeof v === "string" ? v : fallback;
}
function bool(node, name, fallback = false) {
  const v = w(node, name)?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function luma01(r, g, b, lw) {
  return lw[0] * r + lw[1] * g + lw[2] * b;
}
function getImageData(ctx, W, H) {
  return ctx.getImageData(0, 0, W, H);
}
function putImageData(ctx, img) {
  ctx.putImageData(img, 0, 0);
}
function getCanvasDimensions(ctx) {
  return {
    width: Math.max(1, ctx.canvas.width || 1),
    height: Math.max(1, ctx.canvas.height || 1)
  };
}
function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function compModeToCanvasOp(mode) {
  const normalized = String(mode || "over").toLowerCase();
  if (normalized === "add") return "lighter";
  if (normalized === "multiply") return "multiply";
  if (normalized === "screen") return "screen";
  if (normalized === "overlay") return "overlay";
  if (normalized === "soft_light") return "soft-light";
  if (normalized === "difference") return "difference";
  if (normalized === "lighten") return "lighten";
  if (normalized === "darken") return "darken";
  return "source-over";
}
function setResampleMode(ctx, filter) {
  const mode = String(filter || "bilinear").toLowerCase();
  ctx.imageSmoothingEnabled = mode !== "nearest";
  if (ctx.imageSmoothingEnabled) {
    ctx.imageSmoothingQuality = mode === "bicubic" ? "high" : "medium";
  }
}
function rotatedBounds(width, height, radians) {
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: Math.max(1, Math.ceil(width * cos + height * sin)),
    height: Math.max(1, Math.ceil(width * sin + height * cos))
  };
}
function applyLevels(ctx, W, H, inMin, inMax, gamma, outMin, outMax) {
  const { epsilon: EPS, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const ig = 1 / Math.max(GE, gamma);
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = d[i + c] / 255;
      v = (v - inMin) / Math.max(EPS, inMax - inMin);
      v = clamp01(v);
      v = Math.pow(v, ig);
      v = outMin + v * (outMax - outMin);
      d[i + c] = Math.round(clamp01(v) * 255);
    }
  }
  putImageData(ctx, img);
}
function applyHueSat(ctx, W, H, hueDeg, sat, val) {
  const { epsilon: EPS } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const hue = hueDeg % 360 * Math.PI / 180;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const delta = max - min;
    let h0 = 0;
    if (delta > EPS) {
      if (max === r) h0 = (g - b) / delta % 6;
      else if (max === g) h0 = (b - r) / delta + 2;
      else h0 = (r - g) / delta + 4;
      h0 *= Math.PI / 3;
    }
    let s0 = max === 0 ? 0 : delta / max;
    let v0 = max;
    h0 += hue;
    s0 = clamp01(s0 * sat);
    v0 = clamp01(v0 * val);
    const c = v0 * s0;
    const x = c * (1 - Math.abs(h0 / (Math.PI / 3) % 2 - 1));
    const m = v0 - c;
    let rp = 0, gp = 0, bp = 0;
    const hh = (h0 % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const sector = Math.floor(hh / (Math.PI / 3));
    switch (sector) {
      case 0:
        rp = c;
        gp = x;
        bp = 0;
        break;
      case 1:
        rp = x;
        gp = c;
        bp = 0;
        break;
      case 2:
        rp = 0;
        gp = c;
        bp = x;
        break;
      case 3:
        rp = 0;
        gp = x;
        bp = c;
        break;
      case 4:
        rp = x;
        gp = 0;
        bp = c;
        break;
      case 5:
        rp = c;
        gp = 0;
        bp = x;
        break;
    }
    d[i] = Math.round(clamp01(rp + m) * 255);
    d[i + 1] = Math.round(clamp01(gp + m) * 255);
    d[i + 2] = Math.round(clamp01(bp + m) * 255);
  }
  putImageData(ctx, img);
}
function applyInvert(ctx, W, H, invertAlpha = false) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
    if (invertAlpha) d[i + 3] = 255 - d[i + 3];
  }
  putImageData(ctx, img);
}
function applyClamp(ctx, W, H, minV, maxV) {
  const lo = Math.min(minV, maxV);
  const hi = Math.max(minV, maxV);
  const mn = Math.round(clamp01(lo) * 255);
  const mx = Math.round(clamp01(hi) * 255);
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(mn, Math.min(mx, d[i]));
    d[i + 1] = Math.max(mn, Math.min(mx, d[i + 1]));
    d[i + 2] = Math.max(mn, Math.min(mx, d[i + 2]));
    d[i + 3] = Math.max(mn, Math.min(mx, d[i + 3]));
  }
  putImageData(ctx, img);
}
function applyColorCorrect(ctx, W, H, brightness, contrast, gamma, saturation) {
  const { luma_weights: LW, gamma_safe_min: GMIN, gamma_max: GMAX, preview_gamma_epsilon: GE } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const g = Math.max(GMIN, Math.min(GMAX, gamma));
  const invGamma = 1 / Math.max(GE, g);
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, gr = d[i + 1] / 255, b = d[i + 2] / 255;
    r += brightness;
    gr += brightness;
    b += brightness;
    r = (r - 0.5) * contrast + 0.5;
    gr = (gr - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    r = clamp01(r);
    gr = clamp01(gr);
    b = clamp01(b);
    r = Math.pow(r, invGamma);
    gr = Math.pow(gr, invGamma);
    b = Math.pow(b, invGamma);
    const l = luma01(r, gr, b, LW);
    r = l + (r - l) * saturation;
    gr = l + (gr - l) * saturation;
    b = l + (b - l) * saturation;
    d[i] = Math.round(clamp01(r) * 255);
    d[i + 1] = Math.round(clamp01(gr) * 255);
    d[i + 2] = Math.round(clamp01(b) * 255);
  }
  putImageData(ctx, img);
}
function applyColorCorrectReference(ctx, W, H, temperature, hue, brightness, contrast, saturation, gamma) {
  const { luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const brightnessFactor = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const temperatureFactor = temperature / 100;
  const safeGamma = Math.max(0.2, Math.min(2.2, gamma));
  let meanLuma = 0;
  const pixelCount = Math.max(1, W * H);
  for (let i = 0; i < d.length; i += 4) {
    const r = clamp01(d[i] / 255 * brightnessFactor);
    const g = clamp01(d[i + 1] / 255 * brightnessFactor);
    const b = clamp01(d[i + 2] / 255 * brightnessFactor);
    meanLuma += luma01(r, g, b, LW);
  }
  meanLuma /= pixelCount;
  for (let i = 0; i < d.length; i += 4) {
    let r = clamp01(d[i] / 255 * brightnessFactor);
    let g = clamp01(d[i + 1] / 255 * brightnessFactor);
    let b = clamp01(d[i + 2] / 255 * brightnessFactor);
    r = meanLuma + (r - meanLuma) * contrastFactor;
    g = meanLuma + (g - meanLuma) * contrastFactor;
    b = meanLuma + (b - meanLuma) * contrastFactor;
    if (temperatureFactor > 0) {
      r *= 1 + temperatureFactor;
      g *= 1 + temperatureFactor * 0.4;
    } else if (temperatureFactor < 0) {
      b *= 1 - temperatureFactor;
    }
    d[i] = Math.round(clamp01(Math.pow(clamp01(r), safeGamma)) * 255);
    d[i + 1] = Math.round(clamp01(Math.pow(clamp01(g), safeGamma)) * 255);
    d[i + 2] = Math.round(clamp01(Math.pow(clamp01(b), safeGamma)) * 255);
  }
  putImageData(ctx, img);
  applyHueSat(ctx, W, H, hue, 1 + saturation / 100, 1);
}
function applyUnsharp(ctx, W, H, amount = 1) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.filter = "blur(2px)";
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.filter = "none";
  const o = getImageData(ctx, W, H);
  const b = tctx.getImageData(0, 0, W, H);
  const d = o.data, bd = b.data;
  const a = Math.max(0, amount);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(0, Math.min(255, d[i] + a * (d[i] - bd[i])));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + a * (d[i + 1] - bd[i + 1])));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + a * (d[i + 2] - bd[i + 2])));
  }
  putImageData(ctx, o);
}
function applyEdgeDetect(ctx, W, H, strength = 1) {
  const { luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const gr = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      gr[y * W + x] = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    }
  }
  const out = new Uint8ClampedArray(d.length);
  const k = strength;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const gx = -1 * gr[(y - 1) * W + (x - 1)] + 1 * gr[(y - 1) * W + (x + 1)] + -2 * gr[y * W + (x - 1)] + 2 * gr[y * W + (x + 1)] + -1 * gr[(y + 1) * W + (x - 1)] + 1 * gr[(y + 1) * W + (x + 1)];
      const gy = -1 * gr[(y - 1) * W + (x - 1)] + -2 * gr[(y - 1) * W + x] + -1 * gr[(y - 1) * W + (x + 1)] + 1 * gr[(y + 1) * W + (x - 1)] + 2 * gr[(y + 1) * W + x] + 1 * gr[(y + 1) * W + (x + 1)];
      const mag = clamp01(Math.sqrt(gx * gx + gy * gy) * k);
      const v = Math.round(mag * 255);
      const i = (y * W + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  img.data.set(out);
  putImageData(ctx, img);
}
function applyBlur(ctx, W, H, radiusPx, sigmaPx) {
  const blurPx = Math.max(0, Math.max(radiusPx, sigmaPx));
  if (blurPx <= 0) return;
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.filter = `blur(${blurPx}px)`;
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.filter = "none";
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(tmp, 0, 0);
}
function applyChannel(ctx, W, H, channel) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const normalized = String(channel || "Red").trim().toLowerCase();
  const index = normalized === "green" ? 1 : normalized === "blue" ? 2 : normalized === "alpha" ? 3 : 0;
  for (let i = 0; i < d.length; i += 4) {
    const value = index === 3 ? d[i + 3] : d[i + index];
    d[i] = value;
    d[i + 1] = value;
    d[i + 2] = value;
    if (index === 3) d[i + 3] = value;
  }
  putImageData(ctx, img);
}
function applyTransform(ctx, W, H, tx, ty, rotDeg, scale, filter, expand) {
  const safeScale = Math.max(0.01, scale || 1);
  const rad = rotDeg * Math.PI / 180;
  const needsScale = Math.abs(safeScale - 1) > 1e-4;
  const needsRotate = Math.abs(rotDeg) > 1e-4;
  const needsTranslate = tx !== 0 || ty !== 0;
  if (!needsScale && !needsRotate && !needsTranslate) return;
  let working = makeCanvas(needsScale ? Math.round(W * safeScale) : W, needsScale ? Math.round(H * safeScale) : H);
  let wctx = working.getContext("2d");
  setResampleMode(wctx, filter);
  wctx.clearRect(0, 0, working.width, working.height);
  wctx.drawImage(ctx.canvas, 0, 0, working.width, working.height);
  if (needsRotate) {
    const bounds = expand ? rotatedBounds(working.width, working.height, rad) : { width: working.width, height: working.height };
    const rotated = makeCanvas(bounds.width, bounds.height);
    const rctx = rotated.getContext("2d");
    setResampleMode(rctx, filter);
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate(rad);
    rctx.drawImage(working, -working.width / 2, -working.height / 2);
    working = rotated;
    wctx = rctx;
  }
  const output = makeCanvas(W, H);
  const octx = output.getContext("2d");
  setResampleMode(octx, filter);
  octx.clearRect(0, 0, W, H);
  const drawX = Math.round((W - working.width) / 2 + (needsTranslate ? tx : 0));
  const drawY = Math.round((H - working.height) / 2 + (needsTranslate ? ty : 0));
  octx.drawImage(working, drawX, drawY);
  return output;
}
function applyGlow(ctx, W, H, threshold, intensity, blurPx) {
  const { luma_weights: LW } = getOpsConstants();
  const base = getImageData(ctx, W, H);
  const d = base.data;
  const hi = new Uint8ClampedArray(d.length);
  for (let i = 0; i < d.length; i += 4) {
    const l = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    if (l >= threshold) {
      hi[i] = d[i];
      hi[i + 1] = d[i + 1];
      hi[i + 2] = d[i + 2];
      hi[i + 3] = d[i + 3];
    }
  }
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d");
  tctx.putImageData(new ImageData(hi, W, H), 0, 0);
  const blur = document.createElement("canvas");
  blur.width = W;
  blur.height = H;
  const bctx = blur.getContext("2d");
  bctx.filter = `blur(${Math.max(0, blurPx)}px)`;
  bctx.drawImage(tmp, 0, 0);
  bctx.filter = "none";
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(blur, 0, 0);
  ctx.restore();
}
function applyCropReformat(ctx, W, H, x, y, cw, ch, padding, outW, outH, mode) {
  const cropW = Math.max(1, Math.round(cw));
  const cropH = Math.max(1, Math.round(ch));
  const pad = Math.max(0, Math.round(padding));
  const tmp = document.createElement("canvas");
  tmp.width = cropW + pad * 2;
  tmp.height = cropH + pad * 2;
  const tctx = tmp.getContext("2d");
  tctx.clearRect(0, 0, tmp.width, tmp.height);
  tctx.drawImage(ctx.canvas, -Math.round(x) + pad, -Math.round(y) + pad);
  const finalW = outW > 0 ? Math.round(outW) : tmp.width;
  const finalH = outH > 0 ? Math.round(outH) : tmp.height;
  const dst = document.createElement("canvas");
  dst.width = finalW;
  dst.height = finalH;
  const dctx = dst.getContext("2d");
  dctx.clearRect(0, 0, finalW, finalH);
  if (mode === "stretch") {
    dctx.drawImage(tmp, 0, 0, finalW, finalH);
  } else {
    const s = mode === "fill" ? Math.max(finalW / tmp.width, finalH / tmp.height) : Math.min(finalW / tmp.width, finalH / tmp.height);
    const dw = Math.floor(tmp.width * s);
    const dh = Math.floor(tmp.height * s);
    const dx = Math.floor((finalW - dw) / 2);
    const dy = Math.floor((finalH - dh) / 2);
    dctx.drawImage(tmp, dx, dy, dw, dh);
  }
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(dst, 0, 0, W, H);
}
function applyCrop(ctx, node, sourceWidth, sourceHeight, aspectRatio, outW, outH) {
  const finalW = Math.max(1, Math.round(outW));
  const finalH = Math.max(1, Math.round(outH));
  const ratio = resolveCropAspectRatio(aspectRatio, finalW, finalH);
  const crop = computeCropRect(
    sourceWidth,
    sourceHeight,
    ratio,
    clampCropCenter(num(node, "crop_center_x", 0.5)),
    clampCropCenter(num(node, "crop_center_y", 0.5)),
    clampCropScale(num(node, "crop_scale", 1))
  );
  const output = makeCanvas(finalW, finalH);
  const octx = output.getContext("2d");
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.clearRect(0, 0, finalW, finalH);
  octx.drawImage(
    ctx.canvas,
    crop.x,
    crop.y,
    crop.cropWidth,
    crop.cropHeight,
    0,
    0,
    finalW,
    finalH
  );
  return output;
}
function buildMaskAlphaCanvas(maskCanvas, width, height) {
  const output = makeCanvas(width, height);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, width, height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(maskCanvas, 0, 0, width, height);
  const image = octx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const alpha = data[index + 3] / 255;
    const luma = luma01(data[index] / 255, data[index + 1] / 255, data[index + 2] / 255, getOpsConstants().luma_weights);
    const matte = Math.round(clamp01(luma * alpha) * 255);
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = matte;
  }
  octx.putImageData(image, 0, 0);
  return output;
}
function premultLayerWithMask(imageCanvas, maskCanvas) {
  if (!maskCanvas) return imageCanvas;
  const output = makeCanvas(imageCanvas.width || 1, imageCanvas.height || 1);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, output.width, output.height);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(imageCanvas, 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "destination-in";
  octx.drawImage(buildMaskAlphaCanvas(maskCanvas, output.width, output.height), 0, 0, output.width, output.height);
  octx.globalCompositeOperation = "source-over";
  return output;
}
function renderCompPreview(node, inputLayers) {
  const slots = getCompSlots(node);
  const allLayers = syncCompLayers(str(node, "layers_json", ""), slots);
  const layerBySlot = new Map(allLayers.map((layer) => [layer.slot, layer]));
  const firstInput = inputLayers[0]?.image ?? null;
  const useFirst = bool(node, "use_first_layer_size", true);
  const outputWidth = useFirst && firstInput ? Math.max(1, firstInput.width) : Math.max(1, Math.round(num(node, "width", firstInput?.width ?? 1024)));
  const outputHeight = useFirst && firstInput ? Math.max(1, firstInput.height) : Math.max(1, Math.round(num(node, "height", firstInput?.height ?? 1024)));
  const output = makeCanvas(outputWidth, outputHeight);
  const octx = output.getContext("2d");
  octx.clearRect(0, 0, outputWidth, outputHeight);
  const geometries = [];
  for (let index = 0; index < inputLayers.length; index++) {
    const entry = inputLayers[index];
    const input = premultLayerWithMask(entry.image, entry.mask ?? null);
    const layer = layerBySlot.get(entry.slot);
    if (!input || !layer || layer.enabled === false) continue;
    const rect = computeCompRect(outputWidth, outputHeight, entry.image.width || 1, entry.image.height || 1, layer);
    geometries.push({
      slot: entry.slot,
      layerNumber: entry.layerNumber,
      inputIndex: entry.inputIndex,
      sourceWidth: entry.image.width || 1,
      sourceHeight: entry.image.height || 1,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
    octx.save();
    octx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));
    octx.globalCompositeOperation = compModeToCanvasOp(layer.mode);
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(input, rect.left, rect.top, rect.width, rect.height);
    octx.restore();
  }
  return { canvas: output, layers: geometries };
}
async function renderDrawNodePreview(node, baseCanvas = null) {
  return await renderDrawPreview(node, baseCanvas);
}
function applyLumaKey(ctx, W, H, low, high, softness) {
  const { epsilon: EPS, luma_weights: LW } = getOpsConstants();
  const img = getImageData(ctx, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = luma01(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, LW);
    let a = 0;
    if (l <= low) a = 0;
    else if (l >= high) a = 1;
    else {
      const t = (l - low) / Math.max(EPS, high - low);
      const s = Math.max(0, Math.min(1, softness * 10));
      a = t * (1 - s) + t * t * (3 - 2 * t) * s;
    }
    d[i + 3] = Math.round(clamp01(a) * 255);
  }
  putImageData(ctx, img);
}
function blend(ctx, W, H, topCanvas, mode, mix) {
  const m = Math.max(0, Math.min(1, mix));
  if (m <= 0) return;
  const scaledTop = makeCanvas(W, H);
  const sctx = scaledTop.getContext("2d");
  sctx.clearRect(0, 0, W, H);
  sctx.drawImage(topCanvas, 0, 0, W, H);
  const base = getImageData(ctx, W, H);
  const top = sctx.getImageData(0, 0, W, H);
  const bd = base.data;
  const td = top.data;
  const normalizedMode = String(mode || "over").toLowerCase();
  for (let i = 0; i < bd.length; i += 4) {
    const ar = bd[i] / 255;
    const ag = bd[i + 1] / 255;
    const ab = bd[i + 2] / 255;
    const aa = bd[i + 3] / 255;
    const br = td[i] / 255;
    const bg = td[i + 1] / 255;
    const bb = td[i + 2] / 255;
    const ba = td[i + 3] / 255;
    let rr = br;
    let rg = bg;
    let rb = bb;
    if (normalizedMode === "over") {
      rr = br * ba + ar * (1 - ba);
      rg = bg * ba + ag * (1 - ba);
      rb = bb * ba + ab * (1 - ba);
    } else if (normalizedMode === "add") {
      rr = ar + br;
      rg = ag + bg;
      rb = ab + bb;
    } else if (normalizedMode === "subtract") {
      rr = ar - br;
      rg = ag - bg;
      rb = ab - bb;
    } else if (normalizedMode === "multiply") {
      rr = ar * br;
      rg = ag * bg;
      rb = ab * bb;
    } else if (normalizedMode === "screen") {
      rr = 1 - (1 - ar) * (1 - br);
      rg = 1 - (1 - ag) * (1 - bg);
      rb = 1 - (1 - ab) * (1 - bb);
    } else if (normalizedMode === "difference") {
      rr = Math.abs(ar - br);
      rg = Math.abs(ag - bg);
      rb = Math.abs(ab - bb);
    } else if (normalizedMode === "max") {
      rr = Math.max(ar, br);
      rg = Math.max(ag, bg);
      rb = Math.max(ab, bb);
    } else if (normalizedMode === "min") {
      rr = Math.min(ar, br);
      rg = Math.min(ag, bg);
      rb = Math.min(ab, bb);
    }
    const outR = clamp01(ar * (1 - m) + clamp01(rr) * m);
    const outG = clamp01(ag * (1 - m) + clamp01(rg) * m);
    const outB = clamp01(ab * (1 - m) + clamp01(rb) * m);
    let outA = aa;
    if (normalizedMode === "over") {
      const mergedAlpha = ba + aa * (1 - ba);
      outA = clamp01(aa * (1 - m) + mergedAlpha * m);
    }
    bd[i] = Math.round(outR * 255);
    bd[i + 1] = Math.round(outG * 255);
    bd[i + 2] = Math.round(outB * 255);
    bd[i + 3] = Math.round(clamp01(outA) * 255);
  }
  putImageData(ctx, base);
}
const ops = {
  colorAjust(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyColorCorrectReference(
      ctx,
      width,
      height,
      num(node, "temperature", 0),
      num(node, "hue", num(node, "hue_deg", 0)),
      num(node, "brightness", 0),
      num(node, "contrast", 0),
      num(node, "saturation", 0),
      num(node, "gamma", 1)
    );
  },
  colorCorrect(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyColorCorrectReference(
      ctx,
      width,
      height,
      num(node, "temperature", 0),
      num(node, "hue", num(node, "hue_deg", 0)),
      num(node, "brightness", 0),
      num(node, "contrast", 0),
      num(node, "saturation", 0),
      num(node, "gamma", 1)
    );
  },
  blur(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyBlur(ctx, width, height, num(node, "radius", 0), num(node, "sigma", num(node, "radius", 0)));
  },
  channel(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyChannel(ctx, width, height, str(node, "channel", "Red"));
  },
  crop(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    return applyCrop(
      ctx,
      node,
      width,
      height,
      str(node, "aspect_ratio", "custom"),
      num(node, "width", width),
      num(node, "height", height)
    );
  },
  transform(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    return applyTransform(
      ctx,
      width,
      height,
      num(node, "translate_x", 0),
      num(node, "translate_y", 0),
      num(node, "rotate_deg", 0),
      num(node, "scale", 1),
      str(node, "filter", "bilinear"),
      bool(node, "expand", false)
    );
  },
  levels(ctx, W, node, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    applyLevels(
      ctx,
      width,
      height,
      num(node, "in_min", num(node, "min", 0)),
      num(node, "in_max", num(node, "max", 1)),
      num(node, "gamma", num(node, "mid", 1)),
      num(node, "out_min", 0),
      num(node, "out_max", 1)
    );
  },
  hueSat(ctx, W, node, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    applyHueSat(
      ctx,
      width,
      height,
      num(node, "hue_deg", num(node, "hue", 0)),
      num(node, "saturation", num(node, "sat", 1)),
      num(node, "value", num(node, "val", 1))
    );
  },
  invert(ctx, W, node, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    applyInvert(ctx, width, height, bool(node, "invert_alpha", false));
  },
  clamp(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyClamp(ctx, width, height, num(node, "min_v", 0), num(node, "max_v", 1));
  },
  sharpen(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyUnsharp(ctx, width, height, num(node, "amount", 1));
  },
  edgeDetect(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyEdgeDetect(ctx, width, height, num(node, "strength", 1));
  },
  glow(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyGlow(ctx, width, height, num(node, "threshold", 0.8), num(node, "intensity", 0.75), Math.round(num(node, "blur_px", 6)));
  },
  cropReformat(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyCropReformat(
      ctx,
      width,
      height,
      num(node, "x", 0),
      num(node, "y", 0),
      num(node, "crop_w", width),
      num(node, "crop_h", height),
      num(node, "padding", 0),
      num(node, "out_w", 0),
      num(node, "out_h", 0),
      str(node, "mode", "fit")
    );
  },
  lumaKey(ctx, W, node) {
    const { width, height } = getCanvasDimensions(ctx);
    applyLumaKey(ctx, width, height, num(node, "low", 0.1), num(node, "high", 0.9), num(node, "softness", 0.05));
  },
  merge(ctx, W, node, topCanvas, _opts) {
    const { width, height } = getCanvasDimensions(ctx);
    blend(ctx, width, height, topCanvas, str(node, "mode", "over"), num(node, "mix", 1));
  },
  comp(ctx, W, node, inputs) {
    const connectedSlots = getCompSlots(node).filter((slot) => (node.inputs?.[slot.inputIndex]?.link ?? null) != null);
    return renderCompPreview(
      node,
      inputs.map((canvas, index) => ({
        image: canvas,
        slot: connectedSlots[index]?.slot ?? `image_${index + 1}`,
        layerNumber: connectedSlots[index]?.layerNumber ?? index + 1,
        inputIndex: connectedSlots[index]?.inputIndex ?? index
      }))
    ).canvas;
  },
  async draw(ctx, W, node, inputs) {
    return await renderDrawPreview(node, inputs[0] ?? null);
  }
};
export {
  ops,
  renderCompPreview,
  renderDrawNodePreview
};
