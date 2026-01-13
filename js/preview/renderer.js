// Renderer (recursive, supports interop) (v6)
import { getUpstreamNode, detectSource } from "./graph.js";
import { makeViewUrl, ensureBitmap, ensureVideoFrameCanvas } from "./source.js";

export function buildRenderer({ api, registry, canvasSize }) {
  const MAX_RECURSION = 64;

  async function render(node, tick = 0) {
    const ctx = { api, canvasSize, tick, cache: new Map(), visited: new Set() };
    const canvas = await renderNode(node, ctx);
    return { canvas };
  }

  async function renderNode(node, ctx) {
    if (!node) return null;
    if (ctx.visited.has(node.id)) return null;
    if (ctx.visited.size > MAX_RECURSION) return null;
    ctx.visited.add(node.id);

    const sig = signature(node, ctx.tick);
    if (ctx.cache.has(sig)) {
      ctx.visited.delete(node.id);
      return ctx.cache.get(sig);
    }

    // source node?
    const src = detectSource(node);
    if (src) {
      const url = makeViewUrl(ctx.api, src.value);
      if (!url) { ctx.visited.delete(node.id); return null; }
      const c = document.createElement("canvas");
      c.width = ctx.canvasSize;
      c.height = ctx.canvasSize;
      const cctx = c.getContext("2d");

      if (src.kind === "image") {
        const bmp = await ensureBitmap(node, url);
        if (!bmp) { ctx.visited.delete(node.id); return null; }
        // fit
        drawFitBitmap(cctx, ctx.canvasSize, ctx.canvasSize, bmp);
      } else {
        const frame = await ensureVideoFrameCanvas(node, url, ctx.canvasSize);
        if (frame) cctx.drawImage(frame, 0, 0);
      }

      ctx.cache.set(sig, c);
      ctx.visited.delete(node.id);
      return c;
    }

    const adapter = registry.pick(node);
    if (!adapter) { ctx.visited.delete(node.id); return null; }

    // gather inputs
    const inputs = [];
    const inCount = (typeof adapter.inputs === "function") ? adapter.inputs(node) : (adapter.inputs ?? 1);
    for (let i = 0; i < inCount; i++) {
      const up = getUpstreamNode(node, i);
      const c = await renderNode(up, ctx);
      if (!c) { ctx.visited.delete(node.id); return null; }
      inputs.push(c);
    }

    // work canvas is copy of first input
    if (!inputs[0]) { ctx.visited.delete(node.id); return null; }
    const out = document.createElement("canvas");
    out.width = ctx.canvasSize;
    out.height = ctx.canvasSize;
    const octx = out.getContext("2d");
    octx.drawImage(inputs[0], 0, 0);

    await adapter.apply({ node, ctx: octx, canvasSize: ctx.canvasSize, inputs });

    ctx.cache.set(sig, out);
    ctx.visited.delete(node.id);
    return out;
  }

  function signature(node, tick) {
    const parts = [node.id, String(node.comfyClass ?? ""), tick];
    for (const w of (node.widgets ?? [])) {
      const v = w?.value;
      if (v == null) continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        parts.push(`${w.name}:${v}`);
      }
    }
    return parts.join("|");
  }

  function drawFitBitmap(ctx, W, H, bmp) {
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,W,H);
    const s = Math.min(W / bmp.width, H / bmp.height);
    const dw = Math.max(1, Math.floor(bmp.width * s));
    const dh = Math.max(1, Math.floor(bmp.height * s));
    const dx = Math.floor((W - dw) / 2);
    const dy = Math.floor((H - dh) / 2);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(bmp, dx, dy, dw, dh);
  }

  return { render };
}
