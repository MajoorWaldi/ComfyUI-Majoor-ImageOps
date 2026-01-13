import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { buildRenderer } from "./renderer.js";
import { buildAdapterRegistry } from "./registry.js";
import { detectSourceUpstream, isGraphTooLarge, findDependents } from "./graph.js";
import { attachProgressBus } from "./progress.js";
import { getPreviewConfig } from "./config.js";
import { initOpsConstants } from "./constants.js";

console.info("[ImageOps] LivePreview v6 loaded");

const EXT_NAME = "ImageOps.LivePreview.v6";

// Only ImageOps nodes receive a preview widget (single module).
const IMAGEOPS_CLASSES = new Set([
  "ImageOpsLoadImage",
  "ImageOpsColorCorrect",
  "ImageOpsBlur",
  "ImageOpsTransform",
  "ImageOpsGradeLevels",
  "ImageOpsHueSat",
  "ImageOpsInvert",
  "ImageOpsClamp",
  "ImageOpsSharpen",
  "ImageOpsEdgeDetect",
  "ImageOpsMerge",
  "ImageOpsDilateErode",
  "ImageOpsGlow",
  "ImageOpsCropReformat",
  "ImageOpsLumaKey",
  "ImageOpsRotoMask",
  "ImageOpsPreview",
]);

function ensureState(node) {
  node.__imageops_state ??= {
    hooked: false,
    canvas: null,
    info: null,
    progressWrap: null,
    progressBar: null,
    rafId: null,
    debounceTimer: null,
    lastKey: null,
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
