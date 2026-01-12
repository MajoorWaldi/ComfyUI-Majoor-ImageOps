import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

/**
 * ComfyUI-ImageOps — Live Preview + Interop (v5.1)
 *
 * What this does:
 * - Adds an embedded realtime preview CANVAS to ImageOps nodes (including ImageOps Preview Output).
 * - Does NOT modify any external nodes visually (no canvas injected into core/WAS/VHS).
 * - Can "interop" (best-effort) a subset of popular external nodes while previewing:
 *    - Core: ImageInvert, ImageSharpen, ImageBlend
 *    - WAS Node Suite: levels / hue-sat / blend-ish nodes via name + widget heuristics
 *
 * Notes:
 * - Frontend-only look-dev (no queue). Backend execution unchanged.
 * - Video sources are supported by sampling frames from a <video> element.
 */

console.info("[ImageOps] LivePreview v5.1 loaded");

// ---------------------------
// Config
// ---------------------------
const EXT_NAME = "ImageOps.LivePreview";
const CANVAS_SIZE = 512;
const CANVAS_MIN_HEIGHT = 280;
const NODE_MIN_SIZE = 360;

const DEBOUNCE_DELAY_MS = 120;
const REFRESH_DELAY_MS = 10;
const CONNECTION_REFRESH_DELAY_MS = 80;

const MAX_GRAPH_NODES = 96;
const MAX_RECURSION = 64;

const IMAGE_EXTS = new Set(["png","jpg","jpeg","webp","bmp","gif","tif","tiff"]);
const VIDEO_EXTS = new Set(["mp4","mov","webm","mkv","avi","gif","webp"]);

// Only ImageOps nodes get a canvas widget.
const IMAGEOPS_NODES = new Set([
  "ImageOpsLoadImage",
  "ImageOpsColorCorrect",
  "ImageOpsBlur",
  "ImageOpsTransform",
  "ImageOpsRotoMask",
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
  "ImageOpsPreview",
]);

// External nodes we try to interop (best-effort)
const CORE_INTEROP = new Set(["ImageInvert","ImageSharpen","ImageBlend"]);
const VHS_PREFIX = "VHS_";

// ---------------------------
// Helpers
// ---------------------------
function clamp01(x){ return Math.max(0, Math.min(1, x)); }

function chainCallback(object, property, callback) {
  if (!object) return;
  const orig = object[property];
  object[property] = function () {
    const r = orig?.apply(this, arguments);
    try { callback?.apply(this, arguments); } catch (e) { console.warn(`[${EXT_NAME}] callback error`, e); }
    return r;
  };
}

function getWidget(node, name) {
  return node?.widgets?.find(w => w?.name === name) ?? null;
}

function getInputLink(node, inputIndex = 0) {
  try { return node?.getInputLink?.(inputIndex) ?? null; } catch { return null; }
}

function getUpstreamNode(node, inputIndex = 0) {
  const link = getInputLink(node, inputIndex);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  if (originId == null) return null;
  return node?.graph?.getNodeById?.(originId) ?? null;
}

function getInputIndexByName(node, name) {
  const inputs = node?.inputs ?? [];
  const target = String(name ?? "").toLowerCase();
  for (let i = 0; i < inputs.length; i++) {
    if (String(inputs[i]?.name ?? "").toLowerCase() === target) return i;
  }
  return -1;
}

function getUpstreamByName(node, name) {
  const idx = getInputIndexByName(node, name);
  if (idx < 0) return null;
  return getUpstreamNode(node, idx);
}

function getFileExtLower(s) {
  const m = String(s ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
  return m ? m[1] : "";
}

function looksLikeMediaValue(v) {
  if (v == null) return false;
  if (typeof v !== "string") return false;
  const ext = getFileExtLower(v);
  return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
}

function pickMediaWidget(node) {
  // Prefer explicit widget names used by common loaders
  const preferred = ["image", "video", "path", "filepath", "file", "filename", "input_video", "input_image"];
  for (const n of preferred) {
    const w = getWidget(node, n);
    if (w && looksLikeMediaValue(w.value)) return w;
  }
  // Otherwise search any widget that looks like a media filename
  for (const w of (node?.widgets ?? [])) {
    if (looksLikeMediaValue(w?.value)) return w;
  }
  return null;
}

function detectSource(node) {
  const w = pickMediaWidget(node);
  if (!w) return null;
  const ext = getFileExtLower(w.value);
  const kind = VIDEO_EXTS.has(ext) && !IMAGE_EXTS.has(ext) ? "video" : (VIDEO_EXTS.has(ext) ? "video" : "image");
  return { kind, widgetName: w.name, value: w.value };
}

function parseAnnotated(raw) {
  // Supports:
  //  - "foo.png [input]"
  //  - "sub/clip.mp4 [output]"
  //  - "sub\\clip.mp4"
  if (!raw) return { filename: null, subfolder: "", type: "input" };

  let s = String(raw);

  let type = "input";
  const mType = s.match(/\s*\[(input|output|temp)\]\s*$/i);
  if (mType) type = mType[1].toLowerCase();

  s = s.replace(/\s*\[(input|output|temp)\]\s*$/i, "");
  s = s.replace(/\\/g, "/");

  // If absolute path (C:/...), just take basename and assume input
  const abs = /^[a-zA-Z]:\//.test(s) || s.startsWith("//");
  if (abs) {
    const parts = s.split("/");
    return { filename: parts[parts.length - 1], subfolder: "", type: "input" };
  }

  const idx = s.lastIndexOf("/");
  if (idx >= 0) return { filename: s.slice(idx + 1), subfolder: s.slice(0, idx), type };
  return { filename: s, subfolder: "", type };
}

function viewURLForAnnotated(rawFilename) {
  const { filename, subfolder, type } = parseAnnotated(rawFilename);
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, type, subfolder });
  return api.apiURL(`/view?${qs.toString()}`);
}

// ---------------------------
// Per-node state
// ---------------------------
function ensureState(node) {
  node.__imageops_state ??= {
    canvas: null,
    info: null,
    progressWrap: null,
    progressBar: null,
    // image cache
    lastBitmap: null,
    lastBitmapURL: null,
    // video cache (per source node)
    videoEl: null,
    lastVideoURL: null,
    // scheduling
    rafId: null,
    lastKey: null,
    debounceTimer: null,
    hooked: false,
  };
  return node.__imageops_state;
}

function stopRAF(st) {
  if (st?.rafId) {
    cancelAnimationFrame(st.rafId);
    st.rafId = null;
  }
}

// ---------------------------
// Execution progress overlays (queue run)
// ---------------------------
const execState = {
  running: false,
  progressByNodeId: new Map(), // nodeId -> {value,max}
};

function setNodeProgress(nodeId, value, max) {
  execState.progressByNodeId.set(nodeId, { value, max });
}

function clearNodeProgress() {
  execState.progressByNodeId.clear();
}

function updateProgressWidgets() {
  const g = app.graph;
  const nodes = g?._nodes ?? [];
  for (const node of nodes) {
    const st = node?.__imageops_state;
    if (!st?.progressWrap || !st?.progressBar) continue;

    const p = execState.progressByNodeId.get(node.id);
    if (!p || !execState.running) {
      st.progressWrap.style.display = "none";
      st.progressBar.style.width = "0%";
      continue;
    }
    const pct = (p.max > 0) ? (p.value / p.max) : 0;
    st.progressWrap.style.display = "block";
    st.progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
  }
}

