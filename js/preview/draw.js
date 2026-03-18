function widget(node, name) {
  return node?.widgets?.find((entry) => entry?.name === name) ?? null;
}
function widgetNumber(node, name, fallback) {
  const value = widget(node, name)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function widgetString(node, name, fallback) {
  const value = widget(node, name)?.value;
  return typeof value === "string" ? value : fallback;
}
function widgetBoolean(node, name, fallback) {
  const value = widget(node, name)?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !!value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}
function clampDrawDimension(value, fallback = 1024) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(64, Math.min(4096, Math.round(parsed)));
}
function normalizeCanvasDimension(value, fallback = 1) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.round(parsed));
}
function clampDrawOpacity(value, fallback = 1) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, parsed));
}
function clampDrawSize(value, fallback = 10) {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(256, Math.round(parsed)));
}
function normalizeDrawColor(value, fallback = "#ffffff") {
  const text = String(value || fallback).trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(text);
  return match ? `#${match[1].toUpperCase()}` : fallback.toUpperCase();
}
function normalizeDrawTool(value) {
  return String(value || "brush").toLowerCase() === "eraser" ? "eraser" : "brush";
}
function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = normalizeCanvasDimension(width, 1);
  canvas.height = normalizeCanvasDimension(height, 1);
  return canvas;
}
function resizeCanvasPreserve(source, width, height) {
  const target = makeCanvas(width, height);
  if (!source) return target;
  const ctx = target.getContext("2d");
  if (!ctx) return target;
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, target.width, target.height);
  return target;
}
function hasVisiblePixels(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}
function canvasToOverlayData(canvas) {
  if (!canvas || !hasVisiblePixels(canvas)) return "";
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
function hexToCss(color) {
  return normalizeDrawColor(color, "#000000");
}
async function loadDataUrlImage(dataUrl) {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = raw;
  });
}
async function loadOverlayCanvas(overlayData, width, height) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const image = await loadDataUrlImage(overlayData);
  if (!image) return canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
async function resolveDrawOverlayCanvas(node, width, height) {
  const targetWidth = normalizeCanvasDimension(width, 1);
  const targetHeight = normalizeCanvasDimension(height, 1);
  const overlayData = widgetString(node, "overlay_data", "");
  const st = node.__imageops_state;
  if (st?.drawCanvas && st.drawOverlayKey === overlayData && st.drawCanvas.width === targetWidth && st.drawCanvas.height === targetHeight) {
    return st.drawCanvas;
  }
  const canvas = overlayData ? await loadOverlayCanvas(overlayData, targetWidth, targetHeight) : makeCanvas(targetWidth, targetHeight);
  if (st) {
    st.drawCanvas = canvas;
    st.drawOverlayKey = overlayData;
  }
  return canvas;
}
function makeSolidBackgroundCanvas(width, height, bgColor) {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = hexToCss(bgColor);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
async function renderDrawPreview(node, baseCanvas = null) {
  const width = baseCanvas?.width || clampDrawDimension(widgetNumber(node, "width", 1024));
  const height = baseCanvas?.height || clampDrawDimension(widgetNumber(node, "height", 1024));
  const output = baseCanvas ? resizeCanvasPreserve(baseCanvas, width, height) : makeSolidBackgroundCanvas(width, height, widgetString(node, "bg_color", "#000000"));
  if (widgetBoolean(node, "bypass", false)) {
    return output;
  }
  const overlay = await resolveDrawOverlayCanvas(node, width, height);
  const ctx = output.getContext("2d");
  if (!ctx) return output;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(overlay, 0, 0, output.width, output.height);
  return output;
}
export {
  canvasToOverlayData,
  clampDrawDimension,
  clampDrawOpacity,
  clampDrawSize,
  loadOverlayCanvas,
  makeCanvas,
  makeSolidBackgroundCanvas,
  normalizeDrawColor,
  normalizeDrawTool,
  renderDrawPreview,
  resizeCanvasPreserve,
  resolveDrawOverlayCanvas
};
