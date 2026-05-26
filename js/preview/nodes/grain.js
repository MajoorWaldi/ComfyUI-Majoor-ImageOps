import { findWidget, setWidgetValue, setWidgetStringValue, setWidgetBooleanValue, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsGrain";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createGrainControlsUi(node) {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "flex";
  controls.style.flexDirection = "column";
  controls.style.gap = "6px";
  controls.style.width = "100%";
  const label = document.createElement("div");
  label.textContent = "Presets";
  label.style.fontSize = "11px";
  label.style.opacity = "0.78";
  label.style.fontFamily = "var(--comfy-font-sans, Inter, sans-serif)";
  controls.appendChild(label);
  const presetsRow = document.createElement("div");
  presetsRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;width:100%";
  const presets = [
    { label: "Clean", amount: 0.02, blend: "add", mono: false },
    { label: "Subtle", amount: 0.06, blend: "overlay", mono: false },
    { label: "Cinema", amount: 0.12, blend: "soft_light", mono: false },
    { label: "B&W", amount: 0.18, blend: "overlay", mono: true },
    { label: "Heavy", amount: 0.35, blend: "soft_light", mono: false }
  ];
  for (const preset of presets) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = preset.label;
    btn.title = `Preset: amount ${Math.round(preset.amount * 100)}%, ${preset.blend}, ${preset.mono ? "mono" : "rgb"}`;
    btn.style.cssText = "background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px;transition:background 0.15s";
    btn.addEventListener("mouseenter", () => {
      btn.style.background = "#3a3a3a";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.background = "#2a2a2a";
    });
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setWidgetValue(findWidget(node, "amount"), preset.amount);
      setWidgetStringValue(findWidget(node, "blend_mode"), preset.blend);
      setWidgetBooleanValue(findWidget(node, "monochrome"), preset.mono);
      node.graph?.setDirtyCanvas?.(true, true);
    });
    presetsRow.appendChild(btn);
  }
  controls.appendChild(presetsRow);
  return { controls };
}
const GRAIN_BLEND_MODES = /* @__PURE__ */ new Set(["add", "overlay", "soft_light"]);
function hideGrainWidgets(node) {
  if (!isNode(node)) return;
}
function getGrainInfoText(node) {
  const amount = Math.round(Math.max(0, Math.min(1, widgetNumber(node, "amount", 0.08))) * 100);
  const blendMode = widgetString(node, "blend_mode", "add").replace(/_/g, " ");
  const monochrome = widgetBoolean(node, "monochrome", true) ? "mono" : "rgb";
  const animated = widgetBoolean(node, "animated", true) ? "animated" : "static";
  const frames = Math.max(1, Math.round(widgetNumber(node, "frame_length", 1)));
  const bypass = widgetBoolean(node, "bypass", false) ? ", bypass" : "";
  return `Grain preview (${blendMode}, ${amount}%, ${monochrome}, ${animated}, ${frames}f${bypass})`;
}
function syncGrainWidgets(node) {
  if (!isNode(node)) return;
  hideGrainWidgets(node);
}
export {
  NODE_CLASS,
  createGrainControlsUi,
  getGrainInfoText,
  hideGrainWidgets,
  isNode,
  syncGrainWidgets
};
