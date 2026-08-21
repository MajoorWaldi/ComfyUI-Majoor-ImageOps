import type { ComfyNode, ComfyOutputSlot, ComfyWidget } from "../types.js";
import { fitWithinMaxSize } from "./source.js";

const MAX_DOWNSTREAM_DEPTH = 12;
const MAX_DOWNSTREAM_NODES = 96;

export interface NodeStreamPreviewResult {
  canvas: HTMLCanvasElement;
  previewNodeId: number;
  source: "node-imgs" | "widget-media" | "graph-downstream";
}

function isImageElement(value: unknown): value is HTMLImageElement {
  return typeof HTMLImageElement !== "undefined" && value instanceof HTMLImageElement;
}

function isVideoElement(value: unknown): value is HTMLVideoElement {
  return typeof HTMLVideoElement !== "undefined" && value instanceof HTMLVideoElement;
}

function isCanvasElement(value: unknown): value is HTMLCanvasElement {
  return typeof HTMLCanvasElement !== "undefined" && value instanceof HTMLCanvasElement;
}

function outputLinks(output: ComfyOutputSlot | undefined | null): Array<number | string> {
  if (!output) return [];
  const direct = output.links;
  if (Array.isArray(direct)) {
    return direct.filter((entry): entry is number | string => entry != null);
  }
  const single = output.link ?? direct;
  return single != null ? [single] : [];
}

function getGraphLinkRecord(node: ComfyNode, linkId: number | string): unknown {
  const graphLinks = node?.graph?.links ?? node?.graph?._links ?? null;
  if (!graphLinks) return null;
  const numericId = Number(linkId);
  const stringId = String(linkId);

  if (graphLinks instanceof Map) {
    return graphLinks.get(linkId) ?? graphLinks.get(numericId) ?? graphLinks.get(stringId) ?? null;
  }
  if (Array.isArray(graphLinks)) {
    const direct = graphLinks[numericId];
    if (direct) return direct;
    for (const item of graphLinks) {
      if (!item) continue;
      if (Array.isArray(item) && String(item[0]) === stringId) return item;
      const itemId = (item as any).id ?? (item as any).link_id ?? (item as any).linkId ?? null;
      if (itemId != null && String(itemId) === stringId) return item;
    }
    return null;
  }
  if (typeof graphLinks === "object") {
    return (graphLinks as any)[linkId] ?? (graphLinks as any)[numericId] ?? (graphLinks as any)[stringId] ?? null;
  }
  return null;
}

function getTargetNodeIdForLink(node: ComfyNode, linkId: number | string): number | null {
  const record = getGraphLinkRecord(node, linkId);
  if (Array.isArray(record) && record.length >= 4) {
    const targetId = Number(record[3]);
    return Number.isFinite(targetId) ? targetId : null;
  }
  if (record && typeof record === "object") {
    const targetId = Number((record as any).target_id ?? (record as any).targetId ?? (record as any).to ?? NaN);
    return Number.isFinite(targetId) ? targetId : null;
  }

  const graphNodes = node?.graph?._nodes ?? [];
  for (const graphNode of graphNodes) {
    for (const input of graphNode?.inputs ?? []) {
      if (input?.link == null) continue;
      if (String(input.link) === String(linkId)) {
        return Number(graphNode.id);
      }
    }
  }
  return null;
}

function getDownstreamNodes(node: ComfyNode): ComfyNode[] {
  const results: ComfyNode[] = [];
  const seen = new Set<number>();
  for (const output of node?.outputs ?? []) {
    for (const linkId of outputLinks(output)) {
      const targetId = getTargetNodeIdForLink(node, linkId);
      if (targetId == null || seen.has(targetId)) continue;
      const targetNode = node?.graph?.getNodeById?.(targetId) ?? null;
      if (!targetNode) continue;
      seen.add(targetId);
      results.push(targetNode);
    }
  }
  return results;
}

