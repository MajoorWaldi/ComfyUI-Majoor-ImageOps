import { getNativePreviewImage } from "./shared/media.js";
const VIDEO_EXTS = /* @__PURE__ */ new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg", "ogv"]);
const VIDEO_MIME_BY_EXT = {
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  ogv: "video/ogg",
  webm: "video/webm",
  wmv: "video/x-ms-wmv"
};
function parseAnnotated(raw) {
  if (!raw) return { filename: null, subfolder: "", type: "input" };
  let s = String(raw);
  let type = "input";
  const mType = s.match(/\s*\[(input|output|temp)\]\s*$/i);
  if (mType) type = mType[1].toLowerCase();
  s = s.replace(/\s*\[(input|output|temp)\]\s*$/i, "");
  s = s.replace(/\\/g, "/");
  const abs = /^[a-zA-Z]:\//.test(s) || s.startsWith("//");
  if (abs) {
    const parts = s.split("/");
    return { filename: parts[parts.length - 1], subfolder: "", type: "input" };
  }
  const idx = s.lastIndexOf("/");
  if (idx >= 0) return { filename: s.slice(idx + 1), subfolder: s.slice(0, idx), type };
  return { filename: s, subfolder: "", type };
}
function fileExtLower(value) {
  const match = String(value ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
  return match ? match[1] : "";
}
function canBrowserPlayVideoExt(ext) {
  const mime = VIDEO_MIME_BY_EXT[ext];
  if (!mime || typeof document === "undefined") return false;
  const probe = document.createElement("video");
  const support = probe.canPlayType(mime);
  return support === "probably" || support === "maybe";
}
function makeViewUrl(api, rawFilename) {
  const { filename, subfolder, type } = parseAnnotated(rawFilename);
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, type, subfolder });
  const ext = fileExtLower(filename);
  if (VIDEO_EXTS.has(ext) && !canBrowserPlayVideoExt(ext)) {
    qs.set("deadline", "realtime");
    return api.apiURL(`/imageops/viewmedia?${qs.toString()}`);
  }
  return api.apiURL(`/view?${qs.toString()}`);
}
function fitWithinMaxSize(width, height, maxSize) {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const safeMax = Math.max(1, Math.round(maxSize || 1));
  const scale = Math.min(1, safeMax / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale))
  };
}
function ensureCanvasSize(canvas, width, height) {
  const targetWidth = Math.max(1, Math.round(width || 1));
  const targetHeight = Math.max(1, Math.round(height || 1));
  const next = canvas ?? document.createElement("canvas");
  if (next.width !== targetWidth) next.width = targetWidth;
  if (next.height !== targetHeight) next.height = targetHeight;
  return next;
}
async function waitForVideoReady(videoEl, timeoutMs = 4e3) {
  if (videoEl.readyState >= 2) return;
  await new Promise((resolve) => {
    let done = false;
    let timeoutId = 0;
    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("loadeddata", finish);
      videoEl.removeEventListener("canplay", finish);
      videoEl.removeEventListener("error", finish);
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve();
    };
    timeoutId = window.setTimeout(finish, timeoutMs);
    videoEl.addEventListener("loadeddata", finish, { once: true });
    videoEl.addEventListener("canplay", finish, { once: true });
    videoEl.addEventListener("error", finish, { once: true });
  });
}
function renderImageSourceToCanvas(node, source, width, height, slot) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  const canvas = ensureCanvasSize(st[slot], width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  st[slot] = canvas;
  return canvas;
}
function resolveNodeIntrinsicMediaSize(node, fallbackCanvas) {
  const nativeImage = getNativePreviewImage(node);
  if (nativeImage && nativeImage.naturalWidth > 0 && nativeImage.naturalHeight > 0) {
    return {
      width: Math.max(1, nativeImage.naturalWidth),
      height: Math.max(1, nativeImage.naturalHeight)
    };
  }
  const previewMedia = Array.isArray(node.imgs) && node.imgs.length > 0 ? node.imgs[Math.max(0, Math.min(node.imgs.length - 1, typeof node.imageIndex === "number" ? node.imageIndex : node.imgs.length - 1))] ?? null : null;
  if (previewMedia instanceof HTMLImageElement && previewMedia.naturalWidth > 0 && previewMedia.naturalHeight > 0) {
    return {
      width: Math.max(1, previewMedia.naturalWidth),
      height: Math.max(1, previewMedia.naturalHeight)
    };
  }
  if (previewMedia instanceof HTMLVideoElement && previewMedia.videoWidth > 0 && previewMedia.videoHeight > 0) {
    return {
      width: Math.max(1, previewMedia.videoWidth),
      height: Math.max(1, previewMedia.videoHeight)
    };
  }
  if (previewMedia instanceof HTMLCanvasElement && previewMedia.width > 0 && previewMedia.height > 0) {
    return {
      width: Math.max(1, previewMedia.width),
      height: Math.max(1, previewMedia.height)
    };
  }
  for (const widget of node.widgets ?? []) {
    const element = widget?.element;
    if (!element) continue;
    const media = element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement ? element : element.querySelector?.("img,video,canvas") ?? null;
    if (media instanceof HTMLImageElement && media.naturalWidth > 0 && media.naturalHeight > 0) {
      return {
        width: Math.max(1, media.naturalWidth),
        height: Math.max(1, media.naturalHeight)
      };
    }
    if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
      return {
        width: Math.max(1, media.videoWidth),
        height: Math.max(1, media.videoHeight)
      };
    }
    if (media instanceof HTMLCanvasElement && media.width > 0 && media.height > 0) {
      return {
        width: Math.max(1, media.width),
        height: Math.max(1, media.height)
      };
    }
  }
  return {
    width: Math.max(1, fallbackCanvas?.width || 1),
    height: Math.max(1, fallbackCanvas?.height || 1)
  };
}
async function ensureImageElement(node, url) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  if (st.lastImageURL === url && st.imageEl) return st.imageEl;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    console.warn("[ImageOps] image decode failed:", url, e);
    return null;
  }
  st.lastImageURL = url;
  st.imageEl = img;
  if (st.lastBitmapURL !== url) {
    st.lastBitmap?.close();
    st.lastBitmapURL = void 0;
    st.lastBitmap = void 0;
  }
  return img;
}
async function ensureBitmap(node, url) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  if (st.lastBitmapURL === url && st.lastBitmap) return st.lastBitmap;
  const img = await ensureImageElement(node, url);
  if (!img) return null;
  const bmp = await createImageBitmap(img);
  if (st.lastBitmap && st.lastBitmapURL !== url) {
    st.lastBitmap.close();
  }
  st.lastBitmapURL = url;
  st.lastBitmap = bmp;
  return bmp;
}
async function ensureVideoFrameCanvas(node, url, size, tick = 0) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  if (!st.videoEl || st.lastVideoURL !== url) {
    if (st.videoEl) {
      try {
        st.videoEl.pause();
      } catch {
      }
      try {
        st.videoEl.removeAttribute("src");
        st.videoEl.load();
      } catch {
      }
    }
    const v2 = document.createElement("video");
    v2.preload = "auto";
    v2.src = url;
    v2.muted = true;
    v2.loop = true;
    v2.playsInline = true;
    v2.autoplay = true;
    st.videoEl = v2;
    st.lastVideoURL = url;
    st.lastVideoFrameKey = null;
    try {
      v2.load();
    } catch {
    }
    await waitForVideoReady(v2);
    if (st.videoEl === v2) {
      try {
        await v2.play();
      } catch (e) {
        console.warn("[ImageOps] video play failed:", e);
      }
    }
  }
  const v = st.videoEl;
  void tick;
  if (v.readyState < 2) {
    await waitForVideoReady(v, 1500);
    if (v.readyState < 2) {
      if (st.videoCanvas) return st.videoCanvas;
      const placeholder = ensureCanvasSize(st.videoCanvas, Math.max(1, size), Math.max(1, size));
      st.videoCanvas = placeholder;
      return placeholder;
    }
  }
  const { width, height } = fitWithinMaxSize(v.videoWidth || size, v.videoHeight || size, size);
  let c = st.videoCanvas;
  if (!c) {
    c = ensureCanvasSize(void 0, width, height);
  } else if (c.width !== width || c.height !== height) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(width));
    next.height = Math.max(1, Math.round(height));
    try {
      next.getContext("2d")?.drawImage(c, 0, 0, next.width, next.height);
    } catch {
    }
    c = next;
  }
  st.videoCanvas = c;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  if (v.paused && !st.videoPlayInFlight) {
    st.videoPlayInFlight = true;
    v.play().catch(() => {
    }).finally(() => {
      st.videoPlayInFlight = false;
    });
  }
  const frameKey = `${v.currentTime.toFixed(4)}|${width}x${height}`;
  if (st.lastVideoFrameKey === frameKey) return c;
  st.lastVideoFrameKey = frameKey;
  ctx.drawImage(v, 0, 0, width, height);
  return c;
}
function disposeMediaState(node) {
  const st = node.__imageops_media;
  if (!st) return;
  try {
    if (st.videoEl) {
      try {
        st.videoEl.pause();
      } catch {
      }
      try {
        st.videoEl.removeAttribute("src");
        st.videoEl.load();
      } catch {
      }
    }
  } catch {
  }
  try {
    st.lastBitmap?.close();
  } catch {
  }
  st.videoEl = void 0;
  st.lastVideoURL = void 0;
  st.lastBitmap = void 0;
  st.lastBitmapURL = void 0;
  st.imageEl = void 0;
  st.lastImageURL = void 0;
  st.imageCanvas = void 0;
  st.animatedImageCanvas = void 0;
  st.videoCanvas = void 0;
  st.nativeCanvas = void 0;
  st.staticRenderCache?.clear();
  st.staticRenderCache = void 0;
  st.lastVideoFrameKey = null;
}
export {
  disposeMediaState,
  ensureBitmap,
  ensureImageElement,
  ensureVideoFrameCanvas,
  fitWithinMaxSize,
  makeViewUrl,
  parseAnnotated,
  renderImageSourceToCanvas,
  resolveNodeIntrinsicMediaSize
};
