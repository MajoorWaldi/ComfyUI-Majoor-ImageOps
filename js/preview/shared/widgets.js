import { isNode as isAppendNode } from "../nodes/append.js";
import { isNode as isFrameRangeNode } from "../nodes/frame-range.js";
import { isImageOpsNativeUiClass } from "./classes.js";
import { markCanvasDirty } from "./canvas.js";
function syncWidgetElement(widget, value) {
  const element = widget?.element;
  if (!element) return;
  if (typeof value === "boolean") {
    if ("checked" in element) {
      element.checked = value;
    }
    if ("value" in element) {
      element.value = value ? "true" : "false";
    }
    return;
  }
  if ("value" in element) {
    element.value = String(value);
  }
}
function notifyWidgetChanged(widget, value) {
  if (!widget) return;
  try {
    widget.callback?.(value);
  } catch {
  }
}
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
  widget.last_y = -4096;
  widget.draw = () => {
  };
  try {
    widget.options = {
      ...widget.options ?? {},
      hidden: true,
      canvasOnly: true
    };
  } catch {
  }
  widget.computeSize = () => [0, -4];
  const element = widget.element;
  if (element) {
    element.hidden = true;
    element.style.display = "none";
  }
  if (widget.linkedWidgets) {
    for (const linked of widget.linkedWidgets) {
      hideWidgetForGood(node, linked, `:${widget.name}${suffix}`);
    }
  }
}
function hideWidgetsByName(node, name) {
  if (!node?.widgets) return;
  for (const widget of node.widgets) {
    if (widget?.name === name) hideWidgetForGood(node, widget);
  }
}
function setWidgetValue(widget, value, options = {}) {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const changed = Number(widget.value) !== Number(value);
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}
function setWidgetStringValue(widget, value, options = {}) {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const changed = String(widget.value ?? "") !== String(value);
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}
function setWidgetStringValuesByName(node, name, value, options = {}) {
  for (const widget of node.widgets ?? []) {
    if (widget?.name === name) setWidgetStringValue(widget, value, options);
  }
}
function setWidgetBooleanValue(widget, value, options = {}) {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const current = typeof widget.value === "boolean" ? widget.value : String(widget.value ?? "false").toLowerCase() === "true";
  const changed = current !== value;
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}
function setWidgetMixedValue(widget, value, options = {}) {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const changed = typeof value === "number" ? Number(widget.value) !== Number(value) : typeof value === "boolean" ? (typeof widget.value === "boolean" ? widget.value : String(widget.value ?? "false").toLowerCase() === "true") !== value : String(widget.value ?? "") !== String(value);
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}
function getWidgetInputSpec(node, name) {
  const nodeData = node?.constructor?.nodeData;
  const entry = nodeData?.input?.required?.[name] ?? nodeData?.input?.optional?.[name];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const options = entry[1];
  return {
    typeSpec: entry[0],
    options: options && typeof options === "object" ? options : null
  };
}
function isWidgetHidden(widget) {
  if (!widget) return true;
  if (widget.hidden === true) return true;
  return Boolean(widget.options?.hidden);
}
function isCompNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsComp";
}
function shouldUseCompactIntWidget(node) {
  return isFrameRangeNode(node) || isAppendNode(node) || isCompNode(node) || isImageOpsNativeUiClass(node.comfyClass);
}
function supportsCompactUi(node, widget) {
  if (!widget?.name || widget.name === "preview" || isWidgetHidden(widget)) return false;
  const spec = getWidgetInputSpec(node, widget.name);
  if (!spec) return false;
  if (Array.isArray(spec.typeSpec)) return true;
  const kind = String(spec.typeSpec ?? "").trim().toUpperCase();
  if (kind === "INT" && !shouldUseCompactIntWidget(node)) return false;
  return kind === "BOOLEAN" || kind === "INT" || kind === "FLOAT" || kind === "STRING" || kind === "COLOR" || kind === "COMBO";
}
function listCompactUiWidgets(node) {
  return (node?.widgets ?? []).filter((widget) => supportsCompactUi(node, widget));
}
function hideCompactUiWidgets(node) {
  for (const widget of listCompactUiWidgets(node)) {
    hideWidgetForGood(node, widget);
  }
}
function cloneDefaultValue(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}
function getWidgetDefaultValue(node, name) {
  const nodeData = node?.constructor?.nodeData;
  const entry = nodeData?.input?.required?.[name] ?? nodeData?.input?.optional?.[name];
  if (!Array.isArray(entry)) return void 0;
  const options = entry[1];
  return options && typeof options === "object" ? cloneDefaultValue(options.default) : void 0;
}
function resetNodeWidgetsToDefaults(node) {
  const resetNames = [];
  for (const widget of node?.widgets ?? []) {
    const name = widget?.name;
    if (!name) continue;
    const defaultValue = getWidgetDefaultValue(node, name);
    if (defaultValue === void 0) continue;
    if (typeof defaultValue === "boolean") {
      setWidgetBooleanValue(widget, defaultValue);
    } else if (typeof defaultValue === "number") {
      setWidgetValue(widget, defaultValue);
    } else if (typeof defaultValue === "string") {
      setWidgetStringValue(widget, defaultValue);
    } else {
      widget.value = cloneDefaultValue(defaultValue);
    }
    resetNames.push(name);
  }
  return resetNames;
}
export {
  findWidget,
  getWidgetDefaultValue,
  getWidgetInputSpec,
  hideCompactUiWidgets,
  hideWidgetForGood,
  hideWidgetsByName,
  listCompactUiWidgets,
  resetNodeWidgetsToDefaults,
  setWidgetBooleanValue,
  setWidgetMixedValue,
  setWidgetStringValue,
  setWidgetStringValuesByName,
  setWidgetValue,
  widgetBoolean,
  widgetNumber,
  widgetString
};
