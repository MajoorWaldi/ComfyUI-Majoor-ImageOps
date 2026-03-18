// Renderer (recursive, supports interop) (v6)
import type { ComfyNode, ComfyAPI, AdapterRegistry, RenderContext, RenderResult } from "../types.js";
import { getUpstreamNode, detectSource } from "./graph.js";
import { makeViewUrl, ensureBitmap, ensureImageElement, ensureVideoFrameCanvas, fitWithinMaxSize } from "./source.js";

interface RendererConfig {
  api: ComfyAPI;
  registry: AdapterRegistry;
  canvasSize: number;
}

interface Renderer {
  render(node: ComfyNode, tick?: number): Promise<RenderResult>;
}

export function buildRenderer({ api, registry, canvasSize }: RendererConfig): Renderer {
  const MAX_RECURSION = 64;

  function hashString(value: string): string {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function getNativePreviewElement(node: ComfyNode): HTMLImageElement | HTMLVideoElement | HTMLCanvasElement | null {
    const imgs = node?.imgs;
    if (!Array.isArray(imgs) || imgs.length === 0) return null;
    const index = typeof node.imageIndex === "number" ? node.imageIndex : imgs.length - 1;
    return imgs[Math.max(0, Math.min(imgs.length - 1, index))] ?? imgs[imgs.length - 1] ?? null;
  }

  async function renderFromNativePreview(node: ComfyNode): Promise<HTMLCanvasElement | null> {
    if (String(node?.comfyClass ?? "").startsWith("ImageOps")) return null;

    const media = getNativePreviewElement(node);
    if (!media) return null;

    if (media instanceof HTMLVideoElement) {
      if (media.readyState < 2) {
        try { await media.play(); } catch {}
        if (media.readyState < 2) return null;
      }
      const dims = fitWithinMaxSize(media.videoWidth || 1, media.videoHeight || 1, canvasSize);
      const canvas = document.createElement("canvas");
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(media, 0, 0, dims.width, dims.height);
      return canvas;
    }

    if (media instanceof HTMLImageElement) {
      if (!media.complete) {
        try { await media.decode?.(); } catch {}
        if (!media.complete) return null;
      }
      const dims = fitWithinMaxSize(media.naturalWidth || media.width || 1, media.naturalHeight || media.height || 1, canvasSize);
      const canvas = document.createElement("canvas");
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(media, 0, 0, dims.width, dims.height);
      return canvas;
    }

    if (media instanceof HTMLCanvasElement) {
      const dims = fitWithinMaxSize(media.width || 1, media.height || 1, canvasSize);
      const canvas = document.createElement("canvas");
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(media, 0, 0, dims.width, dims.height);
      return canvas;
    }

    return null;
  }

  async function render(node: ComfyNode, tick: number = 0): Promise<RenderResult> {
    const ctx: RenderContext = { api, canvasSize, tick, cache: new Map(), visited: new Set() };
    const canvas = await renderNode(node, ctx);
    return { canvas };
  }

  async function renderNode(node: ComfyNode | null, ctx: RenderContext): Promise<HTMLCanvasElement | null> {
    if (!node) return null;
    if (ctx.visited.has(node.id)) return null;
    if (ctx.visited.size > MAX_RECURSION) return null;
    ctx.visited.add(node.id);

    const sig = signature(node, ctx.tick);
    if (ctx.cache.has(sig)) {
      ctx.visited.delete(node.id);
      return ctx.cache.get(sig)!;
    }

    // source node?
    const src = detectSource(node);
    if (src) {
      const url = makeViewUrl(ctx.api, src.value);
      if (!url) { ctx.visited.delete(node.id); return null; }
      let c: HTMLCanvasElement | null = null;

      if (src.kind === "image" && src.animated) {
        const img = await ensureImageElement(node, url);
        if (!img) { ctx.visited.delete(node.id); return null; }
        const dims = fitWithinMaxSize(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1, ctx.canvasSize);
        c = document.createElement("canvas");
        c.width = dims.width;
        c.height = dims.height;
        const cctx = c.getContext("2d")!;
        cctx.drawImage(img, 0, 0, dims.width, dims.height);
      } else if (src.kind === "image") {
        const bmp = await ensureBitmap(node, url);
        if (!bmp) { ctx.visited.delete(node.id); return null; }
        const dims = fitWithinMaxSize(bmp.width || 1, bmp.height || 1, ctx.canvasSize);
        c = document.createElement("canvas");
        c.width = dims.width;
        c.height = dims.height;
        const cctx = c.getContext("2d")!;
        cctx.drawImage(bmp, 0, 0, dims.width, dims.height);
      } else {
        c = await ensureVideoFrameCanvas(node, url, ctx.canvasSize);
      }

      if (!c) { ctx.visited.delete(node.id); return null; }
      ctx.cache.set(sig, c);
      ctx.visited.delete(node.id);
      return c;
    }

    const nativePreview = await renderFromNativePreview(node);
    if (nativePreview) {
      ctx.cache.set(sig, nativePreview);
      ctx.visited.delete(node.id);
      return nativePreview;
    }

    const adapter = registry.pick(node);
    const adapterInputIndexes = adapter
      ? ((typeof adapter.inputIndexes === "function")
        ? adapter.inputIndexes(node)
        : (adapter.inputIndexes ?? []))
      : [];
    const resolvedIndexes = adapterInputIndexes.length > 0
      ? adapterInputIndexes
      : [...Array(adapter ? ((typeof adapter.inputs === "function") ? adapter.inputs(node) : (adapter.inputs ?? 1)) : 1).keys()];
    if (!adapter) {
      const primaryInputIndex = resolvedIndexes[0] ?? 0;
      const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx);
      ctx.visited.delete(node.id);
      return primary;
    }

    if (resolvedIndexes.length === 0) {
      const out = document.createElement("canvas");
      out.width = 1;
      out.height = 1;
      const octx = out.getContext("2d")!;
      const adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs: [] });
      const result = adapted instanceof HTMLCanvasElement ? adapted : out;
      ctx.cache.set(sig, result);
      ctx.visited.delete(node.id);
      return result;
    }

    const primaryInputIndex = resolvedIndexes[0] ?? 0;
    const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx);

    // gather inputs
    if (!primary) { ctx.visited.delete(node.id); return null; }

    const inputs: HTMLCanvasElement[] = [];
    for (let i = 0; i < resolvedIndexes.length; i++) {
      const inputIndex = resolvedIndexes[i];
      const up = getUpstreamNode(node, inputIndex);
      if (i === 0 && !up) {
        ctx.visited.delete(node.id);
        return primary;
      }
      if (i === 0 && inputIndex === primaryInputIndex && primary) {
        inputs.push(primary);
        continue;
      }
      const c = await renderNode(up, ctx);
      if (!c) {
        ctx.cache.set(sig, primary);
        ctx.visited.delete(node.id);
        return primary;
      }
      inputs.push(c);
    }

    // work canvas is copy of first input
    if (inputs.length === 0) {
      ctx.cache.set(sig, primary);
      ctx.visited.delete(node.id);
      return primary;
    }
    const out = document.createElement("canvas");
    out.width = primary.width;
    out.height = primary.height;
    const octx = out.getContext("2d")!;
    octx.drawImage(inputs[0], 0, 0);

    const adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs });
    const result = adapted instanceof HTMLCanvasElement ? adapted : out;

    ctx.cache.set(sig, result);
    ctx.visited.delete(node.id);
    return result;
  }

  function signature(node: ComfyNode, tick: number): string {
    const parts: (string | number)[] = [node.id, String(node.comfyClass ?? ""), tick];
    for (const w of (node.widgets ?? [])) {
      const v = w?.value;
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        if (typeof v === "string" && v.length > 120) {
          parts.push(`${w.name}:str:${v.length}:${hashString(v)}`);
        } else {
          parts.push(`${w.name}:${v}`);
        }
      }
    }
    return parts.join("|");
  }
  return { render };
}
