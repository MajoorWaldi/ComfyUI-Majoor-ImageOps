// Renderer (recursive, supports interop) (v6)
import type { ComfyNode, ComfyAPI, AdapterRegistry, RenderContext, RenderInputInfo, RenderResult } from "../types.js";
import { getInputLink, getInputOriginSlot, getUpstreamNode, detectSource } from "./graph.js";
import { makeViewUrl, ensureBitmap, ensureImageElement, ensureVideoFrameCanvas, fitWithinMaxSize, renderImageSourceToCanvas } from "./source.js";
import { isImageOpsClass } from "./shared/classes.js";

interface RendererConfig {
  api: ComfyAPI;
  registry: AdapterRegistry;
  canvasSize: number;
}

interface Renderer {
  render(node: ComfyNode, tick?: number, outputSlot?: number | null, canvasSizeOverride?: number): Promise<RenderResult>;
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
    if (isImageOpsClass(node?.comfyClass)) return null;

    const media = getNativePreviewElement(node);
    if (!media) return null;

      if (media instanceof HTMLVideoElement) {
        if (media.readyState < 2) {
          try { await media.play(); } catch {}
          if (media.readyState < 2) return null;
        }
        const dims = fitWithinMaxSize(media.videoWidth || 1, media.videoHeight || 1, canvasSize);
        return renderImageSourceToCanvas(node, media, dims.width, dims.height, "nativeCanvas");
      }

    if (media instanceof HTMLImageElement) {
      if (!media.complete) {
        try { await media.decode?.(); } catch {}
        if (!media.complete) return null;
      }
      const dims = fitWithinMaxSize(media.naturalWidth || media.width || 1, media.naturalHeight || media.height || 1, canvasSize);
      return renderImageSourceToCanvas(node, media, dims.width, dims.height, "nativeCanvas");
    }

    if (media instanceof HTMLCanvasElement) {
      const dims = fitWithinMaxSize(media.width || 1, media.height || 1, canvasSize);
      return renderImageSourceToCanvas(node, media, dims.width, dims.height, "nativeCanvas");
    }

