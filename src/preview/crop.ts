export interface CropRect {
  x: number;
  y: number;
  cropWidth: number;
  cropHeight: number;
}

export function clampCropCenter(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.5));
}

export function clampCropScale(value: number): number {
  return Math.max(0.05, Math.min(1, Number.isFinite(value) ? value : 1));
}

export function resolveCropAspectRatio(aspectRatio: string, outW: number, outH: number): number {
  switch (String(aspectRatio || "custom").toLowerCase()) {
    case "1:1": return 1;
    case "3:4": return 3 / 4;
    case "4:3": return 4 / 3;
    case "16:9": return 16 / 9;
    case "9:16": return 9 / 16;
    default: return Math.max(1, outW) / Math.max(1, outH);
  }
}

export function computeCropRect(
  sourceWidth: number,
  sourceHeight: number,
  targetRatio: number,
  centerX: number,
  centerY: number,
  scale: number,
): CropRect {
  const safeSourceWidth = Math.max(1, Math.round(sourceWidth));
  const safeSourceHeight = Math.max(1, Math.round(sourceHeight));
  const safeRatio = Math.max(0.0001, targetRatio);
  const sourceRatio = safeSourceWidth / Math.max(1, safeSourceHeight);

  let baseWidth = safeSourceWidth;
  let baseHeight = safeSourceHeight;
  if (Math.abs(sourceRatio - safeRatio) > 0.0001) {
    if (sourceRatio > safeRatio) {
      baseWidth = Math.max(1, Math.min(safeSourceWidth, Math.round(safeSourceHeight * safeRatio)));
    } else {
      baseHeight = Math.max(1, Math.min(safeSourceHeight, Math.round(safeSourceWidth / safeRatio)));
    }
  }

  const safeScale = clampCropScale(scale);
  const cropWidth = Math.max(1, Math.min(safeSourceWidth, Math.round(baseWidth * safeScale)));
  const cropHeight = Math.max(1, Math.min(safeSourceHeight, Math.round(baseHeight * safeScale)));

  const normalizedCenterX = clampCropCenter(centerX);
  const normalizedCenterY = clampCropCenter(centerY);
  let centerPx = normalizedCenterX * safeSourceWidth;
  let centerPy = normalizedCenterY * safeSourceHeight;

  const minCx = cropWidth / 2;
  const maxCx = safeSourceWidth - cropWidth / 2;
  const minCy = cropHeight / 2;
  const maxCy = safeSourceHeight - cropHeight / 2;
  centerPx = maxCx < minCx ? safeSourceWidth / 2 : Math.max(minCx, Math.min(maxCx, centerPx));
  centerPy = maxCy < minCy ? safeSourceHeight / 2 : Math.max(minCy, Math.min(maxCy, centerPy));

  const x = Math.max(0, Math.min(safeSourceWidth - cropWidth, Math.round(centerPx - cropWidth / 2)));
  const y = Math.max(0, Math.min(safeSourceHeight - cropHeight, Math.round(centerPy - cropHeight / 2)));
  return { x, y, cropWidth, cropHeight };
}
