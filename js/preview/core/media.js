import { api } from "../../../../scripts/api.js";
function getInputIndexByName(node, name) {
  return (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === name);
}
function getNativePreviewImage(node) {
  const imgs = node.imgs;
  if (!Array.isArray(imgs) || imgs.length === 0) return null;
  const index = typeof node.imageIndex === "number" ? node.imageIndex : imgs.length - 1;
  const candidate = imgs[Math.max(0, Math.min(imgs.length - 1, index))] ?? imgs[imgs.length - 1] ?? null;
  return candidate instanceof HTMLImageElement ? candidate : null;
}
function parsePreviewSourceUrl(src) {
  try {
    return new URL(src, window.location.href);
  } catch {
    return null;
  }
}
function nativePreviewFilename(node) {
  const img = getNativePreviewImage(node);
  const parsed = parsePreviewSourceUrl(img?.src ?? "");
  return parsed?.searchParams.get("filename") ?? null;
}
function buildMediaPreviewUrl(node, canvasSize) {
  const img = getNativePreviewImage(node);
  const parsed = parsePreviewSourceUrl(img?.src ?? "");
  if (!parsed) return null;
  const filename = parsed.searchParams.get("filename");
  const type = parsed.searchParams.get("type") ?? "temp";
  const subfolder = parsed.searchParams.get("subfolder") ?? "";
  if (!filename) return null;
  const params = new URLSearchParams({
    filename,
    type,
    subfolder,
    force_size: `${Math.max(128, canvasSize * 2)}x?`,
    deadline: "realtime"
  });
  return api.apiURL(`/imageops/viewmedia?${params.toString()}`);
}
function hideNativeMediaPreview(st) {
  if (st.mediaVideo) {
    st.mediaVideo.pause();
    st.mediaVideo.hidden = true;
    st.mediaVideo.removeAttribute("src");
    st.mediaVideo.load();
  }
  if (st.mediaImage) {
    st.mediaImage.hidden = true;
    st.mediaImage.removeAttribute("src");
  }
  if (st.mediaWrap) st.mediaWrap.style.display = "none";
  if (st.canvas) st.canvas.style.display = "block";
}
function showNativeMediaPreview(node, st, canvasSize) {
  if (!st.nativeAnimated || !st.mediaWrap) return false;
  const img = getNativePreviewImage(node);
  if (!img) return false;
  const filename = String(nativePreviewFilename(node) ?? "").toLowerCase();
  const isAnimatedImage = filename.endsWith(".webp") || filename.endsWith(".gif");
  if (isAnimatedImage && st.mediaImage) {
    if (st.mediaVideo) {
      st.mediaVideo.pause();
      st.mediaVideo.hidden = true;
      st.mediaVideo.removeAttribute("src");
      st.mediaVideo.load();
    }
    st.mediaWrap.style.display = "block";
    st.mediaImage.hidden = false;
    if (st.mediaImage.src !== img.src) {
      st.mediaImage.src = img.src;
    }
    if (st.canvas) st.canvas.style.display = "none";
    return true;
  }
  if (!st.mediaVideo) return false;
  const mediaUrl = buildMediaPreviewUrl(node, canvasSize);
  if (!mediaUrl) return false;
  if (st.mediaImage) {
    st.mediaImage.hidden = true;
    st.mediaImage.removeAttribute("src");
  }
  st.mediaWrap.style.display = "block";
  st.mediaVideo.hidden = false;
  if (st.mediaVideo.src !== mediaUrl) {
    st.mediaVideo.src = mediaUrl;
  }
  st.mediaVideo.muted = true;
  void st.mediaVideo.play().catch(() => {
  });
  if (st.canvas) st.canvas.style.display = "none";
  return true;
}
export * from "./video.js";
export {
  buildMediaPreviewUrl,
  getInputIndexByName,
  getNativePreviewImage,
  hideNativeMediaPreview,
  nativePreviewFilename,
  parsePreviewSourceUrl,
  showNativeMediaPreview
};
