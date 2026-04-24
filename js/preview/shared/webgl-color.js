import { releaseCanvas } from "./canvas-pool.js";
let _state = null;
let _initFailed = false;
const VERTEX_SRC = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = (a_pos + 1.0) * 0.5;
  // Flip Y so canvas readback matches normal 2D orientation.
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;
const FRAGMENT_SRC = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_temperature;
uniform float u_tint;
uniform float u_hue;
uniform float u_saturation;
uniform float u_vibrance;
uniform float u_gamma;
uniform float u_meanLuma;
uniform vec3 u_lumaWeights;
uniform vec3 u_shadowsTint;   // wheelTint(shadowsHue, shadowsAmount)
uniform vec3 u_midtonesTint;
uniform vec3 u_highlightsTint;
// Per-zone primaries. Each pack stores (temperature, tint, contrast, vibrance)
// or (brightness, saturation, gamma, _unused) as additive deltas (for gamma:
// delta from 1.0). Defaults are all zero \u2014 pipeline collapses to global only.
uniform vec4 u_zoneShadows0;    // (temperature, tint, contrast, vibrance) /100
uniform vec4 u_zoneShadows1;    // (brightness/100, saturation/100, gamma-1, _)
uniform vec4 u_zoneMidtones0;
uniform vec4 u_zoneMidtones1;
uniform vec4 u_zoneHighlights0;
uniform vec4 u_zoneHighlights1;

float clamp01(float v) { return clamp(v, 0.0, 1.0); }

vec3 applyHueSat(vec3 rgb, float hueDeg, float satFactor) {
  // Standard HSV-style hue rotation + saturation scale.
  float h = radians(hueDeg);
  float c = cos(h);
  float s = sin(h);
  // YIQ rotation matrix (luma-preserving hue rotation).
  mat3 yiq = mat3(
    0.299, 0.587, 0.114,
    0.596, -0.274, -0.322,
    0.211, -0.523, 0.312
  );
  mat3 yiqInv = mat3(
    1.0, 0.956, 0.621,
    1.0, -0.272, -0.647,
    1.0, -1.106, 1.703
  );
  vec3 v = yiq * rgb;
  // Rotate I,Q by hue; scale by saturation.
  float i2 = c * v.y - s * v.z;
  float q2 = s * v.y + c * v.z;
  v.y = i2 * satFactor;
  v.z = q2 * satFactor;
  vec3 outRGB = yiqInv * v;
  return clamp(outRGB, 0.0, 1.0);
}