// Listen to server events (best-effort)
api.addEventListener("execution_start", () => {
  execState.running = true;
  clearNodeProgress();
  updateProgressWidgets();
});
api.addEventListener("execution_error", () => {
  execState.running = false;
  clearNodeProgress();
  updateProgressWidgets();
});
api.addEventListener("execution_end", () => {
  execState.running = false;
  clearNodeProgress();
  updateProgressWidgets();
});
api.addEventListener("progress", (e) => {
  const d = e?.detail ?? {};
  const nodeId = d.node ?? d.node_id ?? d.nodeId ?? null;
  if (nodeId != null) setNodeProgress(nodeId, d.value ?? 0, d.max ?? 0);
  updateProgressWidgets();
});

// ---------------------------
// Canvas widget injection (ImageOps nodes only)
// ---------------------------
function ensureCanvas(node) {
  if (!IMAGEOPS_NODES.has(node.comfyClass)) return null;
  const st = ensureState(node);
  if (st.canvas) return st;

  const root = document.createElement("div");
  root.style.width = "100%";
  root.style.boxSizing = "border-box";
  root.style.padding = "6px";

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
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

  // per-node progress bar
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

  // Roto UI (only for ImageOpsRotoMask)
  if (node.comfyClass === "ImageOpsRotoMask") {
    const bar = document.createElement("div");
    bar.style.display = "flex";
    bar.style.flexWrap = "wrap";
    bar.style.gap = "6px";
    bar.style.marginTop = "6px";
    bar.style.alignItems = "center";

    const mkBtn = (label) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.style.padding = "4px 8px";
      b.style.fontSize = "11px";
      return b;
    };

    const modeSel = document.createElement("select");
    modeSel.style.fontSize = "11px";
    modeSel.style.padding = "3px 6px";
    for (const opt of ["paint", "bezier"]) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      modeSel.appendChild(o);
    }

    const brush = document.createElement("input");
    brush.type = "range";
    brush.min = "1";
    brush.max = "256";
    brush.step = "1";
    brush.value = "24";
    brush.style.flex = "1 1 120px";

    const brushLabel = document.createElement("span");
    brushLabel.style.fontSize = "11px";
    brushLabel.style.opacity = "0.8";
    brushLabel.textContent = "brush: 24px";

    const eraseBtn = mkBtn("erase: off");
    const undoBtn = mkBtn("undo");
    const clearBtn = mkBtn("clear");
    const showBtn = mkBtn("overlay: on");

    bar.appendChild(modeSel);
    bar.appendChild(brush);
    bar.appendChild(brushLabel);
    bar.appendChild(eraseBtn);
    bar.appendChild(undoBtn);
    bar.appendChild(clearBtn);
    bar.appendChild(showBtn);

    root.appendChild(bar);

    st.roto = {
      bar,
      modeSel,
      brush,
      brushLabel,
      eraseBtn,
      undoBtn,
      clearBtn,
      showBtn,
      erase: false,
      showOverlay: true,
      dragging: false,
      dragIndex: -1,
      currentStroke: null,
      history: [],
      fitRect: { dx: 0, dy: 0, dw: CANVAS_SIZE, dh: CANVAS_SIZE, srcW: CANVAS_SIZE, srcH: CANVAS_SIZE, scale: 1 },
    };
  }

  node.addDOMWidget("preview", "ImageOpsPreview", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => CANVAS_MIN_HEIGHT,
  });

  st.canvas = canvas;
  st.info = info;
  st.progressWrap = progressWrap;
  st.progressBar = progressBar;
  st.root = root;

  try {
    node.setSize?.([Math.max(node.size?.[0] ?? NODE_MIN_SIZE, NODE_MIN_SIZE), Math.max(node.size?.[1] ?? NODE_MIN_SIZE, NODE_MIN_SIZE)]);
    node.resizable = true;
  } catch {}

  if (node.comfyClass === "ImageOpsRotoMask") {
    hookRotoMaskUI(node, st);
  }

  return st;
}

// ---------------------------
// Bitmap / video helpers
// ---------------------------
async function loadBitmap(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  return await createImageBitmap(img);
}

async function ensureVideoElement(st, url) {
  if (st.videoEl && st.lastVideoURL === url) return st.videoEl;

  // teardown old loop
  stopRAF(st);

  const v = document.createElement("video");
  v.src = url;
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.autoplay = true;

  try { await v.play(); } catch {}

  st.videoEl = v;
  st.lastVideoURL = url;
  return v;
}

function drawFit(ctx, canvasW, canvasH, iw, ih, drawFn) {
  const s = Math.min(canvasW / iw, canvasH / ih);
  const dw = Math.max(1, Math.floor(iw * s));
  const dh = Math.max(1, Math.floor(ih * s));
  const dx = Math.floor((canvasW - dw) / 2);
  const dy = Math.floor((canvasH - dh) / 2);
  ctx.imageSmoothingEnabled = true;
  drawFn(dx, dy, dw, dh);
}

function drawBitmapFit(ctx, canvasW, canvasH, bmp) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasW, canvasH);
  drawFit(ctx, canvasW, canvasH, bmp.width, bmp.height, (dx,dy,dw,dh) => ctx.drawImage(bmp, dx, dy, dw, dh));
}

function drawVideoFrameFit(ctx, canvasW, canvasH, video) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasW, canvasH);
  const iw = video.videoWidth || 1;
  const ih = video.videoHeight || 1;
  drawFit(ctx, canvasW, canvasH, iw, ih, (dx,dy,dw,dh) => ctx.drawImage(video, dx, dy, dw, dh));
}

// ---------------------------
// Adapter registry (ImageOps + interop)
// ---------------------------
function widgetNumber(node, name, fallback = 0) {
  const w = getWidget(node, name);
  const v = w?.value;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function widgetString(node, name, fallback = "") {
  const w = getWidget(node, name);
  const v = w?.value;
  return (typeof v === "string") ? v : fallback;
}

function widgetBool(node, name, fallback = false) {
  const w = getWidget(node, name);
  const v = w?.value;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return !!v;
  if (typeof v === "string") return v.toLowerCase() === "true";
  return fallback;
}

function hasWidget(node, name) {
  return !!getWidget(node, name);
}

// ---------------------------
// Roto Mask (editor + overlay)
// ---------------------------
function safeJsonParse(s, fallback) {
  try { return JSON.parse(String(s ?? "")); } catch { return fallback; }
}

function getRotoWidget(node) {
  return getWidget(node, "roto_data");
}

function readRotoData(node) {
  const w = getRotoWidget(node);
  const d = safeJsonParse(w?.value, null);
  if (d && typeof d === "object") {
    d.version ??= 1;
    d.mode ??= "paint";
    d.strokes ??= [];
    d.points ??= [];
    return d;
  }
  return { version: 1, mode: "paint", strokes: [], points: [] };
}

function writeRotoData(node, st, data, pushHistory = true) {
  const w = getRotoWidget(node);
  if (!w) return;
  const next = JSON.stringify(data);
  const cur = String(w.value ?? "");
  if (pushHistory && st?.roto?.history && cur && cur !== next) {
    st.roto.history.push(cur);
    if (st.roto.history.length > 64) st.roto.history.shift();
  }
  w.value = next;
  try { w.callback?.(next); } catch {}
  node.setDirtyCanvas?.(true, true);
}

function canvasFitRect(srcW, srcH) {
  const iw = Math.max(1, srcW || 1);
  const ih = Math.max(1, srcH || 1);
  const s = Math.min(CANVAS_SIZE / iw, CANVAS_SIZE / ih);
  const dw = Math.max(1, Math.floor(iw * s));
  const dh = Math.max(1, Math.floor(ih * s));
  const dx = Math.floor((CANVAS_SIZE - dw) / 2);
  const dy = Math.floor((CANVAS_SIZE - dh) / 2);
  return { dx, dy, dw, dh, srcW: iw, srcH: ih, scale: s };
}

function pointerToUV(st, ev) {
  const c = st?.canvas;
  const rr = c?.getBoundingClientRect?.();
  if (!rr) return null;

  const x = (ev.clientX - rr.left) * (c.width / rr.width);
  const y = (ev.clientY - rr.top) * (c.height / rr.height);

  const fr = st?.roto?.fitRect ?? { dx: 0, dy: 0, dw: CANVAS_SIZE, dh: CANVAS_SIZE };
  if (x < fr.dx || y < fr.dy || x > fr.dx + fr.dw || y > fr.dy + fr.dh) return null;

  const u = (x - fr.dx) / fr.dw;
  const v = (y - fr.dy) / fr.dh;
  return { u: clamp01(u), v: clamp01(v), x, y };
}

function findNearestBezierPoint(data, st, uv, maxDistPx = 10) {
  const pts = data.points ?? [];
  const fr = st?.roto?.fitRect ?? { dx: 0, dy: 0, dw: CANVAS_SIZE, dh: CANVAS_SIZE };
  let best = -1;
  let bestD2 = (maxDistPx * maxDistPx);
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const px = fr.dx + clamp01(p.x ?? 0) * fr.dw;
    const py = fr.dy + clamp01(p.y ?? 0) * fr.dh;
    const dx = uv.x - px;
    const dy = uv.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestD2) {
      best = i;
      bestD2 = d2;
    }
  }
  return best;
}

