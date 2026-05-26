function styleSoftButton(button, active = false) {
  button.classList.add("comfy-btn");
  if (active) {
    button.classList.add("active");
  } else {
    button.classList.remove("active");
  }
  button.style.border = "1px solid #3f3f3f";
  button.style.background = active ? "#444444" : "#2b2b2b";
  button.style.color = active ? "#ffffff" : "#cccccc";
  button.style.borderRadius = "4px";
  button.style.padding = "4px 8px";
  button.style.cursor = "pointer";
  button.style.fontSize = "11px";
  button.style.lineHeight = "1.2";
}
function styleSoftField(field) {
  field.classList.add("comfy-input");
  field.style.borderRadius = "4px";
  field.style.border = "1px solid #3f3f3f";
  field.style.background = "#1c1c1c";
  field.style.color = "#ffffff";
  field.style.padding = "4px 6px";
  field.style.boxSizing = "border-box";
  field.style.fontSize = "11px";
}
let activeContextMenuCleanup = null;
function closeActiveContextMenu() {
  if (!activeContextMenuCleanup) return;
  const cleanup = activeContextMenuCleanup;
  activeContextMenuCleanup = null;
  cleanup();
}
function syncContextMenuSelect(select) {
  const trigger = select.__imageopsContextMenuTrigger;
  if (!trigger) return;
  const label = trigger.querySelector("span[data-context-menu-label]");
  const currentOption = select.selectedOptions?.[0] ?? select.options?.[select.selectedIndex] ?? null;
  if (label) {
    label.textContent = (currentOption?.textContent ?? select.value ?? "").trim() || "Select";
  }
  trigger.disabled = !!select.disabled;
  trigger.style.opacity = select.disabled ? "0.55" : "1";
  trigger.style.cursor = select.disabled ? "default" : "pointer";
  trigger.title = select.title || (currentOption?.textContent ?? "").trim();
}
function createContextMenuSelect(select) {
  const patched = select;
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.minWidth = "0";
  wrapper.style.width = select.style.width || "auto";
  wrapper.style.flex = select.style.flex || "0 0 auto";
  wrapper.style.flexShrink = select.style.flexShrink || "1";
  styleSoftField(select);
  select.style.display = "block";
  select.style.width = "100%";
  select.style.minWidth = "0";
  select.style.height = "26px";
  select.style.cursor = select.disabled ? "default" : "pointer";
  patched.__imageopsContextMenuSync = () => {
    select.style.opacity = select.disabled ? "0.55" : "1";
    select.style.cursor = select.disabled ? "default" : "pointer";
  };
  select.addEventListener("change", patched.__imageopsContextMenuSync);
  select.addEventListener("input", patched.__imageopsContextMenuSync);
  patched.__imageopsContextMenuSync();
  wrapper.append(select);
  return wrapper;
}
function styleSoftRange(field) {
  field.classList.add("comfy-slider");
  field.style.width = "100%";
  field.style.margin = "0";
  field.style.boxSizing = "border-box";
  field.style.cursor = "pointer";
}
function styleInlineAction(button) {
  button.style.border = "none";
  button.style.background = "transparent";
  button.style.color = "rgba(255,255,255,0.85)";
  button.style.fontSize = "11px";
  button.style.cursor = "pointer";
  button.style.padding = "0";
}
function setControlDisabled(control, disabled) {
  if (!control) return;
  control.disabled = disabled;
  control.style.opacity = disabled ? "0.55" : "1";
  if ("style" in control && control instanceof HTMLButtonElement) {
    control.style.cursor = disabled ? "default" : "pointer";
  }
}
function normalizeHex6(color) {
  const s = (color ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return "#000000";
}
function createColorSwatch(initialColor, options = {}) {
  const compact = options.compact ?? false;
  const hex = normalizeHex6(initialColor);
  const host = document.createElement("div");
  host.classList.add("comfy-swatch");
  host.style.display = "inline-flex";
  host.style.alignItems = "stretch";
  host.style.borderRadius = "4px";
  host.style.border = "1px solid #3f3f3f";
  host.style.overflow = "hidden";
  host.style.cursor = "pointer";
  host.style.height = "28px";
  host.style.boxSizing = "border-box";
  host.style.width = compact ? "34px" : "100%";
  if (options.title) host.title = options.title;
  const colorBlock = document.createElement("div");
  colorBlock.style.flex = compact ? "1" : "0 0 22px";
  colorBlock.style.background = hex;
  if (!compact) colorBlock.style.borderRight = "1px solid #3f3f3f";
  host.appendChild(colorBlock);
  let hexLabel = null;
  if (!compact) {
    hexLabel = document.createElement("div");
    hexLabel.style.flex = "1";
    hexLabel.style.display = "flex";
    hexLabel.style.alignItems = "center";
    hexLabel.style.justifyContent = "center";
    hexLabel.style.fontSize = "10px";
    hexLabel.style.color = "#aaaaaa";
    hexLabel.style.background = "#1c1c1c";
    hexLabel.style.letterSpacing = "0.5px";
    hexLabel.style.fontFamily = "monospace";
    hexLabel.style.userSelect = "none";
    hexLabel.textContent = hex.toUpperCase();
    host.appendChild(hexLabel);
  }
  const input = document.createElement("input");
  input.type = "color";
  input.value = hex;
  input.style.position = "absolute";
  input.style.opacity = "0";
  input.style.width = "0";
  input.style.height = "0";
  input.style.pointerEvents = "none";
  host.appendChild(input);
  host.addEventListener("click", () => input.click());
  const syncUI = (color) => {
    const c = color !== void 0 ? normalizeHex6(color) : input.value;
    if (color !== void 0) input.value = c;
    colorBlock.style.background = c;
    if (hexLabel) hexLabel.textContent = c.toUpperCase();
  };
  input.addEventListener("input", () => syncUI());
  input.__imageopsDarkColorHost = host;
  input.__imageopsDarkColorSync = syncUI;
  return { input, host };
}
function syncDarkColorInputUI(input, color) {
  input?.__imageopsDarkColorSync?.(color);
}
function setDarkColorInputState(input, disabled, hidden = false) {
  const host = input?.__imageopsDarkColorHost;
  if (!host) return;
  host.style.display = hidden ? "none" : "inline-flex";
  host.style.opacity = disabled ? "0.55" : "1";
  host.style.pointerEvents = disabled ? "none" : "auto";
}
export {
  createColorSwatch,
  createContextMenuSelect,
  setControlDisabled,
  setDarkColorInputState,
  styleInlineAction,
  styleSoftButton,
  styleSoftField,
  styleSoftRange,
  syncDarkColorInputUI
};
