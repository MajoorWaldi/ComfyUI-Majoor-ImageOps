import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { buildRenderer } from "./renderer.js";
import { buildAdapterRegistry } from "./registry.js";
import { detectSourceUpstream, isGraphTooLarge, findDependents } from "./graph.js";
import { attachProgressBus } from "./progress.js";
import { getPreviewConfig } from "./config.js";
import { getOpsConstants, initOpsConstants } from "./constants.js";
import { computeScopes, drawHistogram, drawWaveform, drawRgbWaveform, drawVectorscope } from "./scopes.js";

console.info("[ImageOps] LivePreview v6 loaded");

const EXT_NAME = "ImageOps.LivePreview.v6";

// Only ImageOps nodes receive a preview widget (single module).
const IMAGEOPS_CLASSES = new Set([
  "ImageOpsColorAjust",
  "ImageOpsBlur",
  "ImageOpsTransform",
  "ImageOpsInvert",
  "ImageOpsClamp",
  "ImageOpsMerge",
  "ImageOpsPreview",
]);

function isPreviewNode(node) {
  return String(node?.comfyClass ?? "") === "ImageOpsPreview";
}

function ensureState(node) {
  node.__imageops_state ??= {
    hooked: false,
    canvas: null,
    scopes: null,
    abCanvas: null,
    abEnabled: false,
    wipe: 0.5,
    overlay: "none",
    showHistogram: true,
    showWaveform: true,
    waveformMode: "luma",
    showVectorscope: false,
    info: null,
    progressWrap: null,
    progressBar: null,
    rafId: null,
    debounceTimer: null,
    lastKey: null,
    isPreview: isPreviewNode(node),
  };
  return node.__imageops_state;
}

function stopRAF(st) {
  if (st?.rafId) {
    cancelAnimationFrame(st.rafId);
    st.rafId = null;
  }
}

