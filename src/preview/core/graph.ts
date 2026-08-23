// Graph traversal helpers for ImageOps Live Preview (v6)
import type { ComfyLink, ComfyNode, ComfyOutputSlot, ComfyWidget, LGraph, MediaSource } from "../../types.js";

const MAX_RECURSION = 64;
const DEFAULT_INPUT_SCAN = 4;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg"]);
const MAYBE_ANIMATED_IMAGE_EXTS = new Set(["gif"]);

function normalizeLinkId(value: unknown): string | null {
  if (value == null || value === "") return null;
  return String(value);
}

function toFiniteNumber(value: unknown): number | undefined {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function normalizeGraphLink(link: unknown): ComfyLink | null {
  if (!link) return null;
  if (Array.isArray(link)) {
    const [id, origin_id, origin_slot, target_id, target_slot] = link;
    return {
      id: toFiniteNumber(id),
      origin_id: toFiniteNumber(origin_id),
      origin_slot: toFiniteNumber(origin_slot),
      target_id: toFiniteNumber(target_id),
      target_slot: toFiniteNumber(target_slot),
    };
  }
  if (typeof link === "object") return link as ComfyLink;
  return null;
}

function outputLinkIds(output: ComfyOutputSlot | undefined): string[] {
  const links = Array.isArray(output?.links)
    ? output.links
    : output?.links != null
      ? [output.links]
      : output?.link != null
        ? [output.link]
        : [];
  return links.map((value) => normalizeLinkId(value)).filter((value): value is string => !!value);
}

function resolveInputLinkFallback(node: ComfyNode, inputIndex: number): ComfyLink | null {
  const linkId = normalizeLinkId(node?.inputs?.[inputIndex]?.link ?? null);
  if (!linkId) return null;

  const graph = node?.graph as (LGraph & { links?: Record<string, unknown> | unknown[]; _links?: Record<string, unknown> | unknown[] }) | undefined;
  const stores = [graph?.links, graph?._links];
  for (const store of stores) {
    if (!store) continue;
    const entry = Array.isArray(store)
      ? store[toFiniteNumber(linkId) ?? -1]
      : (store as Record<string, unknown>)[linkId] ?? (store as Record<string, unknown>)[String(toFiniteNumber(linkId) ?? linkId)];
    const normalized = normalizeGraphLink(entry);
    if (normalized) return normalized;
  }

  for (const upstream of (graph?._nodes ?? [])) {
    for (let slot = 0; slot < (upstream.outputs?.length ?? 0); slot++) {
      if (outputLinkIds(upstream.outputs?.[slot]).includes(linkId)) {
        return {
          id: toFiniteNumber(linkId),
          origin_id: upstream.id,
          origin_slot: slot,
          target_id: node.id,
          target_slot: inputIndex,
        };
      }
    }
  }

  return null;
}

export function getInputLink(node: ComfyNode, inputIndex: number = 0): ComfyLink | null {
  try {
    const direct = normalizeGraphLink(node?.getInputLink?.(inputIndex) ?? null);
    if (direct) return direct;
  } catch {
    // Fall back to serialized link data below.
  }
  return resolveInputLinkFallback(node, inputIndex);
}

export function getInputOriginSlot(node: ComfyNode, inputIndex: number = 0, fallback: number | null = null): number | null {
  const link = getInputLink(node, inputIndex);
  return link?.origin_slot ?? link?.originSlot ?? fallback;
}

export function getInputCount(node: ComfyNode, fallback: number = DEFAULT_INPUT_SCAN): number {
  const count = Array.isArray(node?.inputs) ? node.inputs.length : 0;
  return count > 0 ? count : fallback;
}

export function getUpstreamNode(node: ComfyNode, inputIndex: number = 0): ComfyNode | null {
  const link = getInputLink(node, inputIndex);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  if (originId == null) return null;
  return node?.graph?.getNodeById?.(originId) ?? null;
}

export function getUpstreamNodes(node: ComfyNode): ComfyNode[] {
  const out: ComfyNode[] = [];
  for (let i = 0; i < getInputCount(node); i++) {
    const upstream = getUpstreamNode(node, i);
    if (upstream) out.push(upstream);
  }
  return out;
}

export function isGraphTooLarge(graph: LGraph | undefined, maxNodes: number = 140): boolean {
  const nodes = graph?._nodes ?? [];
  return nodes.length > maxNodes;
}

export function detectSource(node: ComfyNode): MediaSource | null {
  function getFileExtLower(s: unknown): string {
    const m = String(s ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
    return m ? m[1] : "";
  }
  function looksLikeMediaValue(v: unknown): boolean {
    if (v == null) return false;
    if (typeof v !== "string") return false;
    const ext = getFileExtLower(v);
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
  }
  function pickMediaWidget(n: ComfyNode): ComfyWidget | null {
    const preferred = ["image","video","path","filepath","file","filename","input_video","input_image"];
    for (const name of preferred) {
      const w = n?.widgets?.find((x: ComfyWidget) => x?.name === name);
      if (w && looksLikeMediaValue(w.value)) return w;
    }
    for (const w of (n?.widgets ?? [])) {
      if (looksLikeMediaValue(w?.value)) return w;
    }
    return null;
  }

  const w = pickMediaWidget(node);
  if (!w) return null;

  const ext = getFileExtLower(w.value);
  const kind: "image" | "video" = VIDEO_EXTS.has(ext) ? "video" : "image";
  return { kind, value: w.value as string, animated: kind === "image" && MAYBE_ANIMATED_IMAGE_EXTS.has(ext) };
}

export function detectSourceUpstream(node: ComfyNode, maxHops: number = MAX_RECURSION): MediaSource | null {
  const queue: ComfyNode[] = [node];
  const seen = new Set<number>();
  let best: MediaSource | null = null;
  let steps = 0;
  let head = 0; // Use index pointer instead of shift() to avoid O(n) cost

  while (head < queue.length && steps < maxHops && queue.length < 4096) {
    const cur = queue[head++];
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;

    const source = detectSource(cur);
    if (source?.kind === "video") return source;
    if (source?.animated) best = source;
    else if (!best && source) best = source;

    for (const upstream of getUpstreamNodes(cur)) {
      queue.push(upstream);
    }
  }
  return best;
}

export function findDependents(changedNode: ComfyNode, predicate: (n: ComfyNode) => boolean): ComfyNode[] {
  const g = changedNode?.graph;
  const nodes = g?._nodes ?? [];
  const out: ComfyNode[] = [];
  for (const n of nodes) {
    if (!n || !predicate(n)) continue;
    if (isUpstreamOf(changedNode, n)) out.push(n);
  }
  return out;
}

function isUpstreamOf(candidate: ComfyNode, node: ComfyNode, max: number = MAX_RECURSION): boolean {
  const seen = new Set<number>();
  const stack: ComfyNode[] = [node];
  let steps = 0;
  while (stack.length && steps < max) {
    const cur = stack.pop()!;
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;
    if (cur.id === candidate.id) return true;

    for (let i = 0; i < getInputCount(cur); i++) {
      const up = getUpstreamNode(cur, i);
      if (up) stack.push(up);
    }
  }
  return false;
}

export function w(node: ComfyNode, name: string): ComfyWidget | null {
    return node?.widgets?.find((x: ComfyWidget) => x?.name === name) ?? null;
}

export function widgetScalarValue(value: unknown, index: number = 0): unknown {
    let current = value;
    while (Array.isArray(current) && current.length > 0) {
    const resolvedIndex = Math.max(0, Math.min(current.length - 1, index));
    current = current[resolvedIndex];
    }

    return current;
}

export function num(node: ComfyNode, name: string, fallback: number = 0, index: number = 0): number {
    const v = widgetScalarValue(w(node, name)?.value, index);
    const n = parseFloat(v as string);
    return Number.isFinite(n) ? n : fallback;
}

export function str(node: ComfyNode, name: string, fallback: string = "", index: number = 0): string {
    const v = widgetScalarValue(w(node, name)?.value, index);
    return typeof v === "string" ? v : fallback;
}

export function bool(node: ComfyNode, name: string, fallback: boolean = false, index: number = 0): boolean {
    const v = widgetScalarValue(w(node, name)?.value, index);
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return !!v;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return fallback;
}

export function wAny(node: ComfyNode, names: string[]): ComfyWidget | null {
    for (const name of names) {
    const found = w(node, name);
    if (found) return found;
    }

    return null;
}

export function numAny(node: ComfyNode, names: string[], fallback: number = 0, index: number = 0): number {
    const v = widgetScalarValue(wAny(node, names)?.value, index);
    const n = parseFloat(v as string);
    return Number.isFinite(n) ? n : fallback;
}

export function strAny(node: ComfyNode, names: string[], fallback: string = "", index: number = 0): string {
    const v = widgetScalarValue(wAny(node, names)?.value, index);
    return typeof v === "string" ? v : fallback;
}

export function resolveConnectedString(node: ComfyNode, inputName: string): string | null {
    const inputs: any[] = (node as any)?.inputs ?? [];
    const slotIndex = inputs.findIndex((inp: any) => inp?.name === inputName);
    if (slotIndex < 0) return null;
    const link = inputs[slotIndex]?.link;
    if (link == null) return null;
    const linkData = (node as any)?.graph?.links?.[link];
    if (!linkData) return null;
    const upNode = (node as any)?.graph?.getNodeById?.(linkData.origin_id);
    if (!upNode) return null;
    const upWidget = ((upNode as any)?.widgets ?? []).find((w: any) => typeof w?.value === "string");
    return upWidget ? String(upWidget.value) : null;
}

export function boolAny(node: ComfyNode, names: string[], fallback: boolean = false, index: number = 0): boolean {
    const v = widgetScalarValue(wAny(node, names)?.value, index);
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return !!v;
    if (typeof v === "string") return v.toLowerCase() === "true";
    return fallback;
}

export function normalizeFilterName(filter: string): string {
    const value = String(filter || "bilinear").toLowerCase();
    if (value === "nearest") return "nearest-exact";
    if (value === "linear") return "bilinear";
    if (value === "cubic") return "bicubic";
    return value;
}

export function imageLikeInputName(name: string): boolean {
    return /image|images|source|destination|background|foreground|layer|red|green|blue|channel|input/i.test(name);
}

export function getPreferredInputIndexes(node: ComfyNode): number[] {
    const indexes: number[] = [];
    for (let index = 0; index < (node.inputs?.length ?? 0); index++) {
    const slot = node.inputs?.[index];
    const name = String(slot?.name ?? "");
    const type = String(slot?.type ?? "");
    if (/mask|bbox|box|region/i.test(name) || /mask|bbox|box/i.test(type)) continue;
    if (slot?.link == null && !node.getInputLink?.(index)) continue;
    if (imageLikeInputName(name) || /image|video/i.test(type)) indexes.push(index);
    }

    if (indexes.length > 0) return indexes;
    return [0];
}
