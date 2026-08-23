// Media source helpers (v6)
import type { AnnotatedFilename, ComfyAPI, ComfyNode, MediaState } from "../types.js";
import { getNativePreviewImage } from "./shared/media.js";

const VIDEO_EXTS = new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg", "ogv"]);
const VIDEO_MIME_BY_EXT: Record<string, string> = {
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
  wmv: "video/x-ms-wmv",
};

export function parseAnnotated(raw: string | null): AnnotatedFilename {
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

function fileExtLower(value: string | null): string {
  const match = String(value ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
  return match ? match[1] : "";
}

function canBrowserPlayVideoExt(ext: string): boolean {
  const mime = VIDEO_MIME_BY_EXT[ext];
  if (!mime || typeof document === "undefined") return false;
  const probe = document.createElement("video");
  const support = probe.canPlayType(mime);
  return support === "probably" || support === "maybe";
}

export function makeViewUrl(api: ComfyAPI, rawFilename: string): string | null {
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

export function fitWithinMaxSize(width: number, height: number, maxSize: number): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width || 1));
  const safeHeight = Math.max(1, Math.round(height || 1));
  const safeMax = Math.max(1, Math.round(maxSize || 1));
  const scale = Math.min(1, safeMax / Math.max(safeWidth, safeHeight));
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function ensureCanvasSize(canvas: HTMLCanvasElement | undefined, width: number, height: number): HTMLCanvasElement {
  const targetWidth = Math.max(1, Math.round(width || 1));
  const targetHeight = Math.max(1, Math.round(height || 1));
  const next = canvas ?? document.createElement("canvas");
  if (next.width !== targetWidth) next.width = targetWidth;
  if (next.height !== targetHeight) next.height = targetHeight;
  return next;
}

async function waitForVideoReady(videoEl: HTMLVideoElement, timeoutMs: number = 4000): Promise<void> {
  if (videoEl.readyState >= 2) return;
  await new Promise<void>((resolve) => {
    let done = false;
    let timeoutId = 0;
    const finish = (): void => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("loadeddata", finish);
      videoEl.removeEventListener("canplay", finish);
      videoEl.removeEventListener("error", finish);
      if (timeoutId) window.clearTimeout(timeoutId);
      resolve();
    };
    timeoutId = window.setTimeout(finish, timeoutMs);
    // NOTE: do NOT listen to "loadedmetadata" — it fires at readyState=1 (HAVE_METADATA)
    // which is BEFORE the first frame is decoded. Resolving on it makes the caller
    // re-test readyState<2 and bail with an empty canvas → flicker every render tick.
    videoEl.addEventListener("loadeddata", finish, { once: true });
    videoEl.addEventListener("canplay", finish, { once: true });
    videoEl.addEventListener("error", finish, { once: true });
    // DO NOT call v.load() here. The browser emits a transient "suspend" event
    // (networkState=1, readyState=0) during normal loading, ~70ms before loadedmetadata.
    // Calling load() on networkState=1 resets the video → suspend → load() → infinite loop.
    // Instead, load() is called exactly once, explicitly, in the creation path.
  });
}

