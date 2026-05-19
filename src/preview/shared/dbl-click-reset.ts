/**
 * Double-click reset helper — attaches a dblclick listener to any HTML control
 * (slider/input/button/color picker) that resets it to a default value and
 * invokes a callback so the underlying widget can be synced.
 *
 * Usage:
 *   attachDblClickReset(rangeInput, { defaultValue: 1, onReset: (v) => setWidget(node, "gain", v) });
 *   attachDblClickReset(colorInput, { defaultValue: "#000000", onReset: (v) => setWidget(node, "color", v) });
 */

export type DblClickResetOptions<T extends string | number | boolean> = {
  defaultValue: T;
  onReset: (value: T) => void;
  /** When true, also dispatches an 'input' and 'change' event on the element. Default true. */
  fireEvents?: boolean;
};

export function attachDblClickReset<T extends string | number | boolean>(
  element: HTMLElement | null,
  options: DblClickResetOptions<T>,
): void {
  if (!element) return;
  const handler = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const v = options.defaultValue;
    const el = element as HTMLInputElement;
    if ("value" in el) {
      if (typeof v === "boolean") {
        if ("checked" in el) el.checked = v as unknown as boolean;
        el.value = v ? "true" : "false";
      } else {
        el.value = String(v);
      }
    }
    if (options.fireEvents !== false) {
      try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch {}
      try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch {}
    }
    options.onReset(v);
  };
  element.addEventListener("dblclick", handler);
  // Tag so callers can inspect/remove later if needed
  (element as any).__imageopsDblClickReset = handler;
}

/**
 * Convenience: attach reset to multiple controls at once.
 */
export function attachDblClickResets(
  bindings: Array<{ element: HTMLElement | null; defaultValue: string | number | boolean; onReset: (value: any) => void }>,
): void {
  for (const b of bindings) {
    attachDblClickReset(b.element, { defaultValue: b.defaultValue as any, onReset: b.onReset });
  }
}
