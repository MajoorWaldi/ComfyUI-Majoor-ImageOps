import { drawColorWheel, getColorWheelSwatchCss } from "../color.js";
import { clampDrawOpacity } from "../draw.js";
import { styleSoftButton } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetNumber } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsColorAjust";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function hideColorCorrectWidgets(node) {
  const baseNames = [
    "bypass",
    "temperature",
    "tint",
    "hue",
    "brightness",
    "contrast",
    "saturation",
    "vibrance",
    "gamma",
    "shadows_hue",
    "shadows_amount",
    "midtones_hue",
    "midtones_amount",
    "highlights_hue",
    "highlights_amount",
    "invert_mask"
  ];
  const zoneParams = ["temperature", "tint", "contrast", "saturation", "vibrance", "gamma", "brightness"];
  for (const zone of ["shadows", "midtones", "highlights"]) {
    for (const param of zoneParams) baseNames.push(`${zone}_${param}`);
  }
  for (const name of baseNames) {
    hideWidgetForGood(node, findWidget(node, name));
  }
}
function colorWidgetNameForZone(param, zone) {
  if (zone === "global" || zone == null) return param;
  if (param === "hue") return `${zone}_hue`;
  if (param === "saturation") return `${zone}_amount`;
  return `${zone}_${param}`;
}
function colorWidgetDefaultFor(param) {
  return param === "gamma" ? 1 : 0;
}
function syncRange(input, label, value, decimals = 0) {
  if (input) input.value = String(value);
  if (label) label.textContent = decimals > 0 ? value.toFixed(decimals) : `${Math.round(value)}`;
}
function syncColorCorrectWidgets(node) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st) return;
  const zone = st.colorActiveZone ?? "global";
  const readZ = (param) => widgetNumber(node, colorWidgetNameForZone(param, zone), colorWidgetDefaultFor(param));
  const brightness = readZ("brightness");
  const temperature = readZ("temperature");
  const contrast = readZ("contrast");
  const vibrance = readZ("vibrance");
  const gamma = readZ("gamma");
  const hue = readZ("hue");
  const saturation = readZ("saturation");
  syncRange(st.colorBrightnessInput, st.colorBrightnessLabel, brightness);
  syncRange(st.colorTemperatureInput, st.colorTemperatureLabel, temperature);
  syncRange(st.colorTintInput, st.colorTintLabel, hue);
  syncRange(st.colorContrastInput, st.colorContrastLabel, contrast);
  syncRange(st.colorSaturationInput, st.colorSaturationValueLabel, saturation);
  syncRange(st.colorVibranceInput, st.colorVibranceLabel, vibrance);
  syncRange(st.colorGammaInput, st.colorGammaLabel, gamma, 2);
  if (st.colorWheelCanvas) drawColorWheel(st.colorWheelCanvas, hue, Math.max(0, saturation));
  if (st.colorHueLabel) st.colorHueLabel.textContent = `Hue ${Math.round(hue)} deg`;
  if (st.colorSatLabel) st.colorSatLabel.textContent = `Sat ${Math.round(saturation)}%`;
  if (st.colorSwatch) {
    const tintCss = getColorWheelSwatchCss(hue, Math.max(0, saturation));
    const desat = clampDrawOpacity(1 + saturation / 100, 0);
    st.colorSwatch.style.background = saturation < 0 ? `linear-gradient(135deg, rgba(255,255,255,${0.12 + desat * 0.18}), rgba(255,255,255,0.04))` : `linear-gradient(135deg, ${tintCss}, rgba(12,12,16,0.22))`;
  }
  const tabs = [
    [st.colorZoneTabGlobal, "global"],
    [st.colorZoneTabShadows, "shadows"],
    [st.colorZoneTabMidtones, "midtones"],
    [st.colorZoneTabHighlights, "highlights"]
  ];
  for (const [btn, name] of tabs) {
    if (btn) styleSoftButton(btn, name === zone);
  }
  if (st.colorResetButton) {
    const anyZoneNonDefault = (zoneName) => {
      const z = (p) => widgetNumber(node, colorWidgetNameForZone(p, zoneName), colorWidgetDefaultFor(p));
      return Math.abs(z("brightness")) > 0.01 || Math.abs(z("temperature")) > 0.01 || Math.abs(z("hue")) > 0.01 || Math.abs(z("contrast")) > 0.01 || Math.abs(z("saturation")) > 0.01 || Math.abs(z("vibrance")) > 0.01 || Math.abs(z("gamma") - 1) > 0.01;
    };
    styleSoftButton(
      st.colorResetButton,
      anyZoneNonDefault("global") || anyZoneNonDefault("shadows") || anyZoneNonDefault("midtones") || anyZoneNonDefault("highlights")
    );
  }
}
export {
  NODE_CLASS,
  colorWidgetDefaultFor,
  colorWidgetNameForZone,
  hideColorCorrectWidgets,
  isNode,
  syncColorCorrectWidgets
};
