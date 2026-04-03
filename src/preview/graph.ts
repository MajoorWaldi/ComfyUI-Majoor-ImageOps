// Graph traversal helpers for ImageOps Live Preview (v6)
import type { ComfyNode, ComfyLink, ComfyWidget, LGraph, MediaSource } from "../types.js";

const MAX_RECURSION = 64;
const DEFAULT_INPUT_SCAN = 4;
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]);
const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg"]);
const MAYBE_ANIMATED_IMAGE_EXTS = new Set(["gif"]);

export function getInputLink(node: ComfyNode, inputIndex: number = 0): ComfyLink | null {
  try { return node?.getInputLink?.(inputIndex) ?? null; } catch { return null; }
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
