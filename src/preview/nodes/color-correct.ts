import type { ComfyNode } from "../../types.js";
import { drawColorWheel, getColorWheelSwatchCss } from "../color.js";
import { clampDrawOpacity } from "../draw.js";
import { styleSoftButton } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, widgetNumber } from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsColorAjust";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

export function hideColorCorrectWidgets(node: ComfyNode): void {
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
    "invert_mask",
  ];
  const zoneParams = ["temperature", "tint", "contrast", "saturation", "vibrance", "gamma", "brightness"];
  for (const zone of ["shadows", "midtones", "highlights"]) {
    for (const param of zoneParams) baseNames.push(`${zone}_${param}`);
  }
  for (const name of baseNames) {
    hideWidgetForGood(node, findWidget(node, name));
  }
}

// Resolve the actual widget name to read/write for a primary slider given the
// currently-active zone tab. Global tab maps to the original widget names; the
// other tabs map to `<zone>_<param>`. The Hue slider + main colour wheel are
// zone-aware too: in a zone tab they write to `<zone>_hue` (already a backend
// widget driven by the legacy 3-way colour wheels). The Sat slider follows the
// wheel-amount convention and maps to `<zone>_amount` for non-global zones.
export function colorWidgetNameForZone(param: string, zone: string): string {
  if (zone === "global" || zone == null) return param;
  if (param === "hue") return `${zone}_hue`;
  if (param === "saturation") return `${zone}_amount`;
  return `${zone}_${param}`;
}

// Default value for a primary slider — matches the backend defaults so
// "no-op" tabs always show 0 (or 1 for gamma).
export function colorWidgetDefaultFor(param: string): number {
  return param === "gamma" ? 1 : 0;
}

function syncRange(input: HTMLInputElement | null, label: HTMLDivElement | null, value: number, decimals: number = 0): void {
  if (input) input.value = String(value);
  if (label) label.textContent = decimals > 0 ? value.toFixed(decimals) : `${Math.round(value)}`;
}

export function syncColorCorrectWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st) return;

  const zone = st.colorActiveZone ?? "global";

  // Primary sliders read the widget for the active zone (`global` keeps the
  // original names; other zones use `<zone>_<param>` \u2014 with `hue` mapping to
  // `<zone>_hue` and `saturation` mapping to `<zone>_amount`).
  const readZ = (param: string): number => widgetNumber(node, colorWidgetNameForZone(param, zone), colorWidgetDefaultFor(param));
  const brightness = readZ("brightness");
  const temperature = readZ("temperature");
  const contrast = readZ("contrast");
  const vibrance = readZ("vibrance");
  const gamma = readZ("gamma");
  // Hue + Sat drive the big wheel and reflect the active zone.
  const hue = readZ("hue");
  const saturation = readZ("saturation");

  syncRange(st.colorBrightnessInput, st.colorBrightnessLabel, brightness);
  syncRange(st.colorTemperatureInput, st.colorTemperatureLabel, temperature);
  // The "Tint" slot in DOM was repurposed as the Hue slider.
  syncRange(st.colorTintInput, st.colorTintLabel, hue);
  syncRange(st.colorContrastInput, st.colorContrastLabel, contrast);
  syncRange(st.colorSaturationInput, st.colorSaturationValueLabel, saturation);
  syncRange(st.colorVibranceInput, st.colorVibranceLabel, vibrance);
  syncRange(st.colorGammaInput, st.colorGammaLabel, gamma, 2);

  // Big wheel reflects the ACTIVE zone's hue / amount.
  if (st.colorWheelCanvas) drawColorWheel(st.colorWheelCanvas, hue, Math.max(0, saturation));

  if (st.colorHueLabel) st.colorHueLabel.textContent = `Hue ${Math.round(hue)} deg`;
  if (st.colorSatLabel) st.colorSatLabel.textContent = `Sat ${Math.round(saturation)}%`;

  if (st.colorSwatch) {
    const tintCss = getColorWheelSwatchCss(hue, Math.max(0, saturation));
    const desat = clampDrawOpacity(1 + saturation / 100, 0);
    st.colorSwatch.style.background = saturation < 0
      ? `linear-gradient(135deg, rgba(255,255,255,${0.12 + desat * 0.18}), rgba(255,255,255,0.04))`
      : `linear-gradient(135deg, ${tintCss}, rgba(12,12,16,0.22))`;
  }

  // Highlight the active zone tab. Using the existing styleSoftButton(active)
  // toggle keeps the look consistent with the rest of the UI.
  const tabs: Array<[HTMLButtonElement | null, string]> = [
    [st.colorZoneTabGlobal, "global"],
    [st.colorZoneTabShadows, "shadows"],
    [st.colorZoneTabMidtones, "midtones"],
    [st.colorZoneTabHighlights, "highlights"],
  ];
  for (const [btn, name] of tabs) {
    if (btn) styleSoftButton(btn, name === zone);
  }

  if (st.colorResetButton) {
    // Reset button highlights when ANY value (global or zone) is non-default.
    const anyZoneNonDefault = (zoneName: string): boolean => {
      const z = (p: string): number => widgetNumber(node, colorWidgetNameForZone(p, zoneName), colorWidgetDefaultFor(p));
      return Math.abs(z("brightness")) > 0.01
        || Math.abs(z("temperature")) > 0.01
        || Math.abs(z("hue")) > 0.01
        || Math.abs(z("contrast")) > 0.01
        || Math.abs(z("saturation")) > 0.01
        || Math.abs(z("vibrance")) > 0.01
        || Math.abs(z("gamma") - 1.0) > 0.01;
    };
    styleSoftButton(
      st.colorResetButton,
      anyZoneNonDefault("global")
      || anyZoneNonDefault("shadows")
      || anyZoneNonDefault("midtones")
      || anyZoneNonDefault("highlights"),
    );
  }
}

