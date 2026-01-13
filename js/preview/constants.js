// Shared numeric constants loader (v1)
// Source-of-truth: ../shared/ops_constants.json (also consumed by Python).

const DEFAULTS = Object.freeze({
  version: 1,
  epsilon: 1e-6,
  luma_weights: [0.2126, 0.7152, 0.0722],
  gamma_safe_min: 0.2,
  gamma_max: 5.0,
  preview_gamma_epsilon: 1e-3,
});

let cached = { ...DEFAULTS };
let initPromise = null;

function toNum(v, fallback) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalize(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const lw = Array.isArray(obj.luma_weights) ? obj.luma_weights : DEFAULTS.luma_weights;
  return {
    version: 1,
    epsilon: toNum(obj.epsilon, DEFAULTS.epsilon),
    luma_weights: [
      toNum(lw[0], DEFAULTS.luma_weights[0]),
      toNum(lw[1], DEFAULTS.luma_weights[1]),
      toNum(lw[2], DEFAULTS.luma_weights[2]),
    ],
    gamma_safe_min: toNum(obj.gamma_safe_min, DEFAULTS.gamma_safe_min),
    gamma_max: toNum(obj.gamma_max, DEFAULTS.gamma_max),
    preview_gamma_epsilon: toNum(obj.preview_gamma_epsilon, DEFAULTS.preview_gamma_epsilon),
  };
}

export function getOpsConstants() {
  return cached;
}

export function initOpsConstants() {
  initPromise ??= (async () => {
    try {
      const url = new URL("../shared/ops_constants.json", import.meta.url);
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) return;
      cached = normalize(await res.json());
    } catch {}
  })();
  return initPromise;
}