function ensurePreviewWidget(node, progress, canvasSize) {
  if (!IMAGEOPS_CLASSES.has(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;

  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.boxSizing = "border-box";
  root.style.padding = "6px";

  const canvas = document.createElement("canvas");
  canvas.width = canvasSize;
  canvas.height = canvasSize;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.display = "block";
  canvas.style.borderRadius = "8px";
  canvas.style.background = "rgba(0,0,0,0.35)";
  canvas.style.border = "1px solid rgba(255,255,255,0.08)";

  // Preview Pro UI (scopes/overlays/A-B) only for the Output preview node.
  let histCanvas = null;
  let waveCanvas = null;
  let vecCanvas = null;
  if (st.isPreview) {
    const controls = document.createElement("div");
    controls.style.display = "flex";
    controls.style.gap = "8px";
    controls.style.flexWrap = "wrap";
    controls.style.alignItems = "center";
    controls.style.marginTop = "6px";
    controls.style.fontSize = "11px";
    controls.style.opacity = "0.9";

    function mkCheck(label, initial, onChange) {
      const wrap = document.createElement("label");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "4px";
      const inp = document.createElement("input");
      inp.type = "checkbox";
      inp.checked = !!initial;
      inp.addEventListener("change", () => onChange(!!inp.checked));
      const txt = document.createElement("span");
      txt.textContent = label;
      wrap.appendChild(inp);
      wrap.appendChild(txt);
      return wrap;
    }

    function mkButton(label, onClick) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.fontSize = "11px";
      b.style.padding = "2px 6px";
      b.style.borderRadius = "6px";
      b.style.border = "1px solid rgba(255,255,255,0.18)";
      b.style.background = "rgba(255,255,255,0.06)";
      b.style.color = "inherit";
      b.addEventListener("click", onClick);
      return b;
    }

    function mkSelect(label, options, initial, onChange) {
      const wrap = document.createElement("label");
      wrap.style.display = "inline-flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "4px";
      const txt = document.createElement("span");
      txt.textContent = label;
      const sel = document.createElement("select");
      sel.style.fontSize = "11px";
      sel.style.borderRadius = "6px";
      sel.style.border = "1px solid rgba(255,255,255,0.18)";
      sel.style.background = "rgba(0,0,0,0.25)";
      sel.style.color = "inherit";
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      sel.value = initial;
      sel.addEventListener("change", () => onChange(String(sel.value)));
      wrap.appendChild(txt);
      wrap.appendChild(sel);
      return wrap;
    }

    controls.appendChild(mkCheck("Histogram", st.showHistogram, (v) => { st.showHistogram = v; }));
    controls.appendChild(mkCheck("Waveform", st.showWaveform, (v) => { st.showWaveform = v; }));
    controls.appendChild(mkSelect("Wave", [
      { value: "luma", label: "Luma" },
      { value: "rgb", label: "RGB" },
    ], st.waveformMode, (v) => { st.waveformMode = v; }));
    controls.appendChild(mkCheck("Vectorscope", st.showVectorscope, (v) => { st.showVectorscope = v; }));
    controls.appendChild(mkSelect("Overlay", [
      { value: "none", label: "None" },
      { value: "zebra", label: "Zebra" },
      { value: "falsecolor", label: "FalseColor" },
    ], st.overlay, (v) => { st.overlay = v; }));
    controls.appendChild(mkButton("Freeze A", () => {
      try {
        st.abCanvas = document.createElement("canvas");
        st.abCanvas.width = canvas.width;
        st.abCanvas.height = canvas.height;
        st.abCanvas.getContext("2d").drawImage(canvas, 0, 0);
        st.abEnabled = true;
      } catch {}
    }));
    controls.appendChild(mkButton("Clear A", () => { st.abCanvas = null; st.abEnabled = false; }));

    const wipeWrap = document.createElement("label");
    wipeWrap.style.display = "inline-flex";
    wipeWrap.style.alignItems = "center";
    wipeWrap.style.gap = "4px";
    const wipeTxt = document.createElement("span");
    wipeTxt.textContent = "Wipe";
    const wipe = document.createElement("input");
    wipe.type = "range";
    wipe.min = "0";
    wipe.max = "1";
    wipe.step = "0.01";
    wipe.value = String(st.wipe ?? 0.5);
    wipe.addEventListener("input", () => { st.wipe = parseFloat(wipe.value); });
    wipeWrap.appendChild(wipeTxt);
    wipeWrap.appendChild(wipe);
    controls.appendChild(wipeWrap);

    const scopes = document.createElement("div");
    scopes.style.display = "grid";
    scopes.style.gridTemplateColumns = "1fr 1fr 96px";
    scopes.style.gap = "6px";
    scopes.style.marginTop = "6px";

    function mkScopeCanvas(h) {
      const c = document.createElement("canvas");
      c.width = 256;
      c.height = h;
      c.style.width = "100%";
      c.style.height = "64px";
      c.style.borderRadius = "6px";
      c.style.background = "rgba(0,0,0,0.22)";
      c.style.border = "1px solid rgba(255,255,255,0.08)";
      return c;
    }

    histCanvas = mkScopeCanvas(64);
    waveCanvas = mkScopeCanvas(64);
    vecCanvas = document.createElement("canvas");
    vecCanvas.width = 96;
    vecCanvas.height = 96;
    vecCanvas.style.width = "96px";
    vecCanvas.style.height = "96px";
    vecCanvas.style.borderRadius = "6px";
    vecCanvas.style.background = "rgba(0,0,0,0.22)";
    vecCanvas.style.border = "1px solid rgba(255,255,255,0.08)";

    scopes.appendChild(histCanvas);
    scopes.appendChild(waveCanvas);
    scopes.appendChild(vecCanvas);

    root.appendChild(controls);
    root.appendChild(scopes);
  }

  const info = document.createElement("div");
  info.style.marginTop = "6px";
  info.style.fontSize = "11px";
  info.style.opacity = "0.8";
  info.textContent = "Live preview (no queue)";

  const progressWrap = document.createElement("div");
  progressWrap.style.marginTop = "6px";
  progressWrap.style.height = "6px";
  progressWrap.style.borderRadius = "999px";
  progressWrap.style.background = "rgba(255,255,255,0.12)";
  progressWrap.style.overflow = "hidden";
  progressWrap.style.display = "none";

  const progressBar = document.createElement("div");
  progressBar.style.height = "100%";
  progressBar.style.width = "0%";
  progressBar.style.borderRadius = "999px";
  progressBar.style.background = "rgba(255,255,255,0.55)";
  progressWrap.appendChild(progressBar);

  root.appendChild(canvas);
  root.appendChild(info);
  root.appendChild(progressWrap);

  node.addDOMWidget("preview", "ImageOpsPreview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 280,
  });

  // Force the preview widget to the top (before sliders), like KayTool.
  try {
    const widgets = node.widgets ?? [];
    const idx = widgets.findIndex(w => w?.name === "preview");
    if (idx > 0) {
      const [w] = widgets.splice(idx, 1);
      widgets.unshift(w);
    }
  } catch {}

  st.canvas = canvas;
  st.scopes = (st.isPreview && histCanvas && waveCanvas && vecCanvas) ? { histCanvas, waveCanvas, vecCanvas } : null;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;

  try {
    node.setSize?.([Math.max(node.size?.[0] ?? 360, 360), Math.max(node.size?.[1] ?? 420, 420)]);
    node.resizable = true;
  } catch {}

  // hook progress updates
  if (progress) {
    progress.registerNodeWidget(node, progressWrap, progressBar);
  }

  return st;
}

