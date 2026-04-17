function findWidget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) ?? null;
}
function widgetNumber(node, name, fallback = 0) {
  const value = findWidget(node, name)?.value;
  const parsed = parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
function widgetString(node, name, fallback = "") {
  const value = findWidget(node, name)?.value;
  return typeof value === "string" ? value : fallback;
}
function widgetBoolean(node, name, fallback = false) {
  const value = findWidget(node, name)?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !!value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}
function hideWidgetForGood(node, widget, suffix = "") {
  if (!widget) return;
  widget.origType = widget.origType ?? widget.type;
  widget.origComputeSize = widget.origComputeSize ?? widget.computeSize;
  widget.origHidden ?? (widget.origHidden = widget.hidden);
  widget.hidden = true;
  widget.visible = false;
  widget.disabled = true;
  widget.last_y = -4096;
  widget.draw = () => {
  };
  widget.options = { ...widget.options ?? {}, hidden: true };
  widget.computeSize = () => [0, -4];
  widget.type = "hidden";
  const inputs = node.inputs ?? [];
  for (let i = inputs.length - 1; i >= 0; i--) {
    const inp = inputs[i];
    if (inp?.widget?.name === widget.name && inp.link == null) {
      node.removeInput?.(i);
      break;
    }
  }
  if (widget.linkedWidgets) {
    for (const linked of widget.linkedWidgets) {
      hideWidgetForGood(node, linked, `:${widget.name}${suffix}`);
    }
  }
}
function setWidgetValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
function setWidgetStringValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
function setWidgetBooleanValue(widget, value) {
  if (!widget) return;
  widget.value = value;
}
export {
  findWidget,
  hideWidgetForGood,
  setWidgetBooleanValue,
  setWidgetStringValue,
  setWidgetValue,
  widgetBoolean,
  widgetNumber,
  widgetString
};
