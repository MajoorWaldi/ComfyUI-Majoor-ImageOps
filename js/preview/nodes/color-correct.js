import { drawColorWheel, getColorWheelSwatchCss } from "../color.js";
import { clampDrawOpacity } from "../draw.js";
import { styleSoftButton } from "../shared/dom-styles.js";
import { widgetNumber } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsColorAjust";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function syncColorCorrectWidgets(node) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st) return;
  const hue = widgetNumber(node, "hue", 0);
  const saturation = widgetNumber(node, "saturation", 0);
  if (st.colorWheelCanvas) {
    drawColorWheel(st.colorWheelCanvas, hue, saturation);
  }
  if (st.colorHueLabel) {
    st.colorHueLabel.textContent = `Hue ${Math.round(hue)}\xB0`;
  }
  if (st.colorSatLabel) {
    const prefix = saturation > 0 ? "+" : "";
    st.colorSatLabel.textContent = `Sat ${prefix}${Math.round(saturation)}%`;
  }
  if (st.colorSwatch) {
    const tint = getColorWheelSwatchCss(hue, saturation);
    const desat = clampDrawOpacity(1 + saturation / 100, 0);
    st.colorSwatch.style.background = saturation < 0 ? `linear-gradient(135deg, rgba(255,255,255,${0.12 + desat * 0.18}), rgba(255,255,255,0.04))` : `linear-gradient(135deg, ${tint}, rgba(12,12,16,0.22))`;
  }
  if (st.colorResetButton) {
    styleSoftButton(st.colorResetButton, Math.abs(hue) > 0.01 || Math.abs(saturation) > 0.01);
  }
}
export {
  NODE_CLASS,
  isNode,
  syncColorCorrectWidgets
};
