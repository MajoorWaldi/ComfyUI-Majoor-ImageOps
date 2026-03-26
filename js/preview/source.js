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
function makeViewUrl(api, rawFilename) {
  const { filename, subfolder, type } = parseAnnotated(rawFilename);
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, type, subfolder });
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
async function ensureImageElement(node, url) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  if (st.lastImageURL === url && st.imageEl) return st.imageEl;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  st.lastImageURL = url;
  st.imageEl = img;
  if (st.lastBitmapURL !== url) {
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
async function ensureVideoFrameCanvas(node, url, size) {
  node.__imageops_media ?? (node.__imageops_media = {});
  const st = node.__imageops_media;
  if (!st.videoEl || st.lastVideoURL !== url) {
    const v2 = document.createElement("video");
    v2.src = url;
    v2.muted = true;
    v2.loop = true;
    v2.playsInline = true;
    v2.autoplay = true;
    try {
      await v2.play();
    } catch {
    }
    st.videoEl = v2;
    st.lastVideoURL = url;
  }
  const v = st.videoEl;
  const { width, height } = fitWithinMaxSize(v.videoWidth || size, v.videoHeight || size, size);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  if (v.readyState < 2) return c;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(v, 0, 0, width, height);
  return c;
}
export {
  ensureBitmap,
  ensureImageElement,
  ensureVideoFrameCanvas,
  fitWithinMaxSize,
  makeViewUrl,
  parseAnnotated
};
