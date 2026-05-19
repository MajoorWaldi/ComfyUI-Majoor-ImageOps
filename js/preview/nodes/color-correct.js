import { drawColorWheel, getColorWheelSwatchCss } from "../color.js";
import { clampDrawOpacity } from "../draw.js";
import { styleSoftButton, styleSoftRange } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetNumber } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsColorAjust";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createColorCorrectControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gridTemplateColumns = "minmax(0,1fr)";
  controls.style.gap = "10px";
  controls.style.alignItems = "stretch";
  const wheelCanvas = document.createElement("canvas");
  wheelCanvas.width = 152;
  wheelCanvas.height = 152;
  wheelCanvas.style.width = "100%";
  wheelCanvas.style.aspectRatio = "1";
  wheelCanvas.style.borderRadius = "999px";
  wheelCanvas.style.cursor = "crosshair";
  wheelCanvas.style.background = "radial-gradient(circle at center, rgba(255,255,255,0.08), rgba(255,255,255,0.02) 55%, rgba(0,0,0,0.18) 100%)";
  wheelCanvas.style.border = "1px solid rgba(255,255,255,0.1)";
  wheelCanvas.style.boxSizing = "border-box";
  const colorMeta = document.createElement("div");
  colorMeta.style.display = "grid";
  colorMeta.style.gap = "6px";
  colorMeta.style.alignContent = "start";
  const colorTitle = document.createElement("div");
  colorTitle.textContent = "Color wheel";
  colorTitle.style.fontSize = "12px";
  colorTitle.style.fontWeight = "600";
  colorTitle.style.letterSpacing = "0.02em";
  const colorHint = document.createElement("div");
  colorHint.textContent = "Drag for hue and chroma. Use the saturation slider below for desat or negative fine tuning.";
  colorHint.style.fontSize = "11px";
  colorHint.style.opacity = "0.72";
  colorHint.style.lineHeight = "1.35";
  const swatch = document.createElement("div");
  swatch.style.height = "34px";
  swatch.style.borderRadius = "10px";
  swatch.style.border = "1px solid rgba(255,255,255,0.12)";
  swatch.style.background = "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.02))";
  const readoutRow = document.createElement("div");
  readoutRow.style.display = "grid";
  readoutRow.style.gridTemplateColumns = "minmax(0,1fr) minmax(0,1fr)";
  readoutRow.style.gap = "6px";
  const hueLabel = document.createElement("div");
  hueLabel.style.fontSize = "11px";
  hueLabel.style.opacity = "0.86";
  hueLabel.textContent = "Hue 0 deg";
  const satLabel = document.createElement("div");
  satLabel.style.fontSize = "11px";
  satLabel.style.opacity = "0.86";
  satLabel.style.textAlign = "right";
  satLabel.textContent = "Sat 0%";
  readoutRow.appendChild(hueLabel);
  readoutRow.appendChild(satLabel);
  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.textContent = "Reset";
  styleSoftButton(resetButton, false);
  resetButton.style.justifySelf = "start";
  colorMeta.appendChild(colorTitle);
  colorMeta.appendChild(colorHint);
  colorMeta.appendChild(swatch);
  colorMeta.appendChild(readoutRow);
  colorMeta.appendChild(resetButton);
  const globalWheelRow = document.createElement("div");
  globalWheelRow.style.display = "grid";
  globalWheelRow.style.gridTemplateColumns = "minmax(132px, 152px) minmax(0,1fr)";
  globalWheelRow.style.gap = "10px";
  globalWheelRow.style.alignItems = "stretch";
  globalWheelRow.appendChild(wheelCanvas);
  globalWheelRow.appendChild(colorMeta);
  controls.appendChild(globalWheelRow);
  const makeRangeRow = (labelText, input, valueLabel, min, max, step, value, accent) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "68px minmax(0,1fr) 40px";
    row.style.gap = "8px";
    row.style.alignItems = "center";
    const label = document.createElement("div");
    label.textContent = labelText;
    label.style.fontSize = "11px";
    label.style.opacity = "0.8";
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    styleSoftRange(input);
    if (accent) input.style.accentColor = accent;
    valueLabel.style.fontSize = "11px";
    valueLabel.style.opacity = "0.84";
    valueLabel.style.textAlign = "right";
    valueLabel.textContent = String(value);
    row.appendChild(label);
    row.appendChild(input);
    row.appendChild(valueLabel);
    return row;
  };
  const primariesCard = document.createElement("div");
  primariesCard.style.display = "grid";
  primariesCard.style.gap = "8px";
  const primariesTop = document.createElement("div");
  primariesTop.style.display = "flex";
  primariesTop.style.alignItems = "center";
  primariesTop.style.justifyContent = "space-between";
  primariesTop.style.gap = "8px";
  const primariesTitle = document.createElement("div");
  primariesTitle.textContent = "Primaries";
  primariesTitle.style.fontSize = "12px";
  primariesTitle.style.fontWeight = "600";
  primariesTitle.style.letterSpacing = "0.02em";
  primariesTop.appendChild(primariesTitle);
  primariesTop.appendChild(resetButton);
  primariesCard.appendChild(primariesTop);
  const zoneTabsRow = document.createElement("div");
  zoneTabsRow.style.display = "grid";
  zoneTabsRow.style.gridTemplateColumns = "repeat(4, 1fr)";
  zoneTabsRow.style.gap = "4px";
  const makeZoneTab = (label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.fontSize = "11px";
    button.style.padding = "4px 6px";
    styleSoftButton(button, false);
    return button;
  };
  const zoneTabGlobal = makeZoneTab("Global");
  const zoneTabShadows = makeZoneTab("Shadows");
  const zoneTabMidtones = makeZoneTab("Midtones");
  const zoneTabHighlights = makeZoneTab("Highlights");
  zoneTabsRow.appendChild(zoneTabGlobal);
  zoneTabsRow.appendChild(zoneTabShadows);
  zoneTabsRow.appendChild(zoneTabMidtones);
  zoneTabsRow.appendChild(zoneTabHighlights);
  primariesCard.appendChild(zoneTabsRow);
  const brightnessInput = document.createElement("input");
  const brightnessLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Bright", brightnessInput, brightnessLabel, -100, 100, 1, 0, ""));
  const temperatureInput = document.createElement("input");
  const temperatureLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Temp", temperatureInput, temperatureLabel, -100, 100, 1, 0, "#ffb347"));
  const tintInput = document.createElement("input");
  const tintLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Hue", tintInput, tintLabel, -180, 180, 1, 0, "#d77dff"));
  const contrastInput = document.createElement("input");
  const contrastLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Contrast", contrastInput, contrastLabel, -100, 100, 1, 0, ""));
  const saturationInput = document.createElement("input");
  const saturationValueLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Sat", saturationInput, saturationValueLabel, -100, 100, 1, 0, ""));
  const vibranceInput = document.createElement("input");
  const vibranceLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Vibrance", vibranceInput, vibranceLabel, -100, 100, 1, 0, ""));
  const gammaInput = document.createElement("input");
  const gammaLabel = document.createElement("div");
  primariesCard.appendChild(makeRangeRow("Gamma", gammaInput, gammaLabel, 0.2, 2.2, 0.01, 1, ""));
  controls.appendChild(primariesCard);
  return {
    controls,
    wheelCanvas,
    hueLabel,
    satLabel,
    swatch,
    resetButton,
    temperatureInput,
    temperatureLabel,
    tintInput,
    tintLabel,
    contrastInput,
    contrastLabel,
    saturationInput,
    saturationValueLabel,
    vibranceInput,
    vibranceLabel,
    gammaInput,
    gammaLabel,
    shadowWheelCanvas: null,
    shadowLabel: null,
    midtoneWheelCanvas: null,
    midtoneLabel: null,
    highlightWheelCanvas: null,
    highlightLabel: null,
    brightnessInput,
    brightnessLabel,
    zoneTabsRow,
    zoneTabGlobal,
    zoneTabShadows,
    zoneTabMidtones,
    zoneTabHighlights
  };
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
  createColorCorrectControlsUi,
  hideColorCorrectWidgets,
  isNode,
  syncColorCorrectWidgets
};
