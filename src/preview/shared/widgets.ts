import type { ComfyNode, ComfyWidget } from "../../types.js";

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
  (widget as any).disabled = true;
  (widget as any).last_y = -4096;
  (widget as any).draw = () => {};
  (widget as any).options = { ...((widget as any).options ?? {}), hidden: true };
  widget.computeSize = () => [0, -4];
  widget.type = "hidden";

  // Remove the corresponding widget-backed input slot (avoids phantom connection dots).
  // Only remove if the slot has no active link so existing wired workflows are not broken.
  const inputs = node.inputs ?? [];
  for (let i = inputs.length - 1; i >= 0; i--) {
    const inp = inputs[i] as any;
    if (inp?.widget?.name === widget.name && (inp.link == null)) {
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

export function setWidgetValue(widget: ComfyWidget | null, value: number): void {
  if (!widget) return;
  widget.value = value;
  syncWidgetElement(widget, value);
}

export function setWidgetStringValue(widget: ComfyWidget | null, value: string): void {
  if (!widget) return;
  widget.value = value;
  syncWidgetElement(widget, value);
}

export function setWidgetBooleanValue(widget: ComfyWidget | null, value: boolean): void {
  if (!widget) return;
  widget.value = value;
  syncWidgetElement(widget, value);
}