    return null;
  }

  function makePlaceholderCanvas(): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  }

  const STATIC_CACHE_MAX = 16;

  function getPersistentStaticCache(node: ComfyNode): Map<string, HTMLCanvasElement> {
    node.__imageops_media ??= {};
    node.__imageops_media.staticRenderCache ??= new Map<string, HTMLCanvasElement>();
    return node.__imageops_media.staticRenderCache;
  }

  function pruneStaticCache(cache: Map<string, HTMLCanvasElement>): void {
    while (cache.size > STATIC_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  async function render(node: ComfyNode, tick: number = 0, outputSlot: number | null = null, canvasSizeOverride?: number): Promise<RenderResult> {
    const ctx: RenderContext = { api, canvasSize: canvasSizeOverride ?? canvasSize, tick, cache: new Map(), visited: new Set() };
    const canvas = await renderNode(node, ctx, outputSlot);
    return { canvas };
  }

  async function renderNode(node: ComfyNode | null, ctx: RenderContext, outputSlot: number | null): Promise<HTMLCanvasElement | null> {
    if (!node) return null;
    if (ctx.visited.has(node.id)) return null;
    if (ctx.visited.size > MAX_RECURSION) return null;
    ctx.visited.add(node.id);

    const sig = signature(node, ctx.tick, outputSlot);
    if (ctx.cache.has(sig)) {
      ctx.visited.delete(node.id);
      return ctx.cache.get(sig)!;
    }
    if (ctx.tick === 0) {
      const persistent = getPersistentStaticCache(node);
      const cached = persistent.get(sig);
      if (cached) {
        ctx.cache.set(sig, cached);
        ctx.visited.delete(node.id);
        return cached;
      }
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
        c = renderImageSourceToCanvas(node, img, dims.width, dims.height, "animatedImageCanvas");
      } else if (src.kind === "image") {
        const bmp = await ensureBitmap(node, url);
        if (!bmp) { ctx.visited.delete(node.id); return null; }
        const dims = fitWithinMaxSize(bmp.width || 1, bmp.height || 1, ctx.canvasSize);
        c = renderImageSourceToCanvas(node, bmp, dims.width, dims.height, "imageCanvas");
      } else {
        c = await ensureVideoFrameCanvas(node, url, ctx.canvasSize, ctx.tick);
      }

      if (!c) { ctx.visited.delete(node.id); return null; }
      ctx.cache.set(sig, c);
      if (ctx.tick === 0) {
        const persistent = getPersistentStaticCache(node);
        persistent.clear();
        persistent.set(sig, c);
        pruneStaticCache(persistent);
      }
      ctx.visited.delete(node.id);
      return c;
    }

    const nativePreview = await renderFromNativePreview(node);
    if (nativePreview) {
      ctx.cache.set(sig, nativePreview);
      if (ctx.tick === 0) {
        const persistent = getPersistentStaticCache(node);
        persistent.clear();
        persistent.set(sig, nativePreview);
        pruneStaticCache(persistent);
      }
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
      const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx, getInputOriginSlot(node, primaryInputIndex));
      ctx.visited.delete(node.id);
      return primary;
    }

    const renderInputAt = async (inputInfo: RenderInputInfo, tickOverride: number): Promise<HTMLCanvasElement | null> => {
      if (!inputInfo.upstreamNode) return inputInfo.canvas ?? null;
      const localCtx: RenderContext = {
        api,
        canvasSize: ctx.canvasSize,
        tick: tickOverride,
        cache: new Map(),
        visited: new Set([node.id]),
      };
      return await renderNode(inputInfo.upstreamNode, localCtx, inputInfo.originSlot ?? null);
    };

    if (resolvedIndexes.length === 0) {
      const out = document.createElement("canvas");
      out.width = 1;
      out.height = 1;
      const octx = out.getContext("2d");
      if (!octx) { ctx.visited.delete(node.id); return null; }
      let adapted: HTMLCanvasElement | void | null | undefined = out;
      try {
        adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs: [], tick: ctx.tick, renderInputAt });
      } catch (err) {
        console.warn(`[ImageOps] adapter '${(adapter as any)?.name ?? node.comfyClass}' threw — falling back to placeholder.`, err);
        adapted = out;
      }
      const result = adapted instanceof HTMLCanvasElement ? adapted : out;
      ctx.cache.set(sig, result);
      if (ctx.tick === 0) {
        const persistent = getPersistentStaticCache(node);
        persistent.clear();
        persistent.set(sig, result);
        pruneStaticCache(persistent);
      }
      ctx.visited.delete(node.id);
      return result;
    }

    const primaryInputIndex = resolvedIndexes[0] ?? 0;
    const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx, getInputOriginSlot(node, primaryInputIndex));

    // gather inputs
    if (!primary) { ctx.visited.delete(node.id); return null; }

    const inputs: HTMLCanvasElement[] = [];
    const inputInfos: RenderInputInfo[] = [];
    for (let i = 0; i < resolvedIndexes.length; i++) {
      const inputIndex = resolvedIndexes[i];
      const up = getUpstreamNode(node, inputIndex);
      const originSlot = getInputOriginSlot(node, inputIndex);
      if (i === 0 && !up) {
        ctx.visited.delete(node.id);
        return primary;
      }
      if (i === 0 && inputIndex === primaryInputIndex && primary) {
        inputs.push(primary);
        inputInfos.push({ canvas: primary, inputIndex, originSlot, upstreamNode: up });
        continue;
      }
      const c = await renderNode(up, ctx, originSlot);
      if (!c) {
        if (up) {
          const placeholder = makePlaceholderCanvas();
          inputs.push(placeholder);
          inputInfos.push({ canvas: placeholder, inputIndex, originSlot, upstreamNode: up });
          continue;
        }
        ctx.cache.set(sig, primary);
        ctx.visited.delete(node.id);
        return primary;
      }
      inputs.push(c);
      inputInfos.push({ canvas: c, inputIndex, originSlot, upstreamNode: up });
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
    const octx = out.getContext("2d");
    if (!octx) { ctx.visited.delete(node.id); return null; }
    octx.drawImage(inputs[0], 0, 0);

    let adapted: HTMLCanvasElement | void | null | undefined = out;
    try {
      adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs, inputInfos, outputSlot, tick: ctx.tick, renderInputAt });
    } catch (err) {
      // A failing adapter must never bubble up and break the whole preview chain.
      // Fall back to the first input (passthrough) so downstream nodes still render.
      console.warn(`[ImageOps] adapter '${(adapter as any)?.name ?? node.comfyClass}' threw — passthrough first input.`, err);
      adapted = inputs[0] ?? out;
    }
    const result = adapted instanceof HTMLCanvasElement ? adapted : out;

    ctx.cache.set(sig, result);
    if (ctx.tick === 0) {
      const persistent = getPersistentStaticCache(node);
      persistent.clear();
      persistent.set(sig, result);
      pruneStaticCache(persistent);
    }
    ctx.visited.delete(node.id);
    return result;
  }

  function signature(node: ComfyNode, tick: number, outputSlot: number | null): string {
    const parts: (string | number)[] = [node.id, String(node.comfyClass ?? ""), tick, outputSlot ?? -1];
    for (const input of (node.inputs ?? [])) {
      const inp = input as any;
      const linkId = inp?.link ?? null;
      parts.push(`in:${inp?.name ?? ""}:${linkId ?? "null"}`);
      // For connected STRING inputs, fold the upstream widget value into the signature
      // so that typing in a connected node (e.g. Text Multiline) invalidates the cache.
      if (inp?.type === "STRING" && linkId != null) {
        const linkData = (node as any)?.graph?.links?.[linkId];
        if (linkData) {
          const upNode = (node as any)?.graph?.getNodeById?.(linkData.origin_id);
          const upWidget = ((upNode as any)?.widgets ?? []).find((w: any) => typeof w?.value === "string");
          if (upWidget) {
            const v = String(upWidget.value);
            parts.push(v.length > 120 ? `cstr:${v.length}:${hashString(v)}` : `cstr:${v}`);
          }
        }
      }
    }
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
