import { isImageOpsClass } from "../shared/classes.js";
import { ensureBitmap, ensureImageElement, ensureVideoFrameCanvas, fitWithinMaxSize, makeViewUrl, renderImageSourceToCanvas } from "../source.js";
import { detectSource, getInputOriginSlot, getUpstreamNode } from "./graph.js";
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
    if (isImageOpsClass(node?.comfyClass)) return null;
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
  const STATIC_CACHE_MAX = 16;
  function getPersistentStaticCache(node) {
    var _a;
    node.__imageops_media ?? (node.__imageops_media = {});
    (_a = node.__imageops_media).staticRenderCache ?? (_a.staticRenderCache = /* @__PURE__ */ new Map());
    return node.__imageops_media.staticRenderCache;
  }
  function pruneStaticCache(cache) {
    while (cache.size > STATIC_CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest !== void 0) cache.delete(oldest);
    }
  }
  async function render(node, tick = 0, outputSlot = null, canvasSizeOverride) {
    const ctx = { api, canvasSize: canvasSizeOverride ?? canvasSize, tick, cache: /* @__PURE__ */ new Map(), visited: /* @__PURE__ */ new Set() };
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
    if (ctx.tick === 0) {
      const persistent = getPersistentStaticCache(node);
      const cached = persistent.get(sig);
      if (cached) {
        ctx.cache.set(sig, cached);
        ctx.visited.delete(node.id);
        return cached;
      }
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
        c = await ensureVideoFrameCanvas(node, url, ctx.canvasSize, ctx.tick);
      }
      if (!c) {
        ctx.visited.delete(node.id);
        return null;
      }
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
    const adapterInputIndexes = adapter ? typeof adapter.inputIndexes === "function" ? adapter.inputIndexes(node) : adapter.inputIndexes ?? [] : [];
    const resolvedIndexes = adapterInputIndexes.length > 0 ? adapterInputIndexes : [...Array(adapter ? typeof adapter.inputs === "function" ? adapter.inputs(node) : adapter.inputs ?? 1 : 1).keys()];
    if (!adapter) {
      const primaryInputIndex2 = resolvedIndexes[0] ?? 0;
      const primary2 = await renderNode(getUpstreamNode(node, primaryInputIndex2), ctx, getInputOriginSlot(node, primaryInputIndex2));
      ctx.visited.delete(node.id);
      return primary2;
    }
    const renderInputAt = async (inputInfo, tickOverride) => {
      if (!inputInfo.upstreamNode) return inputInfo.canvas ?? null;
      const localCtx = {
        api,
        canvasSize: ctx.canvasSize,
        tick: tickOverride,
        cache: /* @__PURE__ */ new Map(),
        visited: /* @__PURE__ */ new Set([node.id])
      };
      return await renderNode(inputInfo.upstreamNode, localCtx, inputInfo.originSlot ?? null);
    };
    if (resolvedIndexes.length === 0) {
      const out2 = document.createElement("canvas");
      out2.width = 1;
      out2.height = 1;
      const octx2 = out2.getContext("2d");
      if (!octx2) {
        ctx.visited.delete(node.id);
        return null;
      }
      let adapted2 = out2;
      try {
        adapted2 = await adapter.apply({ node, ctx: octx2, canvasSize: ctx.canvasSize, inputs: [], tick: ctx.tick, renderInputAt });
      } catch (err) {
        console.warn(`[ImageOps] adapter '${adapter?.name ?? node.comfyClass}' threw \u2014 falling back to placeholder.`, err);
        adapted2 = out2;
      }
      const result2 = adapted2 instanceof HTMLCanvasElement ? adapted2 : out2;
      ctx.cache.set(sig, result2);
      if (ctx.tick === 0) {
        const persistent = getPersistentStaticCache(node);
        persistent.clear();
        persistent.set(sig, result2);
        pruneStaticCache(persistent);
      }
      ctx.visited.delete(node.id);
      return result2;
    }
    const primaryInputIndex = resolvedIndexes[0] ?? 0;
    const primary = await renderNode(getUpstreamNode(node, primaryInputIndex), ctx, getInputOriginSlot(node, primaryInputIndex));
    if (resolvedIndexes.length > 1) {
      const primaryUp = getUpstreamNode(node, primaryInputIndex);
      const primaryVid = primaryUp?.__imageops_media?.videoEl;
      if (primaryVid && primaryVid.readyState >= 2 && Number.isFinite(primaryVid.currentTime)) {
        const refTime = primaryVid.currentTime;
        for (let si = 1; si < resolvedIndexes.length; si++) {
          const secUp = getUpstreamNode(node, resolvedIndexes[si]);
          const secVid = secUp?.__imageops_media?.videoEl;
          if (secVid && secVid !== primaryVid && secVid.readyState >= 2 && Number.isFinite(secVid.duration) && secVid.duration > 0) {
            const target = refTime % secVid.duration;
            if (Math.abs(secVid.currentTime - target) > 0.05) {
              try {
                secVid.currentTime = target;
              } catch {
              }
            }
          }
        }
      }
    }
    if (!primary) {
      ctx.visited.delete(node.id);
      return null;
    }
    const inputs = [];
    const inputInfos = [];
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
    let adapted = out;
    try {
      adapted = await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs, inputInfos, outputSlot, tick: ctx.tick, renderInputAt });
    } catch (err) {
      console.warn(`[ImageOps] adapter '${adapter?.name ?? node.comfyClass}' threw \u2014 passthrough first input.`, err);
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
  function signature(node, tick, outputSlot) {
    const parts = [node.id, String(node.comfyClass ?? ""), tick, outputSlot ?? -1];
    for (const input of node.inputs ?? []) {
      const inp = input;
      const linkId = inp?.link ?? null;
      parts.push(`in:${inp?.name ?? ""}:${linkId ?? "null"}`);
      if (inp?.type === "STRING" && linkId != null) {
        const linkData = node?.graph?.links?.[linkId];
        if (linkData) {
          const upNode = node?.graph?.getNodeById?.(linkData.origin_id);
          const upWidget = (upNode?.widgets ?? []).find((w) => typeof w?.value === "string");
          if (upWidget) {
            const v = String(upWidget.value);
            parts.push(v.length > 120 ? `cstr:${v.length}:${hashString(v)}` : `cstr:${v}`);
          }
        }
      }
    }
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
function getImageData(ctx, W, H) {
  return ctx.getImageData(0, 0, W, H);
}
function putImageData(ctx, img) {
  ctx.putImageData(img, 0, 0);
}
function getCanvasDimensions(ctx) {
  return {
    width: Math.max(1, ctx.canvas.width || 1),
    height: Math.max(1, ctx.canvas.height || 1)
  };
}
function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}
function applyEffectToCanvas(source, effect) {
  const output = makeCanvas(source.width || 1, source.height || 1);
  const copyCtx = output.getContext("2d", { willReadFrequently: true });
  copyCtx.drawImage(source, 0, 0, output.width, output.height);
  const octx = output.getContext("2d", { willReadFrequently: true });
  const result = effect(octx, output.width, output.height);
  return result instanceof HTMLCanvasElement ? result : output;
}
const canvasFieldCache = /* @__PURE__ */ new WeakMap();
export {
  applyEffectToCanvas,
  buildRenderer,
  canvasFieldCache,
  getCanvasDimensions,
  getImageData,
  makeCanvas,
  putImageData
};
