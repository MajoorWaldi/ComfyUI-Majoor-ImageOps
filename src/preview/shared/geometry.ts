export interface FitPlacement {
  dx: number;
  dy: number;
  drawWidth: number;
  drawHeight: number;
}

export function clampPreviewZoom(zoom: number): number {
  return Math.max(0.35, Math.min(6, zoom));
}

/**
 * Converts a screen-space canvas pixel position (from getCanvasPointer) to world-space
 * (the pre-zoom/pan coordinate space in which geometry objects store their positions).
 *
 * Inverse of the blit transform:
 *   screen = zoom * (world - half) + half + pan
 *   world  = (screen - pan - half) / zoom + half
 */
export function screenToWorld(
  x: number,
  y: number,
  zoom: number,
  panX: number,
  panY: number,
  canvasSize: number,
): { x: number; y: number } {
  const half = canvasSize / 2;
  return {
    x: (x - panX - half) / zoom + half,
    y: (y - panY - half) / zoom + half,
  };
}

export function getFitPlacement(width: number, height: number, sourceWidth: number, sourceHeight: number): FitPlacement {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(width / safeWidth, height / safeHeight);
  const drawWidth = Math.max(1, Math.floor(safeWidth * scale));
  const drawHeight = Math.max(1, Math.floor(safeHeight * scale));
  const dx = Math.floor((width - drawWidth) / 2);
  const dy = Math.floor((height - drawHeight) / 2);
  return { dx, dy, drawWidth, drawHeight };
}

export function drawFitSource(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  fit?: FitPlacement,
): void {
  const placement = fit ?? getFitPlacement(width, height, sourceWidth, sourceHeight);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, placement.dx, placement.dy, placement.drawWidth, placement.drawHeight);
}

export function drawOutputFormatBox(ctx: CanvasRenderingContext2D, fit: FitPlacement, label: string = "Output"): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.24)";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(fit.dx + 0.5, fit.dy + 0.5, fit.drawWidth, fit.drawHeight);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(10,12,16,0.72)";
  ctx.fillRect(fit.dx + 6, fit.dy + 6, 52, 16);
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  ctx.font = "10px sans-serif";
  ctx.fillText(label, fit.dx + 10, fit.dy + 18);
  ctx.restore();
}

export function getCanvasPointer(canvas: HTMLCanvasElement, event: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  // Guard against detached or zero-size canvas (Node 2.0 deferred DOM insertion).
  if (rect.width < 1 || rect.height < 1) return { x: 0, y: 0 };
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}
