// Media source helpers (v6)
export function parseAnnotated(raw) {
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

export function makeViewUrl(api, rawFilename) {
  const { filename, subfolder, type } = parseAnnotated(rawFilename);
  if (!filename) return null;
  const qs = new URLSearchParams({ filename, type, subfolder });
  return api.apiURL(`/view?${qs.toString()}`);
}

export async function ensureBitmap(node, url) {
  node.__imageops_media ??= {};
  const st = node.__imageops_media;
  if (st.lastBitmapURL === url && st.lastBitmap) return st.lastBitmap;

  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { return null; }
  const bmp = await createImageBitmap(img);
  st.lastBitmapURL = url;
  st.lastBitmap = bmp;
  return bmp;
}

export async function ensureVideoFrameCanvas(node, url, size) {
  node.__imageops_media ??= {};
  const st = node.__imageops_media;

  if (!st.videoEl || st.lastVideoURL !== url) {
    const v = document.createElement("video");
    v.src = url;
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    try { await v.play(); } catch {}
    st.videoEl = v;
    st.lastVideoURL = url;
  }

  const v = st.videoEl;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");

  if (v.readyState < 2) return c;

  ctx.clearRect(0,0,size,size);

  const iw = v.videoWidth || 1;
  const ih = v.videoHeight || 1;
  const s = Math.min(size / iw, size / ih);
  const dw = Math.max(1, Math.floor(iw * s));
  const dh = Math.max(1, Math.floor(ih * s));
  const dx = Math.floor((size - dw) / 2);
  const dy = Math.floor((size - dh) / 2);
  ctx.drawImage(v, dx, dy, dw, dh);
  return c;
}