function hookRotoMaskUI(node, st) {
  if (st.__roto_hooked) return;
  st.__roto_hooked = true;
  if (!st.roto) return;

  const { modeSel, brush, brushLabel, eraseBtn, undoBtn, clearBtn, showBtn } = st.roto;

  const syncFromWidget = () => {
    const d = readRotoData(node);
    modeSel.value = (d.mode === "bezier") ? "bezier" : "paint";
  };
  syncFromWidget();

  modeSel.addEventListener("change", () => {
    const d = readRotoData(node);
    d.mode = modeSel.value;
    writeRotoData(node, st, d);
    scheduleVideoLoop(node);
  });

  brush.addEventListener("input", () => {
    brushLabel.textContent = `brush: ${brush.value}px`;
  });

  eraseBtn.addEventListener("click", () => {
    st.roto.erase = !st.roto.erase;
    eraseBtn.textContent = `erase: ${st.roto.erase ? "on" : "off"}`;
  });

  showBtn.addEventListener("click", () => {
    st.roto.showOverlay = !st.roto.showOverlay;
    showBtn.textContent = `overlay: ${st.roto.showOverlay ? "on" : "off"}`;
    scheduleVideoLoop(node);
  });

  undoBtn.addEventListener("click", () => {
    const w = getRotoWidget(node);
    const h = st.roto.history;
    if (!w || !h?.length) return;
    const prev = h.pop();
    w.value = prev;
    try { w.callback?.(prev); } catch {}
    node.setDirtyCanvas?.(true, true);
    scheduleVideoLoop(node);
  });

  clearBtn.addEventListener("click", () => {
    const d = readRotoData(node);
    d.strokes = [];
    d.points = [];
    writeRotoData(node, st, d);
    scheduleVideoLoop(node);
  });

  st.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  const onDown = (e) => {
    if (node.comfyClass !== "ImageOpsRotoMask") return;
    const uv = pointerToUV(st, e);
    if (!uv) return;

    const d = readRotoData(node);
    d.mode = modeSel.value;

    if (e.button === 2 && d.mode === "bezier") {
      const idx = findNearestBezierPoint(d, st, uv);
      if (idx >= 0) {
        d.points.splice(idx, 1);
        writeRotoData(node, st, d);
        scheduleVideoLoop(node);
      }
      return;
    }

    if (d.mode === "paint") {
      const stroke = {
        brush: parseInt(brush.value ?? "24"),
        erase: !!st.roto.erase,
        points: [[uv.u, uv.v]],
      };
      st.roto.currentStroke = stroke;
      st.roto.lastUV = uv;
      st.roto.dragging = true;
      scheduleVideoLoop(node);
      return;
    }

    const near = findNearestBezierPoint(d, st, uv);
    if (near >= 0) {
      st.roto.dragIndex = near;
      st.roto.dragging = true;
      return;
    }
    d.points.push({ x: uv.u, y: uv.v });
    writeRotoData(node, st, d);
    scheduleVideoLoop(node);
  };

  const onMove = (e) => {
    if (node.comfyClass !== "ImageOpsRotoMask") return;
    if (!st.roto.dragging) return;
    const uv = pointerToUV(st, e);
    if (!uv) return;

    const d = readRotoData(node);
    d.mode = modeSel.value;

    if (d.mode === "paint") {
      const stroke = st.roto.currentStroke;
      if (!stroke) return;
      const last = st.roto.lastUV;
      const du = uv.u - (last?.u ?? uv.u);
      const dv = uv.v - (last?.v ?? uv.v);
      if ((du * du + dv * dv) < 1e-5) return;
      stroke.points.push([uv.u, uv.v]);
      st.roto.lastUV = uv;
      scheduleVideoLoop(node);
      return;
    }

    const idx = st.roto.dragIndex;
    if (idx < 0) return;
    if (!Array.isArray(d.points) || idx >= d.points.length) return;
    d.points[idx] = { x: uv.u, y: uv.v };
    writeRotoData(node, st, d, false);
    scheduleVideoLoop(node);
  };

  const onUp = () => {
    if (node.comfyClass !== "ImageOpsRotoMask") return;
    if (!st.roto.dragging) return;
    st.roto.dragging = false;

    const d = readRotoData(node);
    d.mode = modeSel.value;
    if (d.mode === "paint") {
      const stroke = st.roto.currentStroke;
      st.roto.currentStroke = null;
      st.roto.lastUV = null;
      if (stroke && stroke.points && stroke.points.length >= 2) {
        d.strokes = Array.isArray(d.strokes) ? d.strokes : [];
        d.strokes.push(stroke);
        writeRotoData(node, st, d);
      } else {
        scheduleVideoLoop(node);
      }
      return;
    }

    st.roto.dragIndex = -1;
    writeRotoData(node, st, d);
    scheduleVideoLoop(node);
  };

  st.canvas.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

// Pixel ops helpers
function getImageData(ctx, w, h) {
  return ctx.getImageData(0, 0, w, h);
}

function putImageData(ctx, img) {
  ctx.putImageData(img, 0, 0);
}

function applyInvert(ctx, w, h, invertAlpha = false) {
  const img = getImageData(ctx, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i+1] = 255 - d[i+1];
    d[i+2] = 255 - d[i+2];
    if (invertAlpha) d[i+3] = 255 - d[i+3];
  }
  putImageData(ctx, img);
}

function applyClamp(ctx, w, h, minV = 0, maxV = 1) {
  const mn = Math.round(clamp01(minV) * 255);
  const mx = Math.round(clamp01(maxV) * 255);
  const img = getImageData(ctx, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.max(mn, Math.min(mx, d[i]));
    d[i+1] = Math.max(mn, Math.min(mx, d[i+1]));
    d[i+2] = Math.max(mn, Math.min(mx, d[i+2]));
  }
  putImageData(ctx, img);
}

