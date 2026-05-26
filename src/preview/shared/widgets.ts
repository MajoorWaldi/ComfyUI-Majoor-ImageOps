import type { ComfyNode, ComfyWidget } from "../../types.js";
import { isNode as isAppendNode } from "../nodes/append.js";
import { isNode as isFrameRangeNode } from "../nodes/frame-range.js";
import { isImageOpsNativeUiClass } from "./classes.js";
import { markCanvasDirty } from "./canvas.js";

function syncWidgetElement(widget: ComfyWidget | null, value: string | number | boolean): void {
  const element = widget?.element as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null | undefined);
  if (!element) return;

  if (typeof value === "boolean") {
    if ("checked" in element) {
      (element as HTMLInputElement).checked = value;
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

type WidgetSetOptions = {
  notify?: boolean;
  dirty?: boolean;
};

function notifyWidgetChanged(widget: ComfyWidget | null, value: string | number | boolean): void {
  if (!widget) return;
  try {
    widget.callback?.(value);
  } catch {}
}

export function findWidget(node: ComfyNode, name: string) {
  return node?.widgets?.find((w) => w?.name === name) ?? null;
}

export function widgetNumber(node: ComfyNode, name: string, fallback: number = 0): number {
  const value = findWidget(node, name)?.value;
  const parsed = parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function widgetString(node: ComfyNode, name: string, fallback: string = ""): string {
  const value = findWidget(node, name)?.value;
  return typeof value === "string" ? value : fallback;
}

export function widgetBoolean(node: ComfyNode, name: string, fallback: boolean = false): boolean {
  const value = findWidget(node, name)?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !!value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

export function hideWidgetForGood(node: ComfyNode, widget: ComfyWidget | null, suffix: string = ""): void {
  if (!widget) return;
  widget.origType = widget.origType ?? widget.type;
  widget.origComputeSize = widget.origComputeSize ?? widget.computeSize;
  (widget as any).origHidden ??= (widget as any).hidden;
  (widget as any).hidden = true;
  (widget as any).visible = false;
  (widget as any).last_y = -4096;
  (widget as any).draw = () => {};
  try {
    (widget as any).options = {
      ...((widget as any).options ?? {}),
      hidden: true,
      canvasOnly: true,
    };
  } catch {}
  widget.computeSize = () => [0, -4];

  // Keep the original widget type and any widget-backed input slots intact so
  // ComfyUI can still expose/restore external driving for hidden numeric/text widgets.
  const element = widget.element as HTMLElement | null | undefined;
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

export function hideWidgetsByName(node: ComfyNode, name: string): void {
  if (!node?.widgets) return;
  for (const widget of node.widgets) {
    if (widget?.name && widget.name.toLowerCase() === name.toLowerCase()) {
      hideWidgetForGood(node, widget);
    }
  }
}


export function setWidgetValue(widget: ComfyWidget | null, value: number, options: WidgetSetOptions = {}): void {
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

export function setWidgetStringValue(widget: ComfyWidget | null, value: string, options: WidgetSetOptions = {}): void {
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

export function setWidgetStringValuesByName(node: ComfyNode, name: string, value: string, options: WidgetSetOptions = {}): void {
  for (const widget of node.widgets ?? []) {
    if (widget?.name === name) setWidgetStringValue(widget, value, options);
  }
}

export function setWidgetBooleanValue(widget: ComfyWidget | null, value: boolean, options: WidgetSetOptions = {}): void {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const current = typeof widget.value === "boolean"
    ? widget.value
    : String(widget.value ?? "false").toLowerCase() === "true";
  const changed = current !== value;
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}

export function setWidgetMixedValue(widget: ComfyWidget | null, value: string | number | boolean, options: WidgetSetOptions = {}): void {
  if (!widget) return;
  const notify = options.notify !== false;
  const dirty = options.dirty !== false;
  const changed = typeof value === "number"
    ? Number(widget.value) !== Number(value)
    : typeof value === "boolean"
      ? (typeof widget.value === "boolean" ? widget.value : String(widget.value ?? "false").toLowerCase() === "true") !== value
      : String(widget.value ?? "") !== String(value);
  widget.value = value;
  syncWidgetElement(widget, value);
  if (changed) {
    if (notify) notifyWidgetChanged(widget, value);
    if (dirty) markCanvasDirty();
  }
}

export function getWidgetInputSpec(node: ComfyNode, name: string): { typeSpec: unknown; options: Record<string, unknown> | null } | null {
  const nodeData = (node as any)?.constructor?.nodeData;
  const entry = nodeData?.input?.required?.[name] ?? nodeData?.input?.optional?.[name];
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const options = entry[1];
  return {
    typeSpec: entry[0],
    options: options && typeof options === "object" ? options as Record<string, unknown> : null,
  };
}

function isWidgetHidden(widget: ComfyWidget | null): boolean {
  if (!widget) return true;
  if ((widget as any).hidden === true) return true;
  return Boolean((widget as any).options?.hidden);
}

// Local check — avoids circular import (comp.ts imports from widgets.ts).
function isCompNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === "ImageOpsComp";
}

function shouldUseCompactIntWidget(node: ComfyNode): boolean {
  return isFrameRangeNode(node) || isAppendNode(node) || isCompNode(node) || isImageOpsNativeUiClass(node.comfyClass);
}

function supportsCompactUi(node: ComfyNode, widget: ComfyWidget | null): boolean {
  if (!widget?.name || widget.name === "preview" || isWidgetHidden(widget)) return false;
  const spec = getWidgetInputSpec(node, widget.name);
  if (!spec) return false;
  if (Array.isArray(spec.typeSpec)) return true;
  const kind = String(spec.typeSpec ?? "").trim().toUpperCase();
  if (kind === "INT" && !shouldUseCompactIntWidget(node)) return false;
  return kind === "BOOLEAN" || kind === "INT" || kind === "FLOAT" || kind === "STRING" || kind === "COLOR" || kind === "COMBO";
}

export function listCompactUiWidgets(node: ComfyNode): ComfyWidget[] {
  return (node?.widgets ?? []).filter((widget) => supportsCompactUi(node, widget));
}

export function hideCompactUiWidgets(node: ComfyNode): void {
  // No-op: Disabled in favor of native ComfyUI widgets to prevent masking input connection slots (INT/FLOAT)
}

function cloneDefaultValue<T>(value: T): T {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value)) as T;
  }
}

export function getWidgetDefaultValue(node: ComfyNode, name: string): unknown {
  const nodeData = (node as any)?.constructor?.nodeData;
  const entry = nodeData?.input?.required?.[name] ?? nodeData?.input?.optional?.[name];
  if (!Array.isArray(entry)) return undefined;
  const options = entry[1];
  return options && typeof options === "object" ? cloneDefaultValue(options.default) : undefined;
}

export function resetNodeWidgetsToDefaults(node: ComfyNode): string[] {
  const resetNames: string[] = [];

  for (const widget of node?.widgets ?? []) {
    const name = widget?.name;
    if (!name) continue;

    const defaultValue = getWidgetDefaultValue(node, name);
    if (defaultValue === undefined) continue;

    if (typeof defaultValue === "boolean") {
      setWidgetBooleanValue(widget, defaultValue);
    } else if (typeof defaultValue === "number") {
      setWidgetValue(widget, defaultValue);
    } else if (typeof defaultValue === "string") {
      setWidgetStringValue(widget, defaultValue);
    } else {
      (widget as any).value = cloneDefaultValue(defaultValue);
    }
    resetNames.push(name);
  }

  return resetNames;
}
