export function styleSoftButton(button: HTMLButtonElement, active: boolean = false): void {
  button.style.border = "1px solid rgba(255,255,255,0.12)";
  button.style.background = active ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.04)";
  button.style.color = "rgba(255,255,255,0.94)";
  button.style.borderRadius = "6px";
  button.style.padding = "4px 8px";
  button.style.cursor = "pointer";
  button.style.fontSize = "11px";
  button.style.lineHeight = "1.2";
}

export function styleSoftField(field: HTMLInputElement | HTMLSelectElement): void {
  field.style.borderRadius = "6px";
  field.style.border = "1px solid rgba(255,255,255,0.12)";
  field.style.background = "rgba(0,0,0,0.28)";
  field.style.color = "rgba(255,255,255,0.95)";
  field.style.padding = "4px 6px";
  field.style.boxSizing = "border-box";
  field.style.fontSize = "11px";
}

export function styleSoftRange(field: HTMLInputElement): void {
  field.style.width = "100%";
  field.style.margin = "0";
  field.style.boxSizing = "border-box";
  field.style.cursor = "pointer";
}

export function styleInlineAction(button: HTMLButtonElement): void {
  button.style.border = "none";
  button.style.background = "transparent";
  button.style.color = "rgba(255,255,255,0.85)";
  button.style.fontSize = "11px";
  button.style.cursor = "pointer";
  button.style.padding = "0";
}

export function setControlDisabled(
  control: HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null,
  disabled: boolean,
): void {
  if (!control) return;
  control.disabled = disabled;
  control.style.opacity = disabled ? "0.55" : "1";
  if ("style" in control && control instanceof HTMLButtonElement) {
    control.style.cursor = disabled ? "default" : "pointer";
  }
}

// ── Color swatch — ComfyUI-style colour picker ──────────────────────────────

function normalizeHex6(color: string): string {
  const s = (color ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return "#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  return "#000000";
}

/**
 * Creates a ComfyUI-style colour swatch.
 * Returns the hidden `<input type="color">` (storable in NodeState) and the
 * visible host element (to append to the DOM).
 *
 * compact=true → coloured block only (no hex label), host width 34 px.
 * compact=false (default) → coloured block + hex label, host width 100%.
 */
export function createColorSwatch(
  initialColor: string,
  options: { compact?: boolean; title?: string } = {},
): { input: HTMLInputElement; host: HTMLElement } {
  const compact = options.compact ?? false;
  const hex = normalizeHex6(initialColor);

  const host = document.createElement("div");
  host.style.display = "inline-flex";
  host.style.alignItems = "stretch";
  host.style.borderRadius = "6px";
  host.style.border = "1px solid rgba(255,255,255,0.12)";
  host.style.overflow = "hidden";
  host.style.cursor = "pointer";
  host.style.height = "28px";
  host.style.boxSizing = "border-box";
  host.style.width = compact ? "34px" : "100%";
  if (options.title) host.title = options.title;

  const colorBlock = document.createElement("div");
  colorBlock.style.flex = compact ? "1" : "0 0 22px";
  colorBlock.style.background = hex;
  if (!compact) colorBlock.style.borderRight = "1px solid rgba(255,255,255,0.12)";
  host.appendChild(colorBlock);

  let hexLabel: HTMLDivElement | null = null;
  if (!compact) {
    hexLabel = document.createElement("div");
    hexLabel.style.flex = "1";
    hexLabel.style.display = "flex";
    hexLabel.style.alignItems = "center";
    hexLabel.style.justifyContent = "center";
    hexLabel.style.fontSize = "10px";
    hexLabel.style.color = "rgba(255,255,255,0.65)";
    hexLabel.style.background = "rgba(0,0,0,0.28)";
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

  const syncUI = (color?: string): void => {
    const c = color !== undefined ? normalizeHex6(color) : input.value;
    if (color !== undefined) input.value = c;
    colorBlock.style.background = c;
    if (hexLabel) hexLabel.textContent = c.toUpperCase();
  };

  input.addEventListener("input", () => syncUI());

  (input as any).__imageopsDarkColorHost = host;
  (input as any).__imageopsDarkColorSync = syncUI;

  return { input, host };
}

/** Syncs the colour swatch visual to the given colour (or re-reads input.value). */
export function syncDarkColorInputUI(input: HTMLInputElement | null, color?: string): void {
  (input as any)?.__imageopsDarkColorSync?.(color);
}

/** Shows/hides and enables/disables a colour swatch host element. */
export function setDarkColorInputState(input: HTMLInputElement | null, disabled: boolean, hidden = false): void {
  const host = (input as any)?.__imageopsDarkColorHost as HTMLElement | undefined;
  if (!host) return;
  host.style.display = hidden ? "none" : "inline-flex";
  host.style.opacity = disabled ? "0.55" : "1";
  host.style.pointerEvents = disabled ? "none" : "auto";
}