function blendByMask(outCtx, w, h, baseCanvas, processedCanvas, maskCanvas) {
  const baseCtx = baseCanvas.getContext("2d");
  const procCtx = processedCanvas.getContext("2d");
  const maskCtx = maskCanvas.getContext("2d");

  const base = baseCtx.getImageData(0, 0, w, h);
  const proc = procCtx.getImageData(0, 0, w, h);
  const mask = maskCtx.getImageData(0, 0, w, h);

  const bd = base.data;
  const pd = proc.data;
  const md = mask.data;

  const out = outCtx.getImageData(0, 0, w, h);
  const od = out.data;

  for (let i = 0; i < od.length; i += 4) {
    const m = md[i] / 255.0; // mask is grayscale
    const im = 1.0 - m;
    od[i]   = Math.round(bd[i]   * im + pd[i]   * m);
    od[i+1] = Math.round(bd[i+1] * im + pd[i+1] * m);
    od[i+2] = Math.round(bd[i+2] * im + pd[i+2] * m);
    od[i+3] = Math.round(bd[i+3] * im + pd[i+3] * m);
  }

  outCtx.putImageData(out, 0, 0);
}

function applyColorCorrect(ctx, w, h, p) {
  const img = getImageData(ctx, w, h);
  const d = img.data;

  const brightness = p.brightness ?? 0;
  const contrast = p.contrast ?? 1;
  const gamma = Math.max(1e-3, p.gamma ?? 1);
  const sat = p.saturation ?? 1;
  const invGamma = 1.0 / gamma;

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;

    r += brightness; g += brightness; b += brightness;
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;

    r = clamp01(r); g = clamp01(g); b = clamp01(b);

    r = Math.pow(r, invGamma);
    g = Math.pow(g, invGamma);
    b = Math.pow(b, invGamma);

    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;

    d[i] = Math.round(clamp01(r) * 255);
    d[i + 1] = Math.round(clamp01(g) * 255);
    d[i + 2] = Math.round(clamp01(b) * 255);
  }
  putImageData(ctx, img);
}

function applyHueSat(ctx, w, h, hueDeg=0, sat=1, val=1) {
  const img = getImageData(ctx, w, h);
  const d = img.data;
  const hue = (hueDeg % 360) * Math.PI / 180;

  for (let i=0;i<d.length;i+=4) {
    let r=d[i]/255, g=d[i+1]/255, b=d[i+2]/255;

    // RGB -> HSV
    const max = Math.max(r,g,b), min = Math.min(r,g,b);
    const delta = max - min;
    let h0 = 0;
    if (delta > 1e-6) {
      if (max === r) h0 = ((g-b)/delta) % 6;
      else if (max === g) h0 = (b-r)/delta + 2;
      else h0 = (r-g)/delta + 4;
      h0 *= Math.PI/3; // 60deg
    }
    let s0 = max === 0 ? 0 : delta / max;
    let v0 = max;

    // adjust
    h0 += hue;
    s0 = clamp01(s0 * sat);
    v0 = clamp01(v0 * val);

    // HSV -> RGB
    const c = v0 * s0;
    const x = c * (1 - Math.abs(((h0/(Math.PI/3)) % 2) - 1));
    const m = v0 - c;
    let rp=0,gp=0,bp=0;
    const hh = ((h0 % (2*Math.PI)) + 2*Math.PI) % (2*Math.PI);
    const sector = Math.floor(hh / (Math.PI/3));
    switch (sector) {
      case 0: rp=c; gp=x; bp=0; break;
      case 1: rp=x; gp=c; bp=0; break;
      case 2: rp=0; gp=c; bp=x; break;
      case 3: rp=0; gp=x; bp=c; break;
      case 4: rp=x; gp=0; bp=c; break;
      case 5: rp=c; gp=0; bp=x; break;
    }

    d[i] = Math.round(clamp01(rp+m)*255);
    d[i+1] = Math.round(clamp01(gp+m)*255);
    d[i+2] = Math.round(clamp01(bp+m)*255);
  }
  putImageData(ctx, img);
}

function applyLevels(ctx, w, h, inMin=0, inMax=1, gamma=1, outMin=0, outMax=1) {
  const img = getImageData(ctx, w, h);
  const d = img.data;
  const ig = 1/Math.max(1e-3, gamma);
  for (let i=0;i<d.length;i+=4) {
    for (let c=0;c<3;c++) {
      let v = d[i+c]/255;
      v = (v - inMin) / Math.max(1e-6,(inMax - inMin));
      v = clamp01(v);
      v = Math.pow(v, ig);
      v = outMin + v*(outMax - outMin);
      d[i+c] = Math.round(clamp01(v)*255);
    }
  }
  putImageData(ctx, img);
}

function applyEdgeDetect(ctx, w, h, strength=1) {
  const img = getImageData(ctx, w, h);
  const d = img.data;

  // grayscale
  const g = new Float32Array(w*h);
  for (let y=0;y<h;y++){
    for (let x=0;x<w;x++){
      const i=(y*w+x)*4;
      g[y*w+x] = 0.2126*(d[i]/255)+0.7152*(d[i+1]/255)+0.0722*(d[i+2]/255);
    }
  }
  const out = new Uint8ClampedArray(d.length);
  const k = strength;
  for (let y=1;y<h-1;y++){
    for (let x=1;x<w-1;x++){
      const gx =
        -1*g[(y-1)*w+(x-1)] + 1*g[(y-1)*w+(x+1)] +
        -2*g[(y)*w+(x-1)]   + 2*g[(y)*w+(x+1)]   +
        -1*g[(y+1)*w+(x-1)] + 1*g[(y+1)*w+(x+1)];
      const gy =
        -1*g[(y-1)*w+(x-1)] + -2*g[(y-1)*w+(x)] + -1*g[(y-1)*w+(x+1)] +
         1*g[(y+1)*w+(x-1)] +  2*g[(y+1)*w+(x)] +  1*g[(y+1)*w+(x+1)];
      const mag = clamp01(Math.sqrt(gx*gx+gy*gy) * k);
      const v = Math.round(mag*255);
      const i=(y*w+x)*4;
      out[i]=v; out[i+1]=v; out[i+2]=v; out[i+3]=255;
    }
  }
  img.data.set(out);
  putImageData(ctx, img);
}

function applyUnsharp(ctx, w, h, amount=1.0) {
  // unsharp: original + amount*(original - blurred)
  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d");
  tctx.filter = "blur(2px)";
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.filter = "none";

  const o = getImageData(ctx, w, h);
  const b = tctx.getImageData(0,0,w,h);

  const d = o.data;
  const bd = b.data;
  const a = Math.max(0, amount);

  for (let i=0;i<d.length;i+=4){
    d[i]   = Math.max(0, Math.min(255, d[i]   + a*(d[i]   - bd[i])));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] + a*(d[i+1] - bd[i+1])));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] + a*(d[i+2] - bd[i+2])));
  }
  putImageData(ctx, o);
}