function schedule(node, fn, delayMs = 120) {
  const st = ensureState(node);
  if (st.debounceTimer) clearTimeout(st.debounceTimer);
  st.debounceTimer = setTimeout(fn, delayMs);
}

function blit(st, imgCanvas, canvasSize) {
  const ctx = st.canvas.getContext("2d");
  st.canvas.width = canvasSize;
  st.canvas.height = canvasSize;
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  ctx.drawImage(imgCanvas, 0, 0);

  if (!st.isPreview) return;

  // A/B compare (wipe B over A)
  if (st.abEnabled && st.abCanvas) {
    try {
      const w = Math.max(0, Math.min(1, st.wipe ?? 0.5));
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, canvasSize * w, canvasSize);
      ctx.clip();
      ctx.drawImage(st.abCanvas, 0, 0);
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.moveTo(canvasSize * w + 0.5, 0);
      ctx.lineTo(canvasSize * w + 0.5, canvasSize);
      ctx.stroke();
    } catch {}
  }

  // Overlays
  if (st.overlay && st.overlay !== "none") {
    try {
      const img = ctx.getImageData(0, 0, canvasSize, canvasSize);
      const d = img.data;
      const { luma_weights: LW } = getOpsConstants();
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const i = (y * canvasSize + x) * 4;
          const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
          const Y = LW[0] * r + LW[1] * g + LW[2] * b;
          if (st.overlay === "zebra") {
            if (Y > 0.95 && ((x + y) % 10) < 5) {
              d[i] = 255; d[i + 1] = 255; d[i + 2] = 255;
            }
          } else if (st.overlay === "falsecolor") {
            let cr = 0, cg = 0, cb = 0;
            if (Y < 0.1) { cr = 0; cg = 0; cb = 80; }
            else if (Y < 0.25) { cr = 0; cg = 80; cb = 255; }
            else if (Y < 0.45) { cr = 0; cg = 200; cb = 80; }
            else if (Y < 0.65) { cr = 220; cg = 220; cb = 0; }
            else if (Y < 0.85) { cr = 255; cg = 120; cb = 0; }
            else { cr = 255; cg = 0; cb = 0; }
            d[i] = cr; d[i + 1] = cg; d[i + 2] = cb;
          }
        }
      }
      ctx.putImageData(img, 0, 0);
    } catch {}
  }

  // Scopes (downsampled for perf)
  if (st.scopes && (st.showHistogram || st.showWaveform || st.showVectorscope)) {
    try {
      const img = ctx.getImageData(0, 0, canvasSize, canvasSize);
      const { luma_weights: LW } = getOpsConstants();
      const s = computeScopes(img, {
        lumaWeights: LW,
        sampleStep: canvasSize >= 768 ? 4 : 2,
        waveWidth: st.scopes.histCanvas.width,
        waveHeight: st.scopes.histCanvas.height,
        vectorscopeSize: st.scopes.vecCanvas.width,
      });
      if (st.showHistogram) {
        drawHistogram(st.scopes.histCanvas.getContext("2d"), st.scopes.histCanvas.width, st.scopes.histCanvas.height, s.hist);
      } else {
        st.scopes.histCanvas.getContext("2d").clearRect(0, 0, st.scopes.histCanvas.width, st.scopes.histCanvas.height);
      }
      if (st.showWaveform) {
        const wctx = st.scopes.waveCanvas.getContext("2d");
        if (st.waveformMode === "rgb") {
          drawRgbWaveform(wctx, st.scopes.waveCanvas.width, st.scopes.waveCanvas.height, s.waveformR, s.waveformG, s.waveformB, s.waveW, s.waveH);
        } else {
          drawWaveform(wctx, st.scopes.waveCanvas.width, st.scopes.waveCanvas.height, s.waveform, s.waveW, s.waveH);
        }
      } else {
        st.scopes.waveCanvas.getContext("2d").clearRect(0, 0, st.scopes.waveCanvas.width, st.scopes.waveCanvas.height);
      }
      if (st.showVectorscope) {
        drawVectorscope(st.scopes.vecCanvas.getContext("2d"), st.scopes.vecCanvas.width, s.vectorscope, s.vecSize);
      } else {
        st.scopes.vecCanvas.getContext("2d").clearRect(0, 0, st.scopes.vecCanvas.width, st.scopes.vecCanvas.height);
      }
    } catch {}
  }
}