void main() {
  vec4 src = texture2D(u_tex, v_uv);
  float alpha = src.a;

  // ----- Per-zone resolution --------------------------------------------
  // Compute zone masks from the SOURCE luma (before any modification) so
  // sliders react to what the user sees, not to the in-flight pixel.
  float lumaSrc = dot(src.rgb, u_lumaWeights);
  float maskS = clamp01((0.5 - lumaSrc) / 0.5); maskS *= maskS;
  float maskH = clamp01((lumaSrc - 0.5) / 0.5); maskH *= maskH;
  float maskM = clamp01(1.0 - maskS - maskH);
  vec4 zone0 = u_zoneShadows0 * maskS + u_zoneMidtones0 * maskM + u_zoneHighlights0 * maskH;
  vec4 zone1 = u_zoneShadows1 * maskS + u_zoneMidtones1 * maskM + u_zoneHighlights1 * maskH;
  float effTemperature = u_temperature + zone0.x;
  float effTint        = u_tint        + zone0.y;
  float effContrast    = u_contrast    + zone0.z;
  float effVibrance    = u_vibrance    + zone0.w;
  float effBrightness  = u_brightness  + zone1.x;
  float effSaturation  = u_saturation  + zone1.y;
  float effGamma       = clamp(u_gamma + zone1.z, 0.2, 2.2);

  vec3 c = src.rgb * effBrightness;
  c = clamp(c, 0.0, 1.0);

  // Contrast around the running mean luma (matches reference).
  c = vec3(u_meanLuma) + (c - vec3(u_meanLuma)) * effContrast;

  // Temperature.
  if (effTemperature > 0.0) {
    c.r *= 1.0 + effTemperature;
    c.g *= 1.0 + effTemperature * 0.4;
  } else if (effTemperature < 0.0) {
    c.b *= 1.0 - effTemperature;
  }

  // Tint.
  if (effTint > 0.0) {
    c.r *= 1.0 + effTint * 0.25;
    c.b *= 1.0 + effTint * 0.35;
    c.g *= 1.0 - effTint * 0.20;
  } else if (effTint < 0.0) {
    float t = -effTint;
    c.g *= 1.0 + t * 0.30;
    c.r *= 1.0 - t * 0.12;
    c.b *= 1.0 - t * 0.08;
  }

  // Vibrance: boost saturation more for muted pixels.
  float luma = dot(c, u_lumaWeights);
  float maxC = max(c.r, max(c.g, c.b));
  float minC = min(c.r, min(c.g, c.b));
  float chroma = maxC - minC;
  float muted = 1.0 - clamp01(chroma);
  float vibBoost = 1.0 + effVibrance * muted;
  c = vec3(luma) + (c - vec3(luma)) * vibBoost;

  // Shadow / midtone / highlight chroma tints (independent of primaries).
  float lumaC = dot(c, u_lumaWeights);
  float shadowMask = pow(clamp01((0.5 - lumaC) / 0.5), 2.0);
  float highlightMask = pow(clamp01((lumaC - 0.5) / 0.5), 2.0);
  float midMask = clamp01(1.0 - shadowMask - highlightMask);
  vec3 tintShift =
      (u_shadowsTint    - vec3(0.5)) * shadowMask +
      (u_midtonesTint   - vec3(0.5)) * midMask +
      (u_highlightsTint - vec3(0.5)) * highlightMask;
  c *= 1.0 + tintShift * 0.85;

  // Gamma + clamp.
  c = clamp(c, 0.0, 1.0);
  c = pow(c, vec3(effGamma));

  // Final hue/saturation pass to mirror the reference's trailing applyHueSat().
  c = applyHueSat(c, u_hue, effSaturation);

  gl_FragColor = vec4(c, alpha);
}`;
function compileShader(gl, type, src) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn("[ImageOps] WebGL shader compile failed:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}
function ensureState() {
  if (_initFailed) return null;
  if (_state && !_state.gl.isContextLost()) return _state;
  _state = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      antialias: false
    });
    if (!gl) {
      _initFailed = true;
      return null;
    }
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) {
      _initFailed = true;
      return null;
    }
    const program = gl.createProgram();
    if (!program) {
      _initFailed = true;
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn("[ImageOps] WebGL program link failed:", gl.getProgramInfoLog(program));
      _initFailed = true;
      return null;
    }
    const buf = gl.createBuffer();
    if (!buf) {
      _initFailed = true;
      return null;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1,
      -1,
      1,
      -1,
      -1,
      1,
      -1,
      1,
      1,
      -1,
      1,
      1
    ]), gl.STATIC_DRAW);
    const tex = gl.createTexture();
    if (!tex) {
      _initFailed = true;
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const uniforms = {
      u_tex: gl.getUniformLocation(program, "u_tex"),
      u_brightness: gl.getUniformLocation(program, "u_brightness"),
      u_contrast: gl.getUniformLocation(program, "u_contrast"),
      u_temperature: gl.getUniformLocation(program, "u_temperature"),
      u_tint: gl.getUniformLocation(program, "u_tint"),
      u_hue: gl.getUniformLocation(program, "u_hue"),
      u_saturation: gl.getUniformLocation(program, "u_saturation"),
      u_vibrance: gl.getUniformLocation(program, "u_vibrance"),
      u_gamma: gl.getUniformLocation(program, "u_gamma"),
      u_meanLuma: gl.getUniformLocation(program, "u_meanLuma"),
      u_lumaWeights: gl.getUniformLocation(program, "u_lumaWeights"),
      u_shadowsTint: gl.getUniformLocation(program, "u_shadowsTint"),
      u_midtonesTint: gl.getUniformLocation(program, "u_midtonesTint"),
      u_highlightsTint: gl.getUniformLocation(program, "u_highlightsTint"),
      u_zoneShadows0: gl.getUniformLocation(program, "u_zoneShadows0"),
      u_zoneShadows1: gl.getUniformLocation(program, "u_zoneShadows1"),
      u_zoneMidtones0: gl.getUniformLocation(program, "u_zoneMidtones0"),
      u_zoneMidtones1: gl.getUniformLocation(program, "u_zoneMidtones1"),
      u_zoneHighlights0: gl.getUniformLocation(program, "u_zoneHighlights0"),
      u_zoneHighlights1: gl.getUniformLocation(program, "u_zoneHighlights1")
    };
    _state = { canvas, gl, program, buf, texture: tex, uniforms };
    return _state;
  } catch (err) {
    console.warn("[ImageOps] WebGL color-correct init failed \u2014 falling back to CPU.", err);
    _initFailed = true;
    return null;
  }
}
function wheelTint(hueDeg, amount) {
  const sat = Math.max(0, Math.min(1, amount / 100));
  const rad = (hueDeg % 360 + 360) % 360;
  const sector = rad / 60;
  const c = sat;
  const x = c * (1 - Math.abs(sector % 2 - 1));
  let r, g, b;
  if (sector < 1) {
    r = c;
    g = x;
    b = 0;
  } else if (sector < 2) {
    r = x;
    g = c;
    b = 0;
  } else if (sector < 3) {
    r = 0;
    g = c;
    b = x;
  } else if (sector < 4) {
    r = 0;
    g = x;
    b = c;
  } else if (sector < 5) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [0.5 + (r - sat * 0.5), 0.5 + (g - sat * 0.5), 0.5 + (b - sat * 0.5)];
}
function isWebGLColorAvailable() {
  return ensureState() != null;
}
function applyColorCorrectGL(targetCtx, width, height, params) {
  const st = ensureState();
  if (!st) return false;
  const { gl, program, buf, texture, uniforms } = st;
  if (gl.isContextLost()) {
    _state = null;
    return false;
  }
  let src;
  try {
    src = targetCtx.getImageData(0, 0, width, height);
  } catch (e) {
    console.warn("[ImageOps] WebGL color-correct: getImageData failed", e);
    return false;
  }
  const brightnessFactor = 1 + params.brightness / 100;
  const data = src.data;
  let meanLuma = 0;
  const pixelCount = Math.max(1, width * height);
  const stride = Math.max(4, Math.floor(data.length / 4 / 4096) * 4) || 4;
  let sampled = 0;
  for (let i = 0; i < data.length; i += stride * 4) {
    const r = Math.min(1, data[i] / 255 * brightnessFactor);
    const g = Math.min(1, data[i + 1] / 255 * brightnessFactor);
    const b = Math.min(1, data[i + 2] / 255 * brightnessFactor);
    meanLuma += params.lumaWeights[0] * r + params.lumaWeights[1] * g + params.lumaWeights[2] * b;
    sampled++;
  }
  if (sampled === 0) {
    for (let i = 0; i < data.length; i += 4) {
      const r = Math.min(1, data[i] / 255 * brightnessFactor);
      const g = Math.min(1, data[i + 1] / 255 * brightnessFactor);
      const b = Math.min(1, data[i + 2] / 255 * brightnessFactor);
      meanLuma += params.lumaWeights[0] * r + params.lumaWeights[1] * g + params.lumaWeights[2] * b;
    }
    meanLuma /= pixelCount;
  } else {
    meanLuma /= sampled;
  }
  try {
    if (st.canvas.width !== width) st.canvas.width = width;
    if (st.canvas.height !== height) st.canvas.height = height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const aPos = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1i(uniforms.u_tex, 0);
    gl.uniform1f(uniforms.u_brightness, brightnessFactor);
    gl.uniform1f(uniforms.u_contrast, 1 + params.contrast / 100);
    gl.uniform1f(uniforms.u_temperature, params.temperature / 100);
    gl.uniform1f(uniforms.u_tint, params.tint / 100);
    gl.uniform1f(uniforms.u_hue, params.hue);
    gl.uniform1f(uniforms.u_saturation, 1 + params.saturation / 100);
    gl.uniform1f(uniforms.u_vibrance, params.vibrance / 100);
    gl.uniform1f(uniforms.u_gamma, Math.max(0.2, Math.min(2.2, params.gamma)));
    gl.uniform1f(uniforms.u_meanLuma, meanLuma);
    gl.uniform3fv(uniforms.u_lumaWeights, params.lumaWeights);
    gl.uniform3fv(uniforms.u_shadowsTint, wheelTint(params.shadowsHue, params.shadowsAmount));
    gl.uniform3fv(uniforms.u_midtonesTint, wheelTint(params.midtonesHue, params.midtonesAmount));
    gl.uniform3fv(uniforms.u_highlightsTint, wheelTint(params.highlightsHue, params.highlightsAmount));
    const z = (v) => typeof v === "number" ? v / 100 : 0;
    const gz = (v) => typeof v === "number" ? v - 1 : 0;
    gl.uniform4f(uniforms.u_zoneShadows0, z(params.shadowsTemperature), z(params.shadowsTint), z(params.shadowsContrast), z(params.shadowsVibrance));
    gl.uniform4f(uniforms.u_zoneShadows1, z(params.shadowsBrightness), z(params.shadowsSaturation), gz(params.shadowsGamma), 0);
    gl.uniform4f(uniforms.u_zoneMidtones0, z(params.midtonesTemperature), z(params.midtonesTint), z(params.midtonesContrast), z(params.midtonesVibrance));
    gl.uniform4f(uniforms.u_zoneMidtones1, z(params.midtonesBrightness), z(params.midtonesSaturation), gz(params.midtonesGamma), 0);
    gl.uniform4f(uniforms.u_zoneHighlights0, z(params.highlightsTemperature), z(params.highlightsTint), z(params.highlightsContrast), z(params.highlightsVibrance));
    gl.uniform4f(uniforms.u_zoneHighlights1, z(params.highlightsBrightness), z(params.highlightsSaturation), gz(params.highlightsGamma), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  } catch (err) {
    console.warn("[ImageOps] WebGL color-correct draw failed \u2014 falling back to CPU.", err);
    return false;
  }
  try {
    targetCtx.clearRect(0, 0, width, height);
    targetCtx.drawImage(st.canvas, 0, 0);
  } catch (err) {
    console.warn("[ImageOps] WebGL color-correct blit failed \u2014 falling back to CPU.", err);
    return false;
  }
  void releaseCanvas;
  return true;
}
export {
  applyColorCorrectGL,
  isWebGLColorAvailable
};
