import type { ComfyNode, ComfyWidget } from "../types.js";

export type DrawTool = "brush" | "eraser";
export type DrawEdgeMode = "hard" | "soft";

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

function hasVisiblePixels(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) return true;
  }
  return false;
}

export function canvasToOverlayData(canvas: HTMLCanvasElement | null): string {
  if (!canvas || !hasVisiblePixels(canvas)) return "";
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
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

export async function loadOverlayCanvas(overlayData: string, width: number, height: number): Promise<HTMLCanvasElement> {
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

export async function resolveDrawOverlayCanvas(node: ComfyNode, width: number, height: number): Promise<HTMLCanvasElement> {
  const targetWidth = normalizeCanvasDimension(width, 1);
  const targetHeight = normalizeCanvasDimension(height, 1);
  const overlayData = widgetString(node, "overlay_data", "");
  const st = node.__imageops_state;

  if (st?.drawCanvas && st.drawOverlayKey === overlayData && st.drawCanvas.width === targetWidth && st.drawCanvas.height === targetHeight) {
    return st.drawCanvas;
  }

  const canvas = overlayData
    ? await loadOverlayCanvas(overlayData, targetWidth, targetHeight)
    : makeCanvas(targetWidth, targetHeight);

  if (st) {
    st.drawCanvas = canvas;
    st.drawOverlayKey = overlayData;
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
