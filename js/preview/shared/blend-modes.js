function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
function softLightD(value) {
  return value <= 0.25 ? ((16 * value - 12) * value + 4) * value : Math.sqrt(value);
}
function colorDodge01(base, top) {
  return top >= 1 - 1e-6 ? 1 : clamp01(base / Math.max(1e-6, 1 - top));
}
function colorBurn01(base, top) {
  return top <= 1e-6 ? 0 : clamp01(1 - (1 - base) / Math.max(1e-6, top));
}
function blendChannel01(base, top, mode) {
  if (mode === "over") return top;
  if (mode === "add") return clamp01(base + top);
  if (mode === "subtract") return clamp01(base - top);
  if (mode === "multiply") return base * top;
  if (mode === "screen") return 1 - (1 - base) * (1 - top);
  if (mode === "overlay") return base <= 0.5 ? 2 * base * top : 1 - 2 * (1 - base) * (1 - top);
  if (mode === "soft_light" || mode === "soft-light") {
    return top <= 0.5 ? base - (1 - 2 * top) * base * (1 - base) : base + (2 * top - 1) * (softLightD(base) - base);
  }
  if (mode === "difference") return Math.abs(base - top);
  if (mode === "lighten" || mode === "max") return Math.max(base, top);
  if (mode === "darken" || mode === "min") return Math.min(base, top);
  if (mode === "color_dodge") return colorDodge01(base, top);
  if (mode === "color_burn") return colorBurn01(base, top);
  if (mode === "exclusion") return base + top - 2 * base * top;
  if (mode === "vivid_light") return top <= 0.5 ? colorBurn01(base, top * 2) : colorDodge01(base, top * 2 - 1);
  if (mode === "pin_light") return top <= 0.5 ? Math.min(base, top * 2) : Math.max(base, top * 2 - 1);
  if (mode === "hard_mix") return blendChannel01(base, top, "vivid_light") < 0.5 ? 0 : 1;
  return top;
}
export {
  blendChannel01
};