function blend(ctx, w, h, topCanvas, mode="over", mix=1.0) {
  // draw base already on ctx.canvas
  const m = Math.max(0, Math.min(1, mix));
  if (m <= 0) return;

  const tmp = document.createElement("canvas");
  tmp.width = w; tmp.height = h;
  const tctx = tmp.getContext("2d");
  tctx.drawImage(topCanvas, 0, 0);

  // Use simple canvas compositing modes for a subset
  const goMap = {
    over: "source-over",
    add: "lighter",
    screen: "screen",
    multiply: "multiply",
    difference: "difference",
  };
  ctx.save();
  ctx.globalAlpha = m;
  ctx.globalCompositeOperation = goMap[mode] ?? "source-over";
  ctx.drawImage(tmp, 0, 0);
  ctx.restore();

  // subtract / min / max not available via compositeOperation; approximate via pixels if requested
  if (mode === "subtract" || mode === "min" || mode === "max") {
    const base = getImageData(ctx, w, h);
    const top = tctx.getImageData(0,0,w,h);
    const bd = base.data;
    const td = top.data;
    for (let i=0;i<bd.length;i+=4){
      for (let c=0;c<3;c++){
        const b0 = bd[i+c];
        const t0 = td[i+c];
        let v=b0;
        if (mode==="subtract") v = b0 - t0*m;
        else if (mode==="min") v = Math.min(b0, t0);
        else if (mode==="max") v = Math.max(b0, t0);
        bd[i+c] = Math.max(0, Math.min(255, v));
      }
    }
    putImageData(ctx, base);
  }
}

function applyGlow(ctx, w, h, threshold=0.8, intensity=0.75, blurPx=6) {
  // Extract highlights and add back
  const base = getImageData(ctx, w, h);
  const d = base.data;

  const hi = new Uint8ClampedArray(d.length);
  for (let i=0;i<d.length;i+=4){
    const l = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]) / 255;
    if (l >= threshold) {
      hi[i]=d[i]; hi[i+1]=d[i+1]; hi[i+2]=d[i+2]; hi[i+3]=d[i+3];
    } else {
      hi[i]=0; hi[i+1]=0; hi[i+2]=0; hi[i+3]=0;
    }
  }

  const tmp = document.createElement("canvas");
  tmp.width=w; tmp.height=h;
  const tctx = tmp.getContext("2d");
  const hiImg = new ImageData(hi, w, h);
  tctx.putImageData(hiImg, 0, 0);

  const blur = document.createElement("canvas");
  blur.width=w; blur.height=h;
  const bctx = blur.getContext("2d");
  bctx.filter = `blur(${Math.max(0, blurPx)}px)`;
  bctx.drawImage(tmp, 0, 0);
  bctx.filter="none";

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, intensity));
  ctx.globalCompositeOperation = "lighter";
  ctx.drawImage(blur, 0, 0);
  ctx.restore();
}

function applyTransform(ctx, w, h, tx=0, ty=0, rotDeg=0, scale=1) {
  const tmp = document.createElement("canvas");
  tmp.width=w; tmp.height=h;
  const tctx = tmp.getContext("2d");

  const cx=w/2, cy=h/2;
  const rad = rotDeg * Math.PI/180;
  const sc = scale;

  tctx.save();
  tctx.translate(cx + tx, cy + ty);
  tctx.rotate(rad);
  tctx.scale(sc, sc);
  tctx.translate(-cx, -cy);
  tctx.drawImage(ctx.canvas, 0, 0);
  tctx.restore();

  ctx.clearRect(0,0,w,h);
  ctx.drawImage(tmp,0,0);
}

function applyCropReformat(ctx, w, h, p) {
  const x = Math.round(p.x ?? 0);
  const y = Math.round(p.y ?? 0);
  const cw = Math.max(1, Math.round(p.crop_w ?? w));
  const ch = Math.max(1, Math.round(p.crop_h ?? h));
  const padding = Math.max(0, Math.round(p.padding ?? 0));
  const outW = Math.max(0, Math.round(p.out_w ?? 0));
  const outH = Math.max(0, Math.round(p.out_h ?? 0));
  const mode = p.mode ?? "fit";

  const tmp = document.createElement("canvas");
  tmp.width = cw + padding*2;
  tmp.height = ch + padding*2;
  const tctx = tmp.getContext("2d");
  tctx.clearRect(0,0,tmp.width,tmp.height);

  // Crop by drawing source shifted
  tctx.drawImage(ctx.canvas, -x + padding, -y + padding);

  // If output size requested, resize
  const finalW = outW > 0 ? outW : tmp.width;
  const finalH = outH > 0 ? outH : tmp.height;

  const dst = document.createElement("canvas");
  dst.width = finalW;
  dst.height = finalH;
  const dctx = dst.getContext("2d");
  dctx.clearRect(0,0,finalW,finalH);

  if (mode === "stretch") {
    dctx.drawImage(tmp, 0, 0, finalW, finalH);
  } else {
    const s = (mode === "fill")
      ? Math.max(finalW / tmp.width, finalH / tmp.height)
      : Math.min(finalW / tmp.width, finalH / tmp.height);
    const dw = Math.floor(tmp.width * s);
    const dh = Math.floor(tmp.height * s);
    const dx = Math.floor((finalW - dw)/2);
    const dy = Math.floor((finalH - dh)/2);
    dctx.drawImage(tmp, dx, dy, dw, dh);
  }

  ctx.clearRect(0,0,w,h);
  ctx.drawImage(dst, 0, 0, w, h);
}

function applyLumaKeyToAlpha(ctx, w, h, low=0.1, high=0.9, softness=0.05) {
  const img = getImageData(ctx, w, h);
  const d = img.data;
  for (let i=0;i<d.length;i+=4){
    const l = (0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2]) / 255;
    let a=0;
    if (l <= low) a = 0;
    else if (l >= high) a = 1;
    else {
      const t = (l - low) / Math.max(1e-6, (high - low));
      // soften near edges
      const s = Math.max(0, Math.min(1, softness*10));
      a = (t*(1-s) + (t*t*(3-2*t))*s);
    }
    d[i+3] = Math.round(clamp01(a)*255);
  }
  putImageData(ctx, img);
}

// Adapter selection
function isWASNode(node) {
  const n = String(node?.comfyClass ?? "");
  return n.toLowerCase().includes("was") || n.startsWith("WAS_");
}

function isVHSNode(node) {
  const n = String(node?.comfyClass ?? "");
  return n.startsWith(VHS_PREFIX);
}

function isInteropNode(node) {
  const name = String(node?.comfyClass ?? "");
  if (CORE_INTEROP.has(name)) return true;
  if (isWASNode(node)) return true;
  // other popular packs can be caught via widget heuristics in adapter pick
  return false;
}

function tryPickAdapter(node) {
  const cls = String(node?.comfyClass ?? "");

  // ImageOps native
  if (IMAGEOPS_NODES.has(cls)) {
    return { kind: "imageops", cls };
  }

  // Core nodes
  if (cls === "ImageInvert") return { kind: "core_invert" };
  if (cls === "ImageSharpen") return { kind: "core_sharpen" };
  if (cls === "ImageBlend") return { kind: "core_blend" };

  // WAS nodes (best-effort by name / widget patterns)
  if (isWASNode(node)) {
    const lower = cls.toLowerCase();
    if (lower.includes("levels")) return { kind: "levels_like" };
    if (lower.includes("hue")) return { kind: "huesat_like" };
    if (lower.includes("invert")) return { kind: "invert_like" };
    if (lower.includes("blend") || lower.includes("merge")) return { kind: "blend_like" };
    // fallback: use widgets
    if (hasWidget(node, "in_min") && hasWidget(node, "in_max") && hasWidget(node, "gamma")) return { kind: "levels_like" };
    if (hasWidget(node, "hue") || hasWidget(node, "hue_deg")) return { kind: "huesat_like" };
  }

  // Generic heuristics for other popular packs
  if (hasWidget(node, "in_min") && hasWidget(node, "in_max") && hasWidget(node, "gamma")) return { kind: "levels_like" };
  if ((hasWidget(node, "hue_deg") || hasWidget(node, "hue")) && (hasWidget(node, "saturation") || hasWidget(node, "sat"))) return { kind: "huesat_like" };
  if (hasWidget(node, "mode") && (getUpstreamNode(node,0) && getUpstreamNode(node,1))) return { kind: "blend_like" };

  return null;
}

