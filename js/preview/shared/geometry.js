function clampPreviewZoom(zoom) {
  return Math.max(0.35, Math.min(6, zoom));
}
function screenToWorld(x, y, zoom, panX, panY, canvasSize) {
  const half = canvasSize / 2;
  return {
    x: (x - panX - half) / zoom + half,
    y: (y - panY - half) / zoom + half
  };
}
function getFitPlacement(width, height, sourceWidth, sourceHeight) {
  const safeWidth = Math.max(1, sourceWidth);
  const safeHeight = Math.max(1, sourceHeight);
  const scale = Math.min(width / safeWidth, height / safeHeight);
  const drawWidth = Math.max(1, Math.floor(safeWidth * scale));
  const drawHeight = Math.max(1, Math.floor(safeHeight * scale));
  const dx = Math.floor((width - drawWidth) / 2);
  const dy = Math.floor((height - drawHeight) / 2);
  return { dx, dy, drawWidth, drawHeight };
}
function drawFitSource(ctx, width, height, source, sourceWidth, sourceHeight, fit) {
  const placement = fit ?? getFitPlacement(width, height, sourceWidth, sourceHeight);
  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, placement.dx, placement.dy, placement.drawWidth, placement.drawHeight);
}
function drawOutputFormatBox(ctx, fit, label = "Output") {
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
function getCanvasPointer(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, rect.width);
  const scaleY = canvas.height / Math.max(1, rect.height);
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}
export {
  clampPreviewZoom,
  drawFitSource,
  drawOutputFormatBox,
  getCanvasPointer,
  getFitPlacement,
  screenToWorld
};
