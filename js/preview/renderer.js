import { getInputLink, getUpstreamNode, detectSource } from "./graph.js";
import { makeViewUrl, ensureBitmap, ensureImageElement, ensureVideoFrameCanvas, fitWithinMaxSize, renderImageSourceToCanvas } from "./source.js";
function buildRenderer({ api, registry, canvasSize }) {
  const MAX_RECURSION = 64;
  function hashString(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }
  function getNativePreviewElement(node) {
    const imgs = node?.imgs;
    if (!Array.isArray(imgs) || imgs.length === 0) return null;
    const index = typeof node.imageIndex === "number" ? node.imageIndex : imgs.length - 1;
    return imgs[Math.max(0, Math.min(imgs.length - 1, index))] ?? imgs[imgs.length - 1] ?? null;
  }
  async function renderFromNativePreview(node) {
    if (String(node?.comfyClass ?? "").startsWith("ImageOps")) return null;
    const media = getNativePreviewElement(node);
    if (!media) return null;
    if (media instanceof HTMLVideoElement) {
      if (media.readyState < 2) {
        try {
          await media.play();
        } catch {
        }
        if (media.readyState < 2) return null;
      }
      const dims = fitWithinMaxSize(media.videoWidth || 1, media.videoHeight || 1, canvasSize);
      return renderImageSourceToCanvas(node, media, dims.width, dims.height, "nativeCanvas");
    }
    if (media instanceof HTMLImageElement) {
      if (!media.complete) {
        try {
          await media.decode?.();
        } catch {
        }
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
  function makePlaceholderCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    return canvas;
  }
  async function render(node, tick = 0, outputSlot = null) {
    const ctx = { api, canvasSize, tick, cache: /* @__PURE__ */ new Map(), visited: /* @__PURE__ */ new Set() };
    const canvas = await renderNode(node, ctx, outputSlot);
    return { canvas };
  }
  async function renderNode(node, ctx, outputSlot) {
    if (!node) return null;
    if (ctx.visited.has(node.id)) return null;
    if (ctx.visited.size > MAX_RECURSION) return null;
    ctx.visited.add(node.id);
    const sig = signature(node, ctx.tick, outputSlot);
    if (ctx.cache.has(sig)) {
      ctx.visited.delete(node.id);
      return ctx.cache.get(sig);
    }
    const src = detectSource(node);
    if (src) {
      const url = makeViewUrl(ctx.api, src.value);
      if (!url) {
        ctx.visited.delete(node.id);
        return null;
      }
      let c = null;
      if (src.kind === "image" && src.animated) {
        const img = await ensureImageElement(node, url);
        if (!img) {
          ctx.visited.delete(node.id);
          return null;
        }
        const dims = fitWithinMaxSize(img.naturalWidth || img.width || 1, img.naturalHeight || img.height || 1, ctx.canvasSize);
        c = renderImageSourceToCanvas(node, img, dims.width, dims.height, "animatedImageCanvas");
      } else if (src.kind === "image") {
        const bmp = await ensureBitmap(node, url);
        if (!bmp) {
          ctx.visited.delete(node.id);
          return null;
        }
        const dims = fitWithinMaxSize(bmp.width || 1, bmp.height || 1, ctx.canvasSize);
        c = renderImageSourceToCanvas(node, bmp, dims.width, dims.height, "imageCanvas");
      } else {
        c = await ensureVideoFrameCanvas(node, url, ctx.canvasSize);
      }
      if (!c) {
        ctx.visited.delete(node.id);
        return null;
      }
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
    const adapterInputIndexes = adapter ? typeof adapter.inputIndexes === "function" ? adapter.inputIndexes(node) : adapter.inputIndexes ?? [] : [];
    const resolvedIndexes = adapterInputIndexes.length > 0 ? adapterInputIndexes : [...Array(adapter ? typeof adapter.inputs === "function" ? adapter.inputs(node) : adapter.inputs ?? 1 : 1).keys()];
    if (!adapter) {
      const primaryInputIndex2 = resolvedIndexes[0] ?? 0;
      const link = getInputLink(node, primaryInputIndex2);
      const primary2 = await renderNode(getUpstreamNode(node, primaryInputIndex2), ctx, link?.origin_slot ?? link?.originSlot ?? null);
      ctx.visited.delete(node.id);
      return primary2;
    }
    if (resolvedIndexes.length === 0) {
      const out2 = document.createElement("canvas");
      out2.width = 1;
      out2.height = 1;
      const octx2 = out2.getContext("2d");
      if (!octx2) {
        ctx.visited.delete(node.id);
        return null;
      }
      const adapted2 = await adapter.apply({ node, ctx: octx2, canvasSize: ctx.canvasSize, inputs: [], tick: ctx.tick });
      const result2 = adapted2 instanceof HTMLCanvasElement ? adapted2 : out2;
      ctx.cache.set(sig, result2);
      ctx.visited.delete(node.id);
      return result2;
    }
    const primaryInputIndex = resolvedIndexes[0] ?? 0;
    const primaryLink = getInputLink(node, primaryInputIndex);
    const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx, primaryLink?.origin_slot ?? primaryLink?.originSlot ?? null);
    if (!primary) {
      ctx.visited.delete(node.id);
      return null;
    }
    const inputs = [];
    const inputInfos = [];
    for (let i = 0; i < resolvedIndexes.length; i++) {
      const inputIndex = resolvedIndexes[i];
      const up = getUpstreamNode(node, inputIndex);
      const link = getInputLink(node, inputIndex);
      const originSlot = link?.origin_slot ?? link?.originSlot ?? null;
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
    if (inputs.length === 0) {
      ctx.cache.set(sig, primary);
      ctx.visited.delete(node.id);
      return primary;
    }
    const out = document.createElement("canvas");
    out.width = primary.width;
    out.height = primary.height;
    const octx = out.getContext("2d");
    if (!octx) {
      ctx.visited.delete(node.id);
      return null;
    }
    octx.drawImage(inputs[0], 0, 0);
    const adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs, inputInfos, outputSlot, tick: ctx.tick });
    const result = adapted instanceof HTMLCanvasElement ? adapted : out;
    ctx.cache.set(sig, result);
    ctx.visited.delete(node.id);
    return result;
  }
  function signature(node, tick, outputSlot) {
    const parts = [node.id, String(node.comfyClass ?? ""), tick, outputSlot ?? -1];
    for (const w of node.widgets ?? []) {
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
export {
  buildRenderer
};