function nodeParamsSignature(node) {
  // Cheap signature: comfyClass + all widget values stringified (non-serializable values ignored)
  const parts = [String(node.comfyClass ?? "")];
  for (const w of (node.widgets ?? [])) {
    const v = w?.value;
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      parts.push(`${w.name}:${v}`);
    }
  }
  return parts.join("|");
}

async function applyRotoMaskOverlay(node, out, octx, opts = null) {
  const st = ensureState(node);
  const ui = st?.roto;
  const data = readRotoData(node);

  // Try to infer original aspect ratio from the first real media source upstream.
  let srcW = CANVAS_SIZE, srcH = CANVAS_SIZE;
  const src = findAnySourceUpstream(node);
  if (src?.value) {
    const url = viewURLForAnnotated(src.value);
    if (url) {
      if (src.kind === "image") {
        if (!st.rotoBitmap || st.rotoBitmapURL !== url) {
          st.rotoBitmap = await loadBitmap(url);
          st.rotoBitmapURL = url;
        }
        srcW = st.rotoBitmap?.width ?? srcW;
        srcH = st.rotoBitmap?.height ?? srcH;
      } else if (src.kind === "video") {
        const v = await ensureVideoElement(st, url);
        srcW = v.videoWidth || srcW;
        srcH = v.videoHeight || srcH;
      }
    }
  }

  const fr = canvasFitRect(srcW, srcH);
  if (ui) ui.fitRect = fr;

  const maskC = document.createElement("canvas");
  maskC.width = CANVAS_SIZE;
  maskC.height = CANVAS_SIZE;
  const mctx = maskC.getContext("2d");
  mctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  const toXY = (p) => ({
    x: fr.dx + clamp01(p.x ?? p[0] ?? 0) * fr.dw,
    y: fr.dy + clamp01(p.y ?? p[1] ?? 0) * fr.dh,
  });

  const brushScale = fr.scale;

  // Paint strokes
  const strokes = Array.isArray(data.strokes) ? data.strokes : [];
  const allStrokes = strokes.slice();
  if (ui?.currentStroke) allStrokes.push(ui.currentStroke);

  for (const s of allStrokes) {
    const pts = s?.points;
    if (!Array.isArray(pts) || pts.length < 2) continue;
    const erase = !!s.erase;
    const brush = Math.max(1, Math.round((parseFloat(s.brush ?? 24) || 24) * brushScale));

    mctx.save();
    mctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    mctx.strokeStyle = "white";
    mctx.lineWidth = brush;
    mctx.lineJoin = "round";
    mctx.lineCap = "round";
    mctx.beginPath();
    const p0 = toXY(pts[0]);
    mctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = toXY(pts[i]);
      mctx.lineTo(p.x, p.y);
    }
    mctx.stroke();
    mctx.restore();
  }

  // Bezier (Catmull-Rom smoothed closed path)
  const points = Array.isArray(data.points) ? data.points : [];
  if ((data.mode ?? "paint") === "bezier" && points.length >= 3) {
    const pts = points.map(p => toXY(p));
    const n = pts.length;

    const c1 = (p0, p1, p2) => ({ x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 });
    const c2 = (p1, p2, p3) => ({ x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 });

    mctx.save();
    mctx.globalCompositeOperation = "source-over";
    mctx.fillStyle = "white";
    mctx.beginPath();
    mctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const cc1 = c1(p0, p1, p2);
      const cc2 = c2(p1, p2, p3);
      mctx.bezierCurveTo(cc1.x, cc1.y, cc2.x, cc2.y, p2.x, p2.y);
    }
    mctx.closePath();
    mctx.fill();
    mctx.restore();
  }

  // Feather (preview-only blur)
  const feather = Math.max(0, widgetNumber(node, "feather", 0) * brushScale);
  let finalMask = maskC;
  if (feather > 0.01) {
    const tmp = document.createElement("canvas");
    tmp.width = CANVAS_SIZE;
    tmp.height = CANVAS_SIZE;
    const tctx = tmp.getContext("2d");
    tctx.filter = `blur(${feather.toFixed(2)}px)`;
    tctx.drawImage(maskC, 0, 0);
    tctx.filter = "none";
    finalMask = tmp;
  }

  st.rotoMaskCanvas = finalMask;

  // Invert (preview)
  if (widgetBool(node, "invert", false)) {
    const ictx = finalMask.getContext("2d");
    const img = ictx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      // treat current mask intensity as alpha (0..255), then invert to RGB mask with full alpha
      const a = d[i + 3];
      const v = 255 - a;
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255;
    }
    ictx.putImageData(img, 0, 0);
    st.rotoMaskCanvas = finalMask;
  }

  if (opts?.returnMaskOnly) {
    return { out, mask: finalMask };
  }

  if (ui?.showOverlay !== false) {
    const color = document.createElement("canvas");
    color.width = CANVAS_SIZE;
    color.height = CANVAS_SIZE;
    const cctx = color.getContext("2d");
    cctx.fillStyle = "rgba(0, 255, 0, 1)";
    cctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(finalMask, 0, 0);
    cctx.globalCompositeOperation = "source-over";

    const opacity = Math.max(0, Math.min(1, widgetNumber(node, "opacity", 1.0)));
    octx.save();
    octx.globalAlpha = 0.55 * opacity;
    octx.drawImage(color, 0, 0);
    octx.restore();
  }

  // Outline + points (bezier mode)
  if ((data.mode ?? "paint") === "bezier" && points.length >= 2) {
    const pts = points.map(p => toXY(p));
    octx.save();
    octx.lineWidth = 2;
    octx.strokeStyle = "rgba(255, 230, 120, 0.9)";
    octx.fillStyle = "rgba(255, 230, 120, 0.9)";
    octx.beginPath();
    octx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
    octx.closePath();
    octx.stroke();
    for (const p of pts) {
      octx.beginPath();
      octx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      octx.fill();
    }
    octx.restore();
  }

  // UI sync if someone edited the widget manually
  if (ui?.modeSel) {
    ui.modeSel.value = (data.mode === "bezier") ? "bezier" : "paint";
  }

  return out;
}

