import { drawColorWheel, getColorWheelSwatchCss } from "../color.js";
import { clampDrawOpacity } from "../draw.js";
import { styleSoftButton } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetNumber } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsColorAjust";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function hideColorCorrectWidgets(node) {
  for (const name of [
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
  ]) {
    hideWidgetForGood(node, findWidget(node, name));
  }
}
function syncRange(input, label, value, decimals = 0) {
  if (input) input.value = String(value);
  if (label) label.textContent = decimals > 0 ? value.toFixed(decimals) : `${Math.round(value)}`;
}
function syncColorCorrectWidgets(node) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st) return;
  const hue = widgetNumber(node, "hue", 0);
  const saturation = widgetNumber(node, "saturation", 0);
  const temperature = widgetNumber(node, "temperature", 0);
  const tint = widgetNumber(node, "tint", 0);
  const contrast = widgetNumber(node, "contrast", 0);
  const vibrance = widgetNumber(node, "vibrance", 0);
  const gamma = widgetNumber(node, "gamma", 1);
  const shadowsHue = widgetNumber(node, "shadows_hue", 0);
  const shadowsAmount = widgetNumber(node, "shadows_amount", 0);
  const midtonesHue = widgetNumber(node, "midtones_hue", 0);
  const midtonesAmount = widgetNumber(node, "midtones_amount", 0);
  const highlightsHue = widgetNumber(node, "highlights_hue", 0);
  const highlightsAmount = widgetNumber(node, "highlights_amount", 0);
  syncRange(st.colorTemperatureInput, st.colorTemperatureLabel, temperature);
  syncRange(st.colorTintInput, st.colorTintLabel, tint);
  syncRange(st.colorContrastInput, st.colorContrastLabel, contrast);
  syncRange(st.colorSaturationInput, st.colorSaturationValueLabel, saturation);
  syncRange(st.colorVibranceInput, st.colorVibranceLabel, vibrance);
  syncRange(st.colorGammaInput, st.colorGammaLabel, gamma, 2);
  if (st.colorWheelCanvas) drawColorWheel(st.colorWheelCanvas, hue, Math.max(0, saturation));
  if (st.colorShadowWheelCanvas) drawColorWheel(st.colorShadowWheelCanvas, shadowsHue, shadowsAmount);
  if (st.colorMidtoneWheelCanvas) drawColorWheel(st.colorMidtoneWheelCanvas, midtonesHue, midtonesAmount);
  if (st.colorHighlightWheelCanvas) drawColorWheel(st.colorHighlightWheelCanvas, highlightsHue, highlightsAmount);
  if (st.colorHueLabel) st.colorHueLabel.textContent = `Hue ${Math.round(hue)} deg`;
  if (st.colorSatLabel) st.colorSatLabel.textContent = `Sat ${Math.round(saturation)}%`;
  if (st.colorShadowLabel) st.colorShadowLabel.textContent = `Shadows ${Math.round(shadowsAmount)}%`;
  if (st.colorMidtoneLabel) st.colorMidtoneLabel.textContent = `Midtones ${Math.round(midtonesAmount)}%`;
  if (st.colorHighlightLabel) st.colorHighlightLabel.textContent = `Highlights ${Math.round(highlightsAmount)}%`;
  if (st.colorSwatch) {
    const tintCss = getColorWheelSwatchCss(hue, Math.max(0, saturation));
    const desat = clampDrawOpacity(1 + saturation / 100, 0);
    st.colorSwatch.style.background = saturation < 0 ? `linear-gradient(135deg, rgba(255,255,255,${0.12 + desat * 0.18}), rgba(255,255,255,0.04))` : `linear-gradient(135deg, ${tintCss}, rgba(12,12,16,0.22))`;
  }
  if (st.colorResetButton) {
    styleSoftButton(
      st.colorResetButton,
      Math.abs(temperature) > 0.01 || Math.abs(tint) > 0.01 || Math.abs(hue) > 0.01 || Math.abs(saturation) > 0.01 || Math.abs(contrast) > 0.01 || Math.abs(vibrance) > 0.01 || Math.abs(gamma - 1) > 0.01 || Math.abs(shadowsAmount) > 0.01 || Math.abs(midtonesAmount) > 0.01 || Math.abs(highlightsAmount) > 0.01
    );
  }
}
export {
  NODE_CLASS,
  hideColorCorrectWidgets,
  isNode,
  syncColorCorrectWidgets
};
