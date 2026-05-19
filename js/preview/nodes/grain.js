import { createContextMenuSelect, styleSoftButton, styleSoftField, styleSoftRange } from "../shared/dom-styles.js";
import { ensureState } from "../shared/state.js";
import { findWidget, hideWidgetForGood, widgetBoolean, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsGrain";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createGrainControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "8px";
  const makeRow = () => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    row.style.minWidth = "0";
    return row;
  };
  const makeLabel = (text) => {
    const label = document.createElement("div");
    label.textContent = text;
    label.style.fontSize = "11px";
    label.style.opacity = "0.78";
    return label;
  };
  const topRow = makeRow();
  topRow.style.gridTemplateColumns = "auto minmax(0,1fr)";
  topRow.appendChild(makeLabel("Blend"));
  const blendSelect = document.createElement("select");
  blendSelect.dataset.grainSelect = "blend_mode";
  blendSelect.title = "Grain blend mode";
  blendSelect.style.width = "100%";
  blendSelect.style.minWidth = "0";
  styleSoftField(blendSelect);
  for (const [value, label] of [["add", "Add"], ["overlay", "Overlay"], ["soft_light", "Soft Light"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    blendSelect.appendChild(option);
  }
  topRow.appendChild(createContextMenuSelect(blendSelect));
  controls.appendChild(topRow);
  const amountRow = makeRow();
  amountRow.style.gridTemplateColumns = "auto minmax(0,1fr) auto";
  amountRow.appendChild(makeLabel("Amount"));
  const amountInput = document.createElement("input");
  amountInput.type = "range";
  amountInput.dataset.grainField = "amount";
  amountInput.min = "0";
  amountInput.max = "100";
  amountInput.step = "1";
  amountInput.value = "8";
  amountInput.title = "Grain amount";
  styleSoftRange(amountInput);
  amountRow.appendChild(amountInput);
  const amountLabel = document.createElement("div");
  amountLabel.dataset.grainAmountLabel = "1";
  amountLabel.textContent = "8%";
  amountLabel.style.fontSize = "11px";
  amountLabel.style.opacity = "0.84";
  amountLabel.style.textAlign = "right";
  amountRow.appendChild(amountLabel);
  controls.appendChild(amountRow);
  const actionsRow = makeRow();
  actionsRow.style.display = "flex";
  actionsRow.style.flexWrap = "wrap";
  actionsRow.style.gap = "6px";
  const monoButton = document.createElement("button");
  monoButton.type = "button";
  monoButton.dataset.grainToggle = "monochrome";
  monoButton.textContent = "Mono on";
  styleSoftButton(monoButton, true);
  actionsRow.appendChild(monoButton);
  const animatedButton = document.createElement("button");
  animatedButton.type = "button";
  animatedButton.dataset.grainToggle = "animated";
  animatedButton.textContent = "Animated on";
  styleSoftButton(animatedButton, true);
  actionsRow.appendChild(animatedButton);
  const invertButton = document.createElement("button");
  invertButton.type = "button";
  invertButton.dataset.grainToggle = "invert_mask";
  invertButton.textContent = "Invert mask off";
  styleSoftButton(invertButton, false);
  actionsRow.appendChild(invertButton);
  const bypassButton = document.createElement("button");
  bypassButton.type = "button";
  bypassButton.dataset.grainToggle = "bypass";
  bypassButton.textContent = "Bypass off";
  styleSoftButton(bypassButton, false);
  actionsRow.appendChild(bypassButton);
  controls.appendChild(actionsRow);
  const presetsRow = document.createElement("div");
  presetsRow.style.cssText = "display:flex;gap:4px;flex-wrap:wrap";
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
    btn.style.cssText = "background:#2a2a2a;color:#ddd;border:1px solid #444;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:11px";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      amountInput.value = String(Math.round(preset.amount * 100));
      try {
        amountInput.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {
      }
      try {
        amountInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
      }
      blendSelect.value = preset.blend;
      try {
        blendSelect.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
      }
      const monoOn = monoButton.textContent?.trim().toLowerCase() === "mono on";
      if (monoOn !== preset.mono) {
        try {
          monoButton.click();
        } catch {
        }
      }
    });
    presetsRow.appendChild(btn);
  }
  controls.appendChild(presetsRow);
  return { controls };
}
const GRAIN_BLEND_MODES = /* @__PURE__ */ new Set(["add", "overlay", "soft_light"]);
function hideGrainWidgets(node) {
  for (const name of ["bypass", "amount", "blend_mode", "monochrome", "animated", "invert_mask"]) {
    hideWidgetForGood(node, findWidget(node, name));
  }
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
  const st = ensureState(node);
  const root = st.previewRoot;
  if (!root) return;
  const amount = Math.max(0, Math.min(1, widgetNumber(node, "amount", 0.08)));
  const blendModeRaw = widgetString(node, "blend_mode", "add");
  const blendMode = GRAIN_BLEND_MODES.has(blendModeRaw) ? blendModeRaw : "add";
  const monochrome = widgetBoolean(node, "monochrome", true);
  const animated = widgetBoolean(node, "animated", true);
  const invertMask = widgetBoolean(node, "invert_mask", false);
  const bypass = widgetBoolean(node, "bypass", false);
  const amountInput = root.querySelector('input[data-grain-field="amount"]');
  if (amountInput) amountInput.value = String(Math.round(amount * 100));
  const amountLabel = root.querySelector("[data-grain-amount-label]");
  if (amountLabel) amountLabel.textContent = `${Math.round(amount * 100)}%`;
  const blendSelect = root.querySelector('select[data-grain-select="blend_mode"]');
  if (blendSelect) blendSelect.value = blendMode;
  const monoButton = root.querySelector('button[data-grain-toggle="monochrome"]');
  if (monoButton) {
    monoButton.textContent = monochrome ? "Mono on" : "Mono off";
    styleSoftButton(monoButton, monochrome);
  }
  const animatedButton = root.querySelector('button[data-grain-toggle="animated"]');
  if (animatedButton) {
    animatedButton.textContent = animated ? "Animated on" : "Animated off";
    styleSoftButton(animatedButton, animated);
  }
  const invertButton = root.querySelector('button[data-grain-toggle="invert_mask"]');
  if (invertButton) {
    invertButton.textContent = invertMask ? "Invert mask on" : "Invert mask off";
    styleSoftButton(invertButton, invertMask);
  }
  const bypassButton = root.querySelector('button[data-grain-toggle="bypass"]');
  if (bypassButton) {
    bypassButton.textContent = bypass ? "Bypass on" : "Bypass off";
    styleSoftButton(bypassButton, bypass);
  }
}
export {
  NODE_CLASS,
  createGrainControlsUi,
  getGrainInfoText,
  hideGrainWidgets,
  isNode,
  syncGrainWidgets
};