// ---------------------------
// Recursive renderer (supports merge/interops)
// ---------------------------
async function renderNode(node, frameCtx) {
  // frameCtx: {cache, visited, videoTick}
  if (!node) return null;
  if (frameCtx.visited.has(node.id)) return null; // cycle guard
  if (frameCtx.visited.size > MAX_RECURSION) return null;

  const sig = nodeParamsSignature(node);
  const renderAs = frameCtx.renderAs ?? "image";
  const cacheKey = `${node.id}:${sig}:${frameCtx.videoTick ?? 0}:${renderAs}`;
  if (frameCtx.cache.has(cacheKey)) return frameCtx.cache.get(cacheKey);

  frameCtx.visited.add(node.id);

  // source?
  const src = detectSource(node);
  if (src) {
    const url = viewURLForAnnotated(src.value);
    if (!url) { frameCtx.visited.delete(node.id); return null; }

    const c = document.createElement("canvas");
    c.width = CANVAS_SIZE;
    c.height = CANVAS_SIZE;
    const ctx = c.getContext("2d");

    if (src.kind === "image") {
      const st = ensureState(node);
      if (!st.lastBitmap || st.lastBitmapURL !== url) {
        st.lastBitmap = await loadBitmap(url);
        st.lastBitmapURL = url;
      }
      drawBitmapFit(ctx, CANVAS_SIZE, CANVAS_SIZE, st.lastBitmap);
      frameCtx.cache.set(cacheKey, c);
      frameCtx.visited.delete(node.id);
      return c;
    }

    // video
    const st = ensureState(node);
    const v = await ensureVideoElement(st, url);
    if (v.readyState >= 2) {
      drawVideoFrameFit(ctx, CANVAS_SIZE, CANVAS_SIZE, v);
    } else {
      // not ready yet: black frame
      ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
    }
    frameCtx.cache.set(cacheKey, c);
    frameCtx.visited.delete(node.id);
    return c;
  }

  const adapter = tryPickAdapter(node);
  if (!adapter) { frameCtx.visited.delete(node.id); return null; }

  // Determine inputs by adapter kind
  let inCount = 1;
  if (adapter.kind === "imageops" && String(node.comfyClass) === "ImageOpsMerge") inCount = 2;
  if (adapter.kind === "core_blend" || adapter.kind === "blend_like") inCount = 2;

  const in0 = await renderNode(getUpstreamNode(node, 0), frameCtx);
  if (!in0) { frameCtx.visited.delete(node.id); return null; }
  let in1 = null;
  if (inCount === 2) {
    in1 = await renderNode(getUpstreamNode(node, 1), frameCtx);
    if (!in1) { frameCtx.visited.delete(node.id); return null; }
  }

  // Work canvas = clone of in0
  const out = document.createElement("canvas");
  out.width = CANVAS_SIZE;
  out.height = CANVAS_SIZE;
  const octx = out.getContext("2d");
  octx.drawImage(in0, 0, 0);

  // Apply op
  const cls = String(node.comfyClass ?? "");

  if (adapter.kind === "imageops") {
    if (cls === "ImageOpsRotoMask") {
      const res = await applyRotoMaskOverlay(node, out, octx, { returnMaskOnly: renderAs === "mask" });
      if (renderAs === "mask") {
        frameCtx.cache.set(cacheKey, res?.mask ?? out);
        frameCtx.visited.delete(node.id);
        return res?.mask ?? out;
      }
    } else if (cls === "ImageOpsColorCorrect") {
      applyColorCorrect(octx, CANVAS_SIZE, CANVAS_SIZE, {
        brightness: widgetNumber(node,"brightness",0),
        contrast: widgetNumber(node,"contrast",1),
        gamma: widgetNumber(node,"gamma",1),
        saturation: widgetNumber(node,"saturation",1),
      });
    } else if (cls === "ImageOpsBlur") {
      const r = Math.max(0, Math.round(widgetNumber(node,"radius",0)));
      if (r > 0) {
        const tmp = document.createElement("canvas");
        tmp.width = CANVAS_SIZE; tmp.height = CANVAS_SIZE;
        const tctx = tmp.getContext("2d");
        tctx.filter = `blur(${r}px)`;
        tctx.drawImage(out,0,0);
        tctx.filter="none";
        octx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
        octx.drawImage(tmp,0,0);
      }
    } else if (cls === "ImageOpsTransform") {
      applyTransform(octx, CANVAS_SIZE, CANVAS_SIZE,
        widgetNumber(node,"translate_x",0),
        widgetNumber(node,"translate_y",0),
        widgetNumber(node,"rotate_deg",0),
        widgetNumber(node,"scale",1),
      );
    } else if (cls === "ImageOpsGradeLevels") {
      applyLevels(octx, CANVAS_SIZE, CANVAS_SIZE,
        widgetNumber(node,"in_min",0),
        widgetNumber(node,"in_max",1),
        widgetNumber(node,"gamma",1),
        widgetNumber(node,"out_min",0),
        widgetNumber(node,"out_max",1),
      );
    } else if (cls === "ImageOpsHueSat") {
      applyHueSat(octx, CANVAS_SIZE, CANVAS_SIZE,
        widgetNumber(node,"hue_deg",0),
        widgetNumber(node,"saturation",1),
        widgetNumber(node,"value",1),
      );
    } else if (cls === "ImageOpsInvert") {
      applyInvert(octx, CANVAS_SIZE, CANVAS_SIZE, widgetBool(node,"invert_alpha",false));
    } else if (cls === "ImageOpsClamp") {
      applyClamp(octx, CANVAS_SIZE, CANVAS_SIZE, widgetNumber(node,"min_v",0), widgetNumber(node,"max_v",1));
    } else if (cls === "ImageOpsSharpen") {
      applyUnsharp(octx, CANVAS_SIZE, CANVAS_SIZE, widgetNumber(node,"amount",1.0));
    } else if (cls === "ImageOpsEdgeDetect") {
      applyEdgeDetect(octx, CANVAS_SIZE, CANVAS_SIZE, widgetNumber(node,"strength",1.0));
    } else if (cls === "ImageOpsGlow") {
      applyGlow(octx, CANVAS_SIZE, CANVAS_SIZE,
        widgetNumber(node,"threshold",0.8),
        widgetNumber(node,"intensity",0.75),
        Math.round(widgetNumber(node,"blur_px",6)),
      );
    } else if (cls === "ImageOpsCropReformat") {
      applyCropReformat(octx, CANVAS_SIZE, CANVAS_SIZE, {
        x: widgetNumber(node,"x",0),
        y: widgetNumber(node,"y",0),
        crop_w: widgetNumber(node,"crop_w",CANVAS_SIZE),
        crop_h: widgetNumber(node,"crop_h",CANVAS_SIZE),
        padding: widgetNumber(node,"padding",0),
        out_w: widgetNumber(node,"out_w",0),
        out_h: widgetNumber(node,"out_h",0),
        mode: widgetString(node,"mode","fit"),
      });
    } else if (cls === "ImageOpsLumaKey") {
      // Backend outputs MASK. For preview:
      // - when used as a mask input, return a grayscale mask canvas
      // - when viewed directly, also show the mask (not alpha-ed image)
      const maskC = document.createElement("canvas");
      maskC.width = CANVAS_SIZE;
      maskC.height = CANVAS_SIZE;
      const mctx = maskC.getContext("2d");
      mctx.drawImage(in0, 0, 0);
      applyLumaKeyToAlpha(mctx, CANVAS_SIZE, CANVAS_SIZE,
        widgetNumber(node,"low",0.1),
        widgetNumber(node,"high",0.9),
        widgetNumber(node,"softness",0.05),
      );
      // Convert alpha to grayscale in RGB (mask = alpha)
      const img = mctx.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const a = d[i+3];
        d[i] = a; d[i+1] = a; d[i+2] = a; d[i+3] = 255;
      }
      mctx.putImageData(img, 0, 0);
      frameCtx.cache.set(cacheKey, maskC);
      frameCtx.visited.delete(node.id);
      return maskC;
    } else if (cls === "ImageOpsMerge") {
      const mode = widgetString(node,"mode","over");
      const mix = widgetNumber(node,"mix",1.0);
      blend(octx, CANVAS_SIZE, CANVAS_SIZE, in1, mode, mix);
    } else {
      // ImageOpsPreview (and others) are pass-through for live preview
    }

    // Mask scoping (for nodes that expose a mask input). Applies after the op, like backend.
    // Merge is also scoped here (effective mix = mix * mask).
    if (renderAs === "image") {
      const maskUp = getUpstreamByName(node, "mask");
      if (maskUp) {
        const maskCtx = { cache: frameCtx.cache, visited: frameCtx.visited, videoTick: frameCtx.videoTick, renderAs: "mask" };
        const maskCanvas = await renderNode(maskUp, maskCtx);
        if (maskCanvas) {
          blendByMask(octx, CANVAS_SIZE, CANVAS_SIZE, in0, out, maskCanvas);
        }
      }
    }
  } else if (adapter.kind === "core_invert" || adapter.kind === "invert_like") {
    applyInvert(octx, CANVAS_SIZE, CANVAS_SIZE, widgetBool(node,"invert_alpha",false));
  } else if (adapter.kind === "core_sharpen") {
    // Core ImageSharpen usually has "amount" and "radius" (not always). We'll use amount.
    applyUnsharp(octx, CANVAS_SIZE, CANVAS_SIZE, widgetNumber(node,"amount",1.0));
  } else if (adapter.kind === "core_blend" || adapter.kind === "blend_like") {
    const mode = widgetString(node,"mode", widgetString(node,"blend_mode","over"));
    const mix = widgetNumber(node,"blend_factor", widgetNumber(node,"mix",1.0));
    blend(octx, CANVAS_SIZE, CANVAS_SIZE, in1, mode, mix);
  } else if (adapter.kind === "levels_like") {
    // WAS "Image Levels Adjustment": often min/mid/max names. Best-effort mapping.
    const inMin = widgetNumber(node,"in_min", widgetNumber(node,"min",0.0));
    const inMax = widgetNumber(node,"in_max", widgetNumber(node,"max",1.0));
    const gamma = widgetNumber(node,"gamma", widgetNumber(node,"mid",1.0));
    const outMin = widgetNumber(node,"out_min", 0.0);
    const outMax = widgetNumber(node,"out_max", 1.0);
    applyLevels(octx, CANVAS_SIZE, CANVAS_SIZE, inMin, inMax, gamma, outMin, outMax);
  } else if (adapter.kind === "huesat_like") {
    const hue = widgetNumber(node,"hue_deg", widgetNumber(node,"hue",0));
    const sat = widgetNumber(node,"saturation", widgetNumber(node,"sat",1));
    const val = widgetNumber(node,"value", widgetNumber(node,"val",1));
    applyHueSat(octx, CANVAS_SIZE, CANVAS_SIZE, hue, sat, val);
  }

  frameCtx.cache.set(cacheKey, out);
  frameCtx.visited.delete(node.id);
  return out;
}

