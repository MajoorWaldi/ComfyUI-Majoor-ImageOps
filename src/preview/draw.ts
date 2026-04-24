import type { ComfyNode, ComfyWidget } from "../types.js";

export type DrawTool = "brush" | "eraser";
export type DrawEdgeMode = "hard" | "soft";
export type DrawOverlayFormat = "webp" | "png";

interface DrawOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DrawOverlayPayload {
  version?: number;
  width?: number;
  height?: number;
  bounds?: DrawOverlayBounds | [number, number, number, number];
  data?: string;
  overlay_data?: string;
}

interface DrawOverlayLayerPayload {
  data: string;
  opacity: number;
}

function widget(node: ComfyNode, name: string): ComfyWidget | null {
  return node?.widgets?.find((entry) => entry?.name === name) ?? null;
}

function widgetNumber(node: ComfyNode, name: string, fallback: number): number {
  const value = widget(node, name)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function widgetString(node: ComfyNode, name: string, fallback: string): string {
  const value = widget(node, name)?.value;
  return typeof value === "string" ? value : fallback;
}

function widgetBoolean(node: ComfyNode, name: string, fallback: boolean): boolean {
  const value = widget(node, name)?.value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return !!value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

export function clampDrawDimension(value: number, fallback: number = 1024): number {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(64, Math.min(4096, Math.round(parsed)));
}

function normalizeCanvasDimension(value: number, fallback: number = 1): number {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.round(parsed));
}

export function clampDrawOpacity(value: number, fallback: number = 1): number {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function clampDrawSize(value: number, fallback: number = 10): number {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(256, Math.round(parsed)));
}

export function clampDrawSoftness(value: number, fallback: number = 0.5): number {
  const parsed = Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeDrawColor(value: string, fallback: string = "#ffffff"): string {
  const text = String(value || fallback).trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(text);
  return match ? `#${match[1].toUpperCase()}` : fallback.toUpperCase();
}

export function normalizeDrawTool(value: string): DrawTool {
  return String(value || "brush").toLowerCase() === "eraser" ? "eraser" : "brush";
}

export function normalizeDrawEdge(value: string): DrawEdgeMode {
  return String(value || "hard").toLowerCase() === "soft" ? "soft" : "hard";
}

export function normalizeDrawOverlayFormat(value: string): DrawOverlayFormat {
  return String(value || "png").toLowerCase() === "webp" ? "webp" : "png";
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = normalizeCanvasDimension(width, 1);
  canvas.height = normalizeCanvasDimension(height, 1);
  return canvas;
}

export function resizeCanvasPreserve(source: HTMLCanvasElement | null, width: number, height: number): HTMLCanvasElement {
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

function getVisibleBounds(canvas: HTMLCanvasElement): DrawOverlayBounds | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] <= 0) continue;
    const pixel = (index - 3) / 4;
    const x = pixel % canvas.width;
    const y = Math.floor(pixel / canvas.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function encodeOverlayCanvas(canvas: HTMLCanvasElement, format: DrawOverlayFormat): string {
  try {
    if (format === "webp") {
      const webp = canvas.toDataURL("image/webp", 0.92);
      if (webp.startsWith("data:image/webp")) return webp;
    }
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function canvasToOverlayData(canvas: HTMLCanvasElement | null, format: DrawOverlayFormat = "png"): string {
  if (!canvas) return "";
  const bounds = getVisibleBounds(canvas);
  if (!bounds) return "";

  const crop = makeCanvas(bounds.width, bounds.height);
  const ctx = crop.getContext("2d");
  if (!ctx) return "";
  ctx.clearRect(0, 0, crop.width, crop.height);
  ctx.drawImage(
    canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  const data = encodeOverlayCanvas(crop, format);
  if (!data) return "";
  if (bounds.x === 0 && bounds.y === 0 && bounds.width === canvas.width && bounds.height === canvas.height) {
    return data;
  }
  return JSON.stringify({
    version: 2,
    width: canvas.width,
    height: canvas.height,
    bounds,
    data,
  });
}

function hexToCss(color: string): string {
  return normalizeDrawColor(color, "#000000");
}

async function loadDataUrlImage(dataUrl: string): Promise<HTMLImageElement | null> {
  const raw = String(dataUrl || "").trim();
  if (!raw) return null;
  return await new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = raw;
  });
}

function normalizeOverlayBounds(bounds: DrawOverlayPayload["bounds"]): DrawOverlayBounds | null {
  if (Array.isArray(bounds) && bounds.length >= 4) {
    return {
      x: Math.round(Number(bounds[0]) || 0),
      y: Math.round(Number(bounds[1]) || 0),
      width: Math.max(1, Math.round(Number(bounds[2]) || 1)),
      height: Math.max(1, Math.round(Number(bounds[3]) || 1)),
    };
  }
  if (bounds && typeof bounds === "object" && !Array.isArray(bounds)) {
    return {
      x: Math.round(Number(bounds.x) || 0),
      y: Math.round(Number(bounds.y) || 0),
      width: Math.max(1, Math.round(Number(bounds.width) || 1)),
      height: Math.max(1, Math.round(Number(bounds.height) || 1)),
    };
  }
  return null;
}

function parseOverlayPayload(overlayData: string): DrawOverlayPayload | null {
  const raw = String(overlayData || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as DrawOverlayPayload : null;
  } catch {
    return null;
  }
}

function readOverlayLayerPayloads(node: ComfyNode): DrawOverlayLayerPayload[] {
  const raw = widgetString(node, "overlay_layers", "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const layers = Array.isArray(parsed) ? parsed : parsed?.layers;
    if (!Array.isArray(layers)) return [];
    const values: DrawOverlayLayerPayload[] = [];
    for (const layer of layers) {
      if (layer && typeof layer === "object") {
        if (layer.enabled === false) continue;
        const data = String(layer.data ?? layer.overlay_data ?? layer.payload ?? "").trim();
        const opacity = Math.max(0, Math.min(1, Number(layer.opacity ?? 1)));
        if (data) values.push({ data, opacity: Number.isFinite(opacity) ? opacity : 1 });
      } else {
        const data = String(layer ?? "").trim();
        if (data) values.push({ data, opacity: 1 });
      }
    }
    return values;
  } catch {
    return [];
  }
}

async function drawOverlayPayload(
  ctx: CanvasRenderingContext2D,
  overlayData: string,
  width: number,
  height: number,
  opacity: number = 1,
): Promise<void> {
  const payload = parseOverlayPayload(overlayData);
  const dataUrl = String(payload?.data ?? payload?.overlay_data ?? overlayData ?? "").trim();
  const image = await loadDataUrlImage(dataUrl);
  if (!image) return;

  const bounds = normalizeOverlayBounds(payload?.bounds);
  ctx.save();
  ctx.globalAlpha *= Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));
  if (!payload || !bounds) {
    ctx.drawImage(image, 0, 0, width, height);
    ctx.restore();
    return;
  }

  const sourceWidth = Math.max(1, Math.round(Number(payload.width) || width));
  const sourceHeight = Math.max(1, Math.round(Number(payload.height) || height));
  const x = Math.round(bounds.x * width / sourceWidth);
  const y = Math.round(bounds.y * height / sourceHeight);
  const drawWidth = Math.max(1, Math.round(bounds.width * width / sourceWidth));
  const drawHeight = Math.max(1, Math.round(bounds.height * height / sourceHeight));
  ctx.drawImage(image, x, y, drawWidth, drawHeight);
  ctx.restore();
}

export async function loadOverlayCanvas(overlayData: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  await drawOverlayPayload(ctx, overlayData, canvas.width, canvas.height);
  return canvas;
}

export async function resolveDrawOverlayCanvas(node: ComfyNode, width: number, height: number): Promise<HTMLCanvasElement> {
  const targetWidth = normalizeCanvasDimension(width, 1);
  const targetHeight = normalizeCanvasDimension(height, 1);
  const overlayData = widgetString(node, "overlay_data", "");
  const overlayLayers = widgetString(node, "overlay_layers", "");
  const overlayKey = `${overlayLayers}\n${overlayData}`;
  const st = node.__imageops_state;

  if (st?.drawCanvas && st.drawOverlayKey === overlayKey && st.drawCanvas.width === targetWidth && st.drawCanvas.height === targetHeight) {
    return st.drawCanvas;
  }

  const layerPayloads = readOverlayLayerPayloads(node);
  const canvas = makeCanvas(targetWidth, targetHeight);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const payloads = layerPayloads.length > 0 ? layerPayloads : (overlayData ? [{ data: overlayData, opacity: 1 }] : []);
    for (const payload of payloads) {
      await drawOverlayPayload(ctx, payload.data, targetWidth, targetHeight, payload.opacity);
    }
  }

  if (st) {
    st.drawCanvas = canvas;
    st.drawOverlayKey = overlayKey;
  }
  return canvas;
}

export function makeSolidBackgroundCanvas(width: number, height: number, bgColor: string): HTMLCanvasElement {
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = hexToCss(bgColor);
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function renderDrawPreview(node: ComfyNode, baseCanvas: HTMLCanvasElement | null = null): Promise<HTMLCanvasElement> {
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
