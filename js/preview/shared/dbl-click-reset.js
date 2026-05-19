function attachDblClickReset(element, options) {
  if (!element) return;
  const handler = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = options.defaultValue;
    const el = element;
    if ("value" in el) {
      if (typeof v === "boolean") {
        if ("checked" in el) el.checked = v;
        el.value = v ? "true" : "false";
      } else {
        el.value = String(v);
      }
    }
    if (options.fireEvents !== false) {
      try {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } catch {
      }
      try {
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {
      }
    }
    options.onReset(v);
  };
  element.addEventListener("dblclick", handler);
  element.__imageopsDblClickReset = handler;
}
function attachDblClickResets(bindings) {
  for (const b of bindings) {
    attachDblClickReset(b.element, { defaultValue: b.defaultValue, onReset: b.onReset });
  }
}
export {
  attachDblClickReset,
  attachDblClickResets
};