// ---------------------------
// Live preview render for a target ImageOps node
// ---------------------------
function blitToNodeCanvas(st, canvas) {
  const ctx = st.canvas.getContext("2d");
  st.canvas.width = CANVAS_SIZE;
  st.canvas.height = CANVAS_SIZE;
  ctx.clearRect(0,0,CANVAS_SIZE,CANVAS_SIZE);
  ctx.drawImage(canvas, 0, 0);
}

async function renderPreviewForNode(node, videoTick = 0) {
  const st = ensureCanvas(node);
  if (!st) return;

  const g = node?.graph;
  const nodes = g?._nodes ?? [];
  if (nodes.length > MAX_GRAPH_NODES) {
    st.info.textContent = `Live preview disabled: graph too large (${nodes.length})`;
    return;
  }

  const frameCtx = { cache: new Map(), visited: new Set(), videoTick, renderAs: "image" };
  const out = await renderNode(node, frameCtx);

  if (!out) {
    st.info.textContent = "Live preview: connect to a supported loader/chain";
    return;
  }

  blitToNodeCanvas(st, out);

  // build a small label
  const src = findAnySourceUpstream(node);
  if (src?.kind) {
    const { filename, subfolder, type } = parseAnnotated(src.value);
    st.info.textContent = `Live preview (${src.kind}) • ${type} • ${subfolder ? subfolder + "/" : ""}${filename ?? ""}`;
  } else {
    st.info.textContent = "Live preview (no queue)";
  }
}

function findAnySourceUpstream(node, max=MAX_RECURSION) {
  let cur = node;
  for (let i=0;i<max && cur;i++){
    const s = detectSource(cur);
    if (s) return s;
    cur = getUpstreamNode(cur, 0);
  }
  return null;
}

function scheduleRefresh(node, delayMs = DEBOUNCE_DELAY_MS) {
  const st = ensureCanvas(node);
  if (!st) return;
  if (st.debounceTimer) clearTimeout(st.debounceTimer);
  st.debounceTimer = setTimeout(() => { renderPreviewForNode(node); }, delayMs);
}

// For video chains: if any upstream source is video, animate.
function scheduleVideoLoop(node) {
  const st = ensureCanvas(node);
  if (!st) return;

  const src = findAnySourceUpstream(node);
  if (!src || src.kind !== "video") {
    stopRAF(st);
    scheduleRefresh(node, REFRESH_DELAY_MS);
    return;
  }

  let tick = 0;
  const loop = async () => {
    tick++;
    await renderPreviewForNode(node, tick);
    st.rafId = requestAnimationFrame(loop);
  };

  stopRAF(st);
  st.rafId = requestAnimationFrame(loop);
}

// Refresh decorated nodes downstream of a changing node (best-effort)
function refreshDecoratedDependents(changedNode) {
  const g = changedNode?.graph;
  const nodes = g?._nodes ?? [];
  for (const n of nodes) {
    if (!n || !IMAGEOPS_NODES.has(n.comfyClass)) continue;
    const st = n.__imageops_state;
    if (!st?.canvas) continue;
    // if n can reach changedNode upstream, refresh
    if (isUpstreamOf(changedNode, n)) {
      scheduleVideoLoop(n);
    }
  }
}

function isUpstreamOf(candidate, node, max=MAX_RECURSION) {
  // is candidate upstream of node?
  const seen = new Set();
  const stack = [node];
  let steps = 0;
  while (stack.length && steps < max) {
    const cur = stack.pop();
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;

    if (cur.id === candidate.id) return true;

    // push upstream inputs 0..3
    for (let i=0;i<4;i++){
      const up = getUpstreamNode(cur, i);
      if (up) stack.push(up);
    }
  }
  return false;
}

// ---------------------------
// Hook nodes
// ---------------------------
function hookNode(node) {
  const st = ensureState(node);
  if (st.hooked) return;
  st.hooked = true;

  // Only ImageOps nodes get DOM widgets
  if (IMAGEOPS_NODES.has(node.comfyClass)) {
    ensureCanvas(node);
    scheduleVideoLoop(node);
  }

  // When widgets change, refresh dependents if this node is relevant.
  for (const w of (node.widgets ?? [])) {
    const orig = w.callback;
    w.callback = function () {
      const r = orig?.apply(this, arguments);

      // If this node is ImageOps -> refresh itself
      if (IMAGEOPS_NODES.has(node.comfyClass)) scheduleVideoLoop(node);

      // If it is a source or interop node, refresh decorated dependents
      if (detectSource(node) || isInteropNode(node) || tryPickAdapter(node)) {
        refreshDecoratedDependents(node);
      }

      return r;
    };
  }

  chainCallback(node, "onConnectionsChange", () => {
    if (IMAGEOPS_NODES.has(node.comfyClass)) scheduleVideoLoop(node);
    refreshDecoratedDependents(node);
  });

  chainCallback(node, "onConfigure", () => {
    if (IMAGEOPS_NODES.has(node.comfyClass)) scheduleVideoLoop(node);
    refreshDecoratedDependents(node);
  });

  updateProgressWidgets();
}

app.registerExtension({
  name: EXT_NAME,
  async beforeRegisterNodeDef(nodeType, nodeData) {
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      hookNode(this);
    });
  },
});
