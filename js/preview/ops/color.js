import { getOpsConstants } from "../constants.js";
import { boolAny, numAny, strAny } from "../graph.js";
import { getImageData, makeCanvas, putImageData } from "../renderer.js";
import { acquireCanvas, releaseCanvas } from "../shared/canvas-pool.js";
import { applyColorCorrectGL } from "../shared/webgl-color.js";
import { blurMaskCanvas, markPreparedMaskCanvas, resolvePreviewMaskCanvas } from "./masks.js";
import { renderMaskedEffectPreview, buildMaskAlphaCanvas } from "./masks.js";
import { wAny } from "../graph.js";
import { applyEffectToCanvas, getCanvasDimensions } from "../renderer.js";
import { extractSplitChannelCanvas, applyChannel } from "./video.js";
import { applyColorCorrectGL as applyColorCorrectGL2, isWebGLColorAvailable } from "../shared/webgl-color.js";
import { applyGlow } from "./blend.js";
const colorOps = {
  colorAjust,
  colorCorrect,
  levels,
  hueSat,
  desaturate,
  invert,
  clamp,
  channel,
  lumaKey,
  sharpen,
  edgeDetect,
  glow,
  blur
};
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}
function luma01(r, g, b, lw) {
  return lw[0] * r + lw[1] * g + lw[2] * b;
}
function hexToRgb01(value) {
  const hex = parseHexColor(value);
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  ];
}
function rgbToHsv01(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 1e-4) {
    if (max === r) hue = (g - b) / delta % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue /= 6;
    if (hue < 0) hue += 1;
  }
  const sat = max <= 0 ? 0 : delta / max;
  return [hue, sat, max];
}
function parseHexColor(value) {
  const raw = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/i.test(raw)) {
    const chars = raw.slice(1).split("");
    return `#${chars.map((ch) => `${ch}${ch}`).join("")}`;
  }
  const rgb = raw.match(/^(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})$/);
  if (rgb) {
    const channels = rgb.slice(1, 4).map((part) => {
      const channel2 = Math.max(0, Math.min(255, parseInt(part, 10) || 0));
      return channel2.toString(16).padStart(2, "0");
    });
    return `#${channels.join("")}`;
  }
  if (raw.toLowerCase() === "white") return "#ffffff";
  if (raw.toLowerCase() === "red") return "#ff0000";
  if (raw.toLowerCase() === "green") return "#00ff00";
  if (raw.toLowerCase() === "blue") return "#0000ff";
  return "#000000";
}
function srgbToLinear01(value) {
  const v = clamp01(value);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb01(value) {
  const v = clamp01(value);
  return v <= 31308e-7 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
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
function applyColorCorrectReference(ctx, W, H, temperature, tint, hue, brightness, contrast, saturation, vibrance, gamma, shadowsHue, shadowsAmount, midtonesHue, midtonesAmount, highlightsHue, highlightsAmount, perZone) {
  const { luma_weights: LW } = getOpsConstants();
  const okGL = applyColorCorrectGL(ctx, W, H, {
    temperature,
    tint,
    hue,
    brightness,
    contrast,
    saturation,
    vibrance,
    gamma,
    shadowsHue,
    shadowsAmount,
    midtonesHue,
    midtonesAmount,
    highlightsHue,
    highlightsAmount,
    lumaWeights: [LW[0], LW[1], LW[2]],
    ...perZone ?? {}
  });
  if (okGL) return;
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const brightnessFactor = 1 + brightness / 100;
  const contrastFactor = 1 + contrast / 100;
  const temperatureFactor = temperature / 100;
  const tintFactor = tint / 100;
  const vibranceFactor = vibrance / 100;
  const safeGamma = Math.max(0.2, Math.min(2.2, gamma));
  const wheelTint = (hueDeg, amount) => {
    const sat = clamp01(amount / 100);
    const rad = (hueDeg % 360 + 360) % 360;
    const sector = rad / 60;
    const c = sat;
    const x = c * (1 - Math.abs(sector % 2 - 1));
    let rp = 0, gp = 0, bp = 0;
    if (sector < 1) [rp, gp, bp] = [c, x, 0];
    else if (sector < 2) [rp, gp, bp] = [x, c, 0];
    else if (sector < 3) [rp, gp, bp] = [0, c, x];
    else if (sector < 4) [rp, gp, bp] = [0, x, c];
    else if (sector < 5) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];
    return [rp, gp, bp];
  };
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
    if (tintFactor > 0) {
      r *= 1 + tintFactor * 0.25;
      b *= 1 + tintFactor * 0.35;
      g *= 1 - tintFactor * 0.2;
    } else if (tintFactor < 0) {
      g *= 1 + -tintFactor * 0.3;
      r *= 1 - -tintFactor * 0.12;
      b *= 1 - -tintFactor * 0.08;
    }
    const luma = luma01(r, g, b, LW);
    const maxChroma = Math.max(r, g, b);
    const minChroma = Math.min(r, g, b);
    const chroma = maxChroma - minChroma;
    const muted = 1 - clamp01(chroma);
    const vibranceBoost = 1 + vibranceFactor * muted;
    r = luma + (r - luma) * vibranceBoost;
    g = luma + (g - luma) * vibranceBoost;
    b = luma + (b - luma) * vibranceBoost;
    const shadowMask = Math.max(0, Math.min(1, (0.5 - luma) / 0.5)) ** 2;
    const highlightMask = Math.max(0, Math.min(1, (luma - 0.5) / 0.5)) ** 2;
    const midMask = Math.max(0, Math.min(1, 1 - shadowMask - highlightMask));
    const [sr, sg, sb] = wheelTint(shadowsHue, shadowsAmount);
    const [mr, mg, mb] = wheelTint(midtonesHue, midtonesAmount);
    const [hr, hg, hb] = wheelTint(highlightsHue, highlightsAmount);
    r *= 1 + ((sr - 0.5) * shadowMask + (mr - 0.5) * midMask + (hr - 0.5) * highlightMask) * 0.85;
    g *= 1 + ((sg - 0.5) * shadowMask + (mg - 0.5) * midMask + (hg - 0.5) * highlightMask) * 0.85;
    b *= 1 + ((sb - 0.5) * shadowMask + (mb - 0.5) * midMask + (hb - 0.5) * highlightMask) * 0.85;
    d[i] = Math.round(clamp01(Math.pow(clamp01(r), safeGamma)) * 255);
    d[i + 1] = Math.round(clamp01(Math.pow(clamp01(g), safeGamma)) * 255);
    d[i + 2] = Math.round(clamp01(Math.pow(clamp01(b), safeGamma)) * 255);
  }
  putImageData(ctx, img);
  applyHueSat(ctx, W, H, hue, 1 + saturation / 100, 1);
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
function smoothRange01(value, low, high, softness) {
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const soft = Math.max(0, softness);
  if (soft <= 1e-6) return value >= lo && value <= hi ? 1 : 0;
  const lower = clamp01((value - (lo - soft)) / soft);
  const upper = clamp01((hi + soft - value) / soft);
  const smoothLower = lower * lower * (3 - 2 * lower);
  const smoothUpper = upper * upper * (3 - 2 * upper);
  return clamp01(Math.min(smoothLower, smoothUpper));
}
function softKeyDistance(distance, tolerance, softness) {
  const tol = clamp01(tolerance);
  const soft = clamp01(softness);
  if (soft <= 1e-6) return distance <= tol ? 1 : 0;
  const t = clamp01((tol + soft - distance) / soft);
  return t * t * (3 - 2 * t);
}
function parseKeyColors(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      if (typeof item === "string") out.push(hexToRgb01(item));
    }
    return out;
  } catch {
    return [];
  }
}
function renderKeyerCanvases(node, source, rawMask, frameIndex) {
  const width = source.width || 1;
  const height = source.height || 1;
  const image = makeCanvas(width, height);
  const mask = makeCanvas(width, height);
  const ictx = image.getContext("2d", { willReadFrequently: true });
  const mctx = mask.getContext("2d", { willReadFrequently: true });
  ictx.drawImage(source, 0, 0, width, height);
  const img = ictx.getImageData(0, 0, width, height);
  const data = img.data;
  const sourceAlpha = new Uint8ClampedArray(data.length / 4);
  const maskImg = mctx.createImageData(width, height);
  const maskData = maskImg.data;
  const extMask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  const extData = extMask?.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;
  const keyMode = strAny(node, ["mode", "key_mode"], "color", frameIndex).toLowerCase();
  const keyColors = parseKeyColors(strAny(node, ["key_colors"], "", frameIndex));
  const keyTargets = keyColors.length > 0 ? keyColors : [hexToRgb01(strAny(node, ["key_color"], "#00ff00", frameIndex))];
  const tolerance = numAny(node, ["tolerance"], 0.25, frameIndex);
  const softness = numAny(node, ["softness"], 0.1, frameIndex);
  const gain = Math.max(0, numAny(node, ["gain"], 1, frameIndex));
  const blur2 = Math.max(0, numAny(node, ["blur"], 0, frameIndex));
  const invert2 = boolAny(node, ["invert"], false, frameIndex);
  const LW = getOpsConstants().luma_weights;
  for (let i = 0; i < data.length; i += 4) {
    sourceAlpha[i / 4] = data[i + 3];
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    let distance = 0;
    if (keyMode === "luma" || keyMode === "luminance") distance = luma01(r, g, b, LW);
    else {
      let minDistance = Number.POSITIVE_INFINITY;
      for (const keyColor of keyTargets) {
        minDistance = Math.min(minDistance, Math.hypot(r - keyColor[0], g - keyColor[1], b - keyColor[2]) / Math.sqrt(3));
      }
      distance = Number.isFinite(minDistance) ? minDistance : 0;
    }
    const matte = clamp01((1 - softKeyDistance(distance, tolerance, softness)) * gain);
    maskData[i] = 255;
    maskData[i + 1] = 255;
    maskData[i + 2] = 255;
    maskData[i + 3] = Math.round(matte * 255);
  }
  mctx.putImageData(maskImg, 0, 0);
  const finalMask = blur2 > 1e-3 ? blurMaskCanvas(mask, blur2) : mask;
  const finalMaskData = finalMask.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, width, height).data ?? null;
  if (finalMaskData) {
    for (let i = 0; i < data.length; i += 4) {
      let matte = finalMaskData[i + 3] / 255;
      if (extData) matte *= extData[i + 3] / 255;
      if (invert2) matte = 1 - matte;
      data[i + 3] = Math.round(clamp01(sourceAlpha[i / 4] / 255 * matte) * 255);
    }
  }
  ictx.putImageData(img, 0, 0);
  markPreparedMaskCanvas(finalMask);
  return { image, mask: finalMask };
}
function applyBlur(ctx, W, H, radiusPx, sigmaPx) {
  const blurPx = resolveBlurRadiusPx(radiusPx, sigmaPx);
  if (blurPx <= 0) return;
  const safeSigma = Math.max(0, sigmaPx);
  const cssSigma = safeSigma > 0 ? Math.min(blurPx, safeSigma) : Math.max(0.1, blurPx / 3);
  const tmp = acquireCanvas(W, H);
  try {
    const tctx = tmp.getContext("2d", { willReadFrequently: true });
    tctx.filter = `blur(${cssSigma}px)`;
    tctx.drawImage(ctx.canvas, 0, 0);
    tctx.filter = "none";
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(tmp, 0, 0);
  } finally {
    releaseCanvas(tmp);
  }
}
function applyUnsharp(ctx, W, H, amount = 1) {
  const tmp = document.createElement("canvas");
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
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
function resolveBlurRadiusPx(radiusPx, sigmaPx) {
  const safeRadius = Math.max(0, Math.round(radiusPx));
  void sigmaPx;
  return safeRadius;
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
function applyDesaturate(ctx, W, H, factor = 1) {
  const img = getImageData(ctx, W, H);
  const d = img.data;
  const amount = clamp01(factor);
  const lw = getOpsConstants().luma_weights;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const l = luma01(r, g, b, lw);
    d[i] = Math.round(clamp01(r * (1 - amount) + l * amount) * 255);
    d[i + 1] = Math.round(clamp01(g * (1 - amount) + l * amount) * 255);
    d[i + 2] = Math.round(clamp01(b * (1 - amount) + l * amount) * 255);
  }
  putImageData(ctx, img);
}
function colorAjust(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const rawMask = inputs[1] ?? null;
  return renderMaskedEffectPreview(
    node,
    source,
    rawMask,
    (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
      applyColorCorrectReference(
        effectCtx,
        width,
        height,
        numAny(node, ["temperature"], 0, frameIndex),
        numAny(node, ["tint"], 0, frameIndex),
        numAny(node, ["hue", "hue_deg"], 0, frameIndex),
        numAny(node, ["brightness"], 0, frameIndex),
        numAny(node, ["contrast"], 0, frameIndex),
        numAny(node, ["saturation", "sat"], 0, frameIndex),
        numAny(node, ["vibrance"], 0, frameIndex),
        numAny(node, ["gamma"], 1, frameIndex),
        numAny(node, ["shadows_hue"], 0, frameIndex),
        numAny(node, ["shadows_amount"], 0, frameIndex),
        numAny(node, ["midtones_hue"], 0, frameIndex),
        numAny(node, ["midtones_amount"], 0, frameIndex),
        numAny(node, ["highlights_hue"], 0, frameIndex),
        numAny(node, ["highlights_amount"], 0, frameIndex),
        {
          shadowsTemperature: numAny(node, ["shadows_temperature"], 0, frameIndex),
          shadowsTint: numAny(node, ["shadows_tint"], 0, frameIndex),
          shadowsContrast: numAny(node, ["shadows_contrast"], 0, frameIndex),
          shadowsSaturation: numAny(node, ["shadows_saturation"], 0, frameIndex),
          shadowsVibrance: numAny(node, ["shadows_vibrance"], 0, frameIndex),
          shadowsGamma: numAny(node, ["shadows_gamma"], 1, frameIndex),
          shadowsBrightness: numAny(node, ["shadows_brightness"], 0, frameIndex),
          midtonesTemperature: numAny(node, ["midtones_temperature"], 0, frameIndex),
          midtonesTint: numAny(node, ["midtones_tint"], 0, frameIndex),
          midtonesContrast: numAny(node, ["midtones_contrast"], 0, frameIndex),
          midtonesSaturation: numAny(node, ["midtones_saturation"], 0, frameIndex),
          midtonesVibrance: numAny(node, ["midtones_vibrance"], 0, frameIndex),
          midtonesGamma: numAny(node, ["midtones_gamma"], 1, frameIndex),
          midtonesBrightness: numAny(node, ["midtones_brightness"], 0, frameIndex),
          highlightsTemperature: numAny(node, ["highlights_temperature"], 0, frameIndex),
          highlightsTint: numAny(node, ["highlights_tint"], 0, frameIndex),
          highlightsContrast: numAny(node, ["highlights_contrast"], 0, frameIndex),
          highlightsSaturation: numAny(node, ["highlights_saturation"], 0, frameIndex),
          highlightsVibrance: numAny(node, ["highlights_vibrance"], 0, frameIndex),
          highlightsGamma: numAny(node, ["highlights_gamma"], 1, frameIndex),
          highlightsBrightness: numAny(node, ["highlights_brightness"], 0, frameIndex)
        }
      );
    }),
    { frameIndex }
  );
}
function colorCorrect(ctx, W, node, inputs = [], frameIndex = 0) {
  return colorAjust(ctx, W, node, inputs, frameIndex);
}
function blur(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const rawMask = inputs[1] ?? null;
  const radius = numAny(node, ["radius", "blur", "blur_radius"], 0, frameIndex);
  const blurType = strAny(node, ["blur_type"], "gaussian", frameIndex);
  const sigmaFallback = radius > 0 ? Math.max(0.1, radius / 3) : 0;
  const sigma = numAny(node, ["sigma"], sigmaFallback, frameIndex);
  let cssSigma;
  if (blurType === "box") {
    cssSigma = radius > 0 ? Math.max(0.1, radius / Math.sqrt(3)) : 0;
  } else if (blurType === "defocus") {
    cssSigma = radius > 0 ? Math.max(0.1, radius * 0.6) : 0;
  } else {
    cssSigma = sigma > 0 ? sigma : sigmaFallback;
  }
  const blurFn = (input) => applyEffectToCanvas(input, (effectCtx, width, height) => {
    applyBlur(effectCtx, width, height, radius, cssSigma);
  });
  if (!rawMask) return blurFn(source);
  const mask = resolvePreviewMaskCanvas(node, source, rawMask, frameIndex);
  if (!mask) return blurFn(source);
  const sw = source.width || 1;
  const sh = source.height || 1;
  const blurred = blurFn(source);
  const fittedMask = buildMaskAlphaCanvas(mask, sw, sh);
  const output = makeCanvas(sw, sh);
  const outCtx = output.getContext("2d", { willReadFrequently: true });
  const blurredMasked = acquireCanvas(sw, sh);
  try {
    const bmCtx = blurredMasked.getContext("2d", { willReadFrequently: true });
    bmCtx.clearRect(0, 0, sw, sh);
    bmCtx.globalCompositeOperation = "source-over";
    bmCtx.drawImage(blurred, 0, 0);
    bmCtx.globalCompositeOperation = "destination-in";
    bmCtx.drawImage(fittedMask, 0, 0);
    bmCtx.globalCompositeOperation = "source-over";
    outCtx.clearRect(0, 0, sw, sh);
    outCtx.drawImage(source, 0, 0);
    outCtx.globalCompositeOperation = "destination-out";
    outCtx.drawImage(fittedMask, 0, 0);
    outCtx.globalCompositeOperation = "source-over";
    outCtx.drawImage(blurredMasked, 0, 0);
  } finally {
    releaseCanvas(blurredMasked);
  }
  return output;
}
function channel(ctx, W, node, outputSlot, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  const splitMode = strAny(node, ["mode"], "RGBA", frameIndex);
  const hasSingleChannelWidget = !!wAny(node, ["channel"]);
  if (!hasSingleChannelWidget && outputSlot != null) {
    return extractSplitChannelCanvas(source, outputSlot, splitMode);
  }
  const extracted = applyEffectToCanvas(source, (effectCtx, width, height) => {
    applyChannel(effectCtx, width, height, strAny(node, ["channel"], "Red", frameIndex));
  });
  const ectx = extracted.getContext("2d", { willReadFrequently: true });
  const img = ectx.getImageData(0, 0, extracted.width, extracted.height);
  const data = img.data;
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  ectx.putImageData(img, 0, 0);
  return extracted;
}
function levels(ctx, W, node, _opts) {
  const { width, height } = getCanvasDimensions(ctx);
  applyLevels(
    ctx,
    width,
    height,
    numAny(node, ["in_min", "min"], 0),
    numAny(node, ["in_max", "max"], 1),
    numAny(node, ["gamma", "mid"], 1),
    numAny(node, ["out_min"], 0),
    numAny(node, ["out_max"], 1)
  );
}
function hueSat(ctx, W, node, _opts) {
  const { width, height } = getCanvasDimensions(ctx);
  applyHueSat(
    ctx,
    width,
    height,
    numAny(node, ["hue_deg", "hue"], 0),
    numAny(node, ["saturation", "sat"], 1),
    numAny(node, ["value", "val"], 1)
  );
}
function invert(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return applyEffectToCanvas(source, (effectCtx, width, height) => {
    applyInvert(effectCtx, width, height, boolAny(node, ["invert_alpha"], false, frameIndex));
  });
}
function clamp(ctx, W, node, inputs = [], frameIndex = 0) {
  const source = inputs[0] ?? ctx.canvas;
  return applyEffectToCanvas(source, (effectCtx, width, height) => {
    applyClamp(effectCtx, width, height, numAny(node, ["min_v", "min"], 0, frameIndex), numAny(node, ["max_v", "max"], 1, frameIndex));
  });
}
function sharpen(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  applyUnsharp(ctx, width, height, numAny(node, ["amount", "strength", "factor"], 1));
}
function edgeDetect(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  applyEdgeDetect(ctx, width, height, numAny(node, ["strength"], 1));
}
function glow(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  applyGlow(ctx, width, height, numAny(node, ["threshold"], 0.8), numAny(node, ["intensity"], 0.75), Math.round(numAny(node, ["blur_px", "blur", "radius"], 6)));
}
function lumaKey(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  applyLumaKey(ctx, width, height, numAny(node, ["low"], 0.1), numAny(node, ["high"], 0.9), numAny(node, ["softness"], 0.05));
}
function desaturate(ctx, W, node) {
  const { width, height } = getCanvasDimensions(ctx);
  const factor = numAny(node, ["factor", "amount"], 1);
  applyDesaturate(ctx, width, height, factor);
}
export {
  applyBlur,
  applyClamp,
  applyColorCorrect,
  applyColorCorrectGL2 as applyColorCorrectGL,
  applyColorCorrectReference,
  applyDesaturate,
  applyEdgeDetect,
  applyHueSat,
  applyInvert,
  applyLevels,
  applyLumaKey,
  applyUnsharp,
  blur,
  channel,
  clamp,
  clamp01,
  colorAjust,
  colorCorrect,
  colorOps,
  desaturate,
  edgeDetect,
  glow,
  hexToRgb01,
  hueSat,
  invert,
  isWebGLColorAvailable,
  levels,
  linearToSrgb01,
  luma01,
  lumaKey,
  parseHexColor,
  parseKeyColors,
  renderKeyerCanvases,
  resolveBlurRadiusPx,
  rgbToHsv01,
  sharpen,
  smoothRange01,
  softKeyDistance,
  srgbToLinear01
};
