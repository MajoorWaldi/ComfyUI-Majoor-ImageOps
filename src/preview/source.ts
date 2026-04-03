// Media source helpers (v6)
import type { ComfyNode, ComfyAPI, AnnotatedFilename, MediaState } from "../types.js";

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

export function makeViewUrl(api: ComfyAPI, rawFilename: string): string | null {
  const { filename, subfolder, type } = parseAnnotated(rawFilename);
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, type, subfolder });
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

function syncVideoToTick(video: HTMLVideoElement, tick: number): void {
  if (!Number.isFinite(tick) || tick < 0) return;
  if (video.readyState < 1) return;
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return;

  // `tick` is a render-loop counter, not seconds. Map it to a stable preview
  // timeline to avoid forced seeks on every animation frame.
  const previewFps = 30;
  const targetTime = (tick / previewFps) % duration;
  // Skip if a seek is already in-flight — prevents seek queue accumulation at 60 fps.
  if (video.seeking) return;
  if (Math.abs(video.currentTime - targetTime) > 0.1) {
    try {
      video.currentTime = targetTime;
    } catch (e) {
      console.warn("[ImageOps] video seek failed:", e);
    }
  }
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
      st.videoEl.pause();
      st.videoEl.removeAttribute("src");
      st.videoEl.load();
    }
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    try { await v.play(); } catch (e) { console.warn("[ImageOps] video play failed:", e); }
    st.videoEl = v;
    st.lastVideoURL = url;
  }

  const v = st.videoEl!;
  syncVideoToTick(v, tick);
  const { width, height } = fitWithinMaxSize(v.videoWidth || size, v.videoHeight || size, size);
  const c = ensureCanvasSize(st.videoCanvas, width, height);
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  if (v.readyState < 2) return c;

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(v, 0, 0, width, height);
  st.videoCanvas = c;
  return c;
}
