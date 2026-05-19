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

export function styleSoftField(field: HTMLElement): void {
  field.style.borderRadius = "6px";
  field.style.border = "1px solid rgba(255,255,255,0.12)";
  field.style.background = "rgba(0,0,0,0.28)";
  field.style.color = "rgba(255,255,255,0.95)";
  field.style.padding = "4px 6px";
  field.style.boxSizing = "border-box";
  field.style.fontSize = "11px";
}

let activeContextMenuCleanup: (() => void) | null = null;

function closeActiveContextMenu(): void {
  if (!activeContextMenuCleanup) return;
  const cleanup = activeContextMenuCleanup;
  activeContextMenuCleanup = null;
  cleanup();
}

type PatchedSelect = HTMLSelectElement & {
  __imageopsContextMenuSync?: () => void;
  __imageopsContextMenuTrigger?: HTMLButtonElement;
  __imageopsContextMenuPatched?: boolean;
};

function syncContextMenuSelect(select: PatchedSelect): void {
  const trigger = select.__imageopsContextMenuTrigger;
  if (!trigger) return;
  const label = trigger.querySelector<HTMLSpanElement>("span[data-context-menu-label]");
  const currentOption = select.selectedOptions?.[0] ?? select.options?.[select.selectedIndex] ?? null;
  if (label) {
    label.textContent = (currentOption?.textContent ?? select.value ?? "").trim() || "Select";
  }
  trigger.disabled = !!select.disabled;
  trigger.style.opacity = select.disabled ? "0.55" : "1";
  trigger.style.cursor = select.disabled ? "default" : "pointer";
  trigger.title = select.title || (currentOption?.textContent ?? "").trim();
}

export function createContextMenuSelect(select: HTMLSelectElement): HTMLDivElement {
  const patched = select as PatchedSelect;
  const wrapper = document.createElement("div");
  wrapper.style.position = "relative";
  wrapper.style.minWidth = "0";
  wrapper.style.width = select.style.width || "auto";
  wrapper.style.flex = select.style.flex || "0 0 auto";
  wrapper.style.flexShrink = select.style.flexShrink || "1";

  select.style.display = "none";

  const trigger = document.createElement("button");
  trigger.type = "button";
  styleSoftField(trigger);
  trigger.style.width = "100%";
  trigger.style.display = "flex";
  trigger.style.alignItems = "center";
  trigger.style.justifyContent = "space-between";
  trigger.style.gap = "8px";
  trigger.style.cursor = "pointer";
  trigger.style.textAlign = "left";

  const label = document.createElement("span");
  label.dataset.contextMenuLabel = "1";
  label.style.flex = "1 1 auto";
  label.style.minWidth = "0";
  label.style.overflow = "hidden";
  label.style.textOverflow = "ellipsis";
  label.style.whiteSpace = "nowrap";

  const caret = document.createElement("span");
  caret.textContent = "▼";
  caret.style.fontSize = "9px";
  caret.style.opacity = "0.7";
  caret.style.flexShrink = "0";

  trigger.append(label, caret);
  wrapper.append(select, trigger);

  patched.__imageopsContextMenuTrigger = trigger;
  patched.__imageopsContextMenuSync = () => syncContextMenuSelect(patched);

  if (!patched.__imageopsContextMenuPatched) {
    patched.__imageopsContextMenuPatched = true;

    const valueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    if (valueDescriptor?.get && valueDescriptor?.set) {
      Object.defineProperty(select, "value", {
        configurable: true,
        enumerable: true,
        get() {
          return valueDescriptor.get?.call(select);
        },
        set(value: string) {
          valueDescriptor.set?.call(select, value);
          syncContextMenuSelect(patched);
        },
      });
    }

    const disabledDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "disabled");
    if (disabledDescriptor?.get && disabledDescriptor?.set) {
      Object.defineProperty(select, "disabled", {
        configurable: true,
        enumerable: true,
        get() {
          return !!disabledDescriptor.get?.call(select);
        },
        set(value: boolean) {
          disabledDescriptor.set?.call(select, value);
          syncContextMenuSelect(patched);
        },
      });
    }
  }

  const openMenu = (): void => {
    if (select.disabled) return;
    closeActiveContextMenu();

    const menu = document.createElement("div");
    menu.style.position = "fixed";
    menu.style.zIndex = "999999";
    menu.style.minWidth = `${Math.max(120, Math.round(trigger.getBoundingClientRect().width))}px`;
    menu.style.maxWidth = "280px";
    menu.style.maxHeight = "320px";
    menu.style.overflowY = "auto";
    menu.style.padding = "4px";
    menu.style.border = "1px solid rgba(255,255,255,0.14)";
    menu.style.borderRadius = "8px";
    menu.style.background = "rgba(18,18,20,0.98)";
    menu.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
    menu.style.backdropFilter = "blur(10px)";

    const triggerRect = trigger.getBoundingClientRect();
    const placeMenu = (): void => {
      const estimatedHeight = Math.min(320, Math.max(36, select.options.length * 28 + 8));
      const belowTop = triggerRect.bottom + 6;
      const aboveTop = Math.max(8, triggerRect.top - estimatedHeight - 6);
      menu.style.left = `${Math.max(8, triggerRect.left)}px`;
      menu.style.top = `${belowTop + estimatedHeight <= window.innerHeight ? belowTop : aboveTop}px`;
    };
    placeMenu();

    const choose = (value: string): void => {
      const nativeValueDescriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
      nativeValueDescriptor?.set?.call(select, value);
      syncContextMenuSelect(patched);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeActiveContextMenu();
    };

    for (const option of Array.from(select.options)) {
      const item = document.createElement("button");
      item.type = "button";
      item.textContent = option.textContent ?? option.value;
      item.disabled = option.disabled;
      item.style.display = "block";
      item.style.width = "100%";
      item.style.border = "none";
      item.style.borderRadius = "6px";
      item.style.padding = "6px 8px";
      item.style.margin = "0";
      item.style.textAlign = "left";
      item.style.fontSize = "11px";
      item.style.color = "rgba(255,255,255,0.95)";
      item.style.background = option.value === select.value ? "rgba(255,255,255,0.14)" : "transparent";
      item.style.cursor = option.disabled ? "default" : "pointer";
      item.style.opacity = option.disabled ? "0.45" : "1";
      item.addEventListener("click", (event) => {
        event.preventDefault();
        if (option.disabled) return;
        choose(option.value);
      });
      menu.appendChild(item);
    }

    const closeMenu = (): void => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      menu.remove();
      trigger.setAttribute("aria-expanded", "false");
      if (activeContextMenuCleanup === closeMenu) activeContextMenuCleanup = null;
    };

    const onPointerDown = (event: Event): void => {
      const target = event.target as Node | null;
      if (target && (menu.contains(target) || trigger.contains(target))) return;
      closeMenu();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeMenu();
    };

    activeContextMenuCleanup = closeMenu;
    trigger.setAttribute("aria-expanded", "true");
    document.body.appendChild(menu);
    requestAnimationFrame(() => {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("keydown", onKeyDown, true);
    });
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    openMenu();
  });
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " " && event.key !== "ArrowDown") return;
    event.preventDefault();
    openMenu();
  });

  select.addEventListener("change", patched.__imageopsContextMenuSync);
  select.addEventListener("input", patched.__imageopsContextMenuSync);
  syncContextMenuSelect(patched);

  return wrapper;
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