export function renderImageSourceToCanvas(
  node: ComfyNode,
  source: CanvasImageSource,
  width: number,
  height: number,
  slot: "imageCanvas" | "animatedImageCanvas" | "videoCanvas" | "nativeCanvas",
): HTMLCanvasElement {
  node.__imageops_media ??= {} as MediaState;
  const st = node.__imageops_media!;
  const canvas = ensureCanvasSize(st[slot], width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  st[slot] = canvas;
  return canvas;
}

export function resolveNodeIntrinsicMediaSize(node: ComfyNode, fallbackCanvas: HTMLCanvasElement | null | undefined): { width: number; height: number } {
  const nativeImage = getNativePreviewImage(node);
  if (nativeImage && nativeImage.naturalWidth > 0 && nativeImage.naturalHeight > 0) {
    return {
      width: Math.max(1, nativeImage.naturalWidth),
      height: Math.max(1, nativeImage.naturalHeight),
    };
  }

  const previewMedia = Array.isArray(node.imgs) && node.imgs.length > 0
    ? node.imgs[Math.max(0, Math.min(node.imgs.length - 1, typeof node.imageIndex === "number" ? node.imageIndex : node.imgs.length - 1))] ?? null
    : null;

  if (previewMedia instanceof HTMLImageElement && previewMedia.naturalWidth > 0 && previewMedia.naturalHeight > 0) {
    return {
      width: Math.max(1, previewMedia.naturalWidth),
      height: Math.max(1, previewMedia.naturalHeight),
    };
  }
  if (previewMedia instanceof HTMLVideoElement && previewMedia.videoWidth > 0 && previewMedia.videoHeight > 0) {
    return {
      width: Math.max(1, previewMedia.videoWidth),
      height: Math.max(1, previewMedia.videoHeight),
    };
  }
  if (previewMedia instanceof HTMLCanvasElement && previewMedia.width > 0 && previewMedia.height > 0) {
    return {
      width: Math.max(1, previewMedia.width),
      height: Math.max(1, previewMedia.height),
    };
  }

  for (const widget of (node.widgets ?? [])) {
    const element = widget?.element;
    if (!element) continue;
    const media = element instanceof HTMLImageElement || element instanceof HTMLVideoElement || element instanceof HTMLCanvasElement
      ? element
      : element.querySelector?.("img,video,canvas") ?? null;
    if (media instanceof HTMLImageElement && media.naturalWidth > 0 && media.naturalHeight > 0) {
      return {
        width: Math.max(1, media.naturalWidth),
        height: Math.max(1, media.naturalHeight),
      };
    }
    if (media instanceof HTMLVideoElement && media.videoWidth > 0 && media.videoHeight > 0) {
      return {
        width: Math.max(1, media.videoWidth),
        height: Math.max(1, media.videoHeight),
      };
    }
    if (media instanceof HTMLCanvasElement && media.width > 0 && media.height > 0) {
      return {
        width: Math.max(1, media.width),
        height: Math.max(1, media.height),
      };
    }
  }

  return {
    width: Math.max(1, fallbackCanvas?.width || 1),
    height: Math.max(1, fallbackCanvas?.height || 1),
  };
}

export async function ensureImageElement(node: ComfyNode, url: string): Promise<HTMLImageElement | null> {
  node.__imageops_media ??= {} as MediaState;
  const st = node.__imageops_media!;
  if (st.lastImageURL === url && st.imageEl) return st.imageEl;

  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { console.warn("[ImageOps] image decode failed:", url, e); return null; }
  st.lastImageURL = url;
  st.imageEl = img;
  if (st.lastBitmapURL !== url) {
    // Close the old bitmap before dropping the reference — ImageBitmap holds GPU memory
    // and is not automatically released by GC without an explicit .close() call.
    st.lastBitmap?.close();
    st.lastBitmapURL = undefined;
    st.lastBitmap = undefined;
  }
  return img;
}

export async function ensureBitmap(node: ComfyNode, url: string): Promise<ImageBitmap | null> {
  node.__imageops_media ??= {} as MediaState;
  const st = node.__imageops_media!;
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

export async function ensureVideoFrameCanvas(node: ComfyNode, url: string, size: number, tick: number = 0): Promise<HTMLCanvasElement> {
  node.__imageops_media ??= {} as MediaState;
  const st = node.__imageops_media!;

  if (!st.videoEl || st.lastVideoURL !== url) {
    // Stop and unload the previous element to release CPU/memory before replacing it.
    if (st.videoEl) {
      try { st.videoEl.pause(); } catch {}
      try { st.videoEl.removeAttribute("src"); st.videoEl.load(); } catch {}
    }
    const v = document.createElement("video");
    v.preload = "auto";
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    // Assign BEFORE await so concurrent RAF calls see this element and don't create
    // additional duplicate video elements while we wait for the first one to load.
    st.videoEl = v;
    st.lastVideoURL = url;
    (st as any).lastVideoFrameKey = null;
    // After src assignment, networkState is synchronously NETWORK_NO_SOURCE (3) because
    // the resource-selection algorithm runs asynchronously. Call load() exactly once to
    // start the download. waitForVideoReady() must NOT call load() again — see comment there.
    try { v.load(); } catch {}
    await waitForVideoReady(v);
    // Guard: URL may have changed during the await — only play if still our element
    if (st.videoEl === v) {
      try { await v.play(); } catch (e) { console.warn("[ImageOps] video play failed:", e); }
    }
  }

  const v = st.videoEl!;
  void tick;

  // If the video isn't playable yet (still buffering / cold start), return the LAST
  // successfully drawn frame instead of allocating a fresh empty canvas. This avoids
  // a one-frame-empty flash every time the buffer underruns (readyState drops to 1).
  // Only allocate a placeholder canvas if we don't have a previous frame at all.
  if (v.readyState < 2) {
    await waitForVideoReady(v, 1500);
    if (v.readyState < 2) {
      if (st.videoCanvas) return st.videoCanvas;
      // First-ever call and still not ready — cache the empty canvas so subsequent
      // not-ready ticks reuse it instead of reallocating (and blinking) every frame.
      const placeholder = ensureCanvasSize(st.videoCanvas, Math.max(1, size), Math.max(1, size));
      st.videoCanvas = placeholder;
      return placeholder;
    }
  }

  const { width, height } = fitWithinMaxSize(v.videoWidth || size, v.videoHeight || size, size);
  // Preserve previous frame content across resizes so a size change doesn't blank.
  let c = st.videoCanvas;
  if (!c) {
    c = ensureCanvasSize(undefined, width, height);
  } else if (c.width !== width || c.height !== height) {
    const next = document.createElement("canvas");
    next.width = Math.max(1, Math.round(width));
    next.height = Math.max(1, Math.round(height));
    try { next.getContext("2d")?.drawImage(c, 0, 0, next.width, next.height); } catch {}
    c = next;
  }
  st.videoCanvas = c;
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  // Avoid spamming v.play() on every tick when the browser repeatedly pauses on
  // buffer underrun — a single in-flight play() is enough; the next tick will
  // pick up automatically when the video resumes.
  if (v.paused && !(st as any).videoPlayInFlight) {
    (st as any).videoPlayInFlight = true;
    v.play().catch(() => { /* ignore — browser autoplay / buffering */ })
      .finally(() => { (st as any).videoPlayInFlight = false; });
  }

  // Frame de-duplication: a 60 FPS preview loop pulling from a 24/30 FPS source
  // will redraw the same frame 2-3 times per cycle. Skip the drawImage when the
  // currentTime/size fingerprint hasn't moved — saves CPU + GC pressure.
  const frameKey = `${v.currentTime.toFixed(4)}|${width}x${height}`;
  if ((st as any).lastVideoFrameKey === frameKey) return c;
  (st as any).lastVideoFrameKey = frameKey;

  ctx.drawImage(v, 0, 0, width, height);
  return c;
}

/**
 * Release every transient resource held by a node's MediaState. Safe to call
 * multiple times. Should be invoked from `node.onRemoved` so videos stop playing
 * and ImageBitmaps return GPU memory immediately, instead of waiting for GC.
 */
export function disposeMediaState(node: ComfyNode): void {
  const st = node.__imageops_media;
  if (!st) return;
  try {
    if (st.videoEl) {
      try { st.videoEl.pause(); } catch {}
      try { st.videoEl.removeAttribute("src"); st.videoEl.load(); } catch {}
    }
  } catch {}
  try { st.lastBitmap?.close(); } catch {}
  st.videoEl = undefined;
  st.lastVideoURL = undefined;
  st.lastBitmap = undefined;
  st.lastBitmapURL = undefined;
  st.imageEl = undefined;
  st.lastImageURL = undefined;
  st.imageCanvas = undefined;
  st.animatedImageCanvas = undefined;
  st.videoCanvas = undefined;
  st.nativeCanvas = undefined;
  st.staticRenderCache?.clear();
  st.staticRenderCache = undefined;
  (st as any).lastVideoFrameKey = null;
}