export function registerImageOpsLivePreview() {
  initOpsConstants();
  const cfg = getPreviewConfig();
  const canvasSize = cfg.canvasSize;
  const registry = buildAdapterRegistry();
  const renderer = buildRenderer({ api, registry, canvasSize });
  const progress = attachProgressBus(api);

  function renderNode(node, tick = 0) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;

    if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
      st.info.textContent = "Live preview disabled: graph too large";
      stopRAF(st);
      return;
    }

    renderer.render(node, tick).then(result => {
      if (!result?.canvas) {
        st.info.textContent = "Live preview: connect a supported loader/chain";
        return;
      }
      blit(st, result.canvas, canvasSize);
      const src = detectSourceUpstream(node);
      if (src?.kind) {
        st.info.textContent = `Live preview (${src.kind})`;
      } else {
        st.info.textContent = "Live preview (no queue)";
      }
    }).catch(err => {
      st.info.textContent = "Live preview error (check console)";
      console.warn("[ImageOps] render error", err);
    });
  }

  function startLoopIfVideo(node) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;

    const src = detectSourceUpstream(node);
    if (!src || src.kind !== "video") {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }

    let tick = 0;
    const loop = () => {
      tick++;
      renderNode(node, tick);
      st.rafId = requestAnimationFrame(loop);
    };
    stopRAF(st);
    st.rafId = requestAnimationFrame(loop);
  }

  function refreshDependents(changedNode) {
    const deps = findDependents(changedNode, (n) => IMAGEOPS_CLASSES.has(n.comfyClass));
    for (const n of deps) startLoopIfVideo(n);
  }

  function hookNode(node) {
    const st = ensureState(node);
    if (st.hooked) return;
    st.hooked = true;

    if (IMAGEOPS_CLASSES.has(node.comfyClass)) {
      ensurePreviewWidget(node, progress, canvasSize);
      startLoopIfVideo(node);
    }

    // Any widget change: refresh dependents; for ImageOps nodes refresh self.
    for (const w of (node.widgets ?? [])) {
      const orig = w.callback;
      w.callback = function () {
        const r = orig?.apply(this, arguments);
        schedule(node, () => {
          if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
          refreshDependents(node);
        }, cfg.debounceMs);
        return r;
      };
    }

    // Connection changes
    const chainCb = (prop) => {
      const orig = node[prop];
      node[prop] = function () {
        const r = orig?.apply(this, arguments);
        if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
        return r;
      };
    };
    chainCb("onConnectionsChange");
    chainCb("onConfigure");
  }

  app.registerExtension({
    name: EXT_NAME,
    async beforeRegisterNodeDef(nodeType, nodeData) {
      nodeType.prototype.onNodeCreated = (function (orig) {
        return function () {
          orig?.apply(this, arguments);
          hookNode(this);
        };
      })(nodeType.prototype.onNodeCreated);
    },
  });
}