function findWidgetMedia(widget: ComfyWidget): HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null {
  const el = widget?.element;
  if (!el) return null;
  if (isImageElement(el) || isVideoElement(el) || isCanvasElement(el)) return el;
  const image = el.querySelector?.("img");
  if (isImageElement(image)) return image;
  const video = el.querySelector?.("video");
  if (isVideoElement(video)) return video;
  const canvas = el.querySelector?.("canvas");
  if (isCanvasElement(canvas)) return canvas;
  return null;
}

async function mediaToCanvas(media: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement, canvasSize: number): Promise<HTMLCanvasElement | null> {
  if (isImageElement(media)) {
    if (!media.complete) {
      try { await media.decode?.(); } catch {}
      if (!media.complete) return null;
    }
    const dims = fitWithinMaxSize(media.naturalWidth || media.width || 1, media.naturalHeight || media.height || 1, canvasSize);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    canvas.getContext("2d")?.drawImage(media, 0, 0, dims.width, dims.height);
    return canvas;
  }
  if (isVideoElement(media)) {
    if (media.readyState < 2) {
      try { await media.play(); } catch {}
      if (media.readyState < 2) return null;
    }
    const dims = fitWithinMaxSize(media.videoWidth || 1, media.videoHeight || 1, canvasSize);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    canvas.getContext("2d")?.drawImage(media, 0, 0, dims.width, dims.height);
    return canvas;
  }
  const dims = fitWithinMaxSize(media.width || 1, media.height || 1, canvasSize);
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  canvas.getContext("2d")?.drawImage(media, 0, 0, dims.width, dims.height);
  return canvas;
}

async function extractDirectPreviewCanvas(node: ComfyNode, canvasSize: number): Promise<{ canvas: HTMLCanvasElement; source: "node-imgs" | "widget-media" } | null> {
  const imgs = node?.imgs;
  if (Array.isArray(imgs) && imgs.length > 0) {
    const index = typeof node.imageIndex === "number" ? node.imageIndex : imgs.length - 1;
    const media = imgs[Math.max(0, Math.min(imgs.length - 1, index))] ?? imgs[imgs.length - 1] ?? null;
    if ((isImageElement(media) || isVideoElement(media) || isCanvasElement(media))) {
      const canvas = await mediaToCanvas(media, canvasSize);
      if (canvas) return { canvas, source: "node-imgs" };
    }
  }

  for (const widget of node?.widgets ?? []) {
    const media = findWidgetMedia(widget);
    if (!media) continue;
    const canvas = await mediaToCanvas(media, canvasSize);
    if (canvas) return { canvas, source: "widget-media" };
  }

  return null;
}

export async function resolveNodeStreamPreview(node: ComfyNode | null, canvasSize: number): Promise<NodeStreamPreviewResult | null> {
  if (!node) return null;
  const visited = new Set<number>();
  const queue: Array<{ node: ComfyNode; depth: number }> = [{ node, depth: 0 }];
  let scanned = 0;
  let head = 0; // Use index pointer instead of shift() to avoid O(n) cost

  while (head < queue.length && scanned < MAX_DOWNSTREAM_NODES) {
    const current = queue[head++];
    if (!current?.node) continue;
    const currentId = Number(current.node.id);
    if (visited.has(currentId)) continue;
    visited.add(currentId);
    scanned += 1;

    const direct = await extractDirectPreviewCanvas(current.node, canvasSize);
    if (direct) {
      return {
        canvas: direct.canvas,
        previewNodeId: currentId,
        source: currentId === Number(node.id) ? direct.source : "graph-downstream",
      };
    }

    if (current.depth >= MAX_DOWNSTREAM_DEPTH) continue;
    for (const downstream of getDownstreamNodes(current.node)) {
      if (!visited.has(Number(downstream.id))) {
        queue.push({ node: downstream, depth: current.depth + 1 });
      }
    }
  }

  return null;
}
