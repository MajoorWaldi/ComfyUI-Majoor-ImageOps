import type { ComfyInputSlot, ComfyNode, CornerPinHandle } from "../types.js";

export const COMP_BLEND_MODES = [
  "over",
  "add",
  "multiply",
  "screen",
  "overlay",
  "soft_light",
  "difference",
  "lighten",
  "darken",
  "color_dodge",
  "color_burn",
  "exclusion",
] as const;

export interface CompLayerModel {
  slot: string;
  centerX: number;
  centerY: number;
  scale: number;
  rotationDeg: number;
  opacity: number;
  mode: string;
  enabled: boolean;
  tlX?: number | null;
  tlY?: number | null;
  trX?: number | null;
  trY?: number | null;
  blX?: number | null;
  blY?: number | null;
  brX?: number | null;
  brY?: number | null;
}

export interface CompSlotInfo {
  slot: string;
  inputIndex: number;
  layerNumber: number;
  maskSlot: string;
  maskInputIndex: number | null;
}

export interface CompRect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  drawWidth: number;
  drawHeight: number;
  centerX: number;
  centerY: number;
  rotationDeg: number;
}

function inputName(input: ComfyInputSlot | undefined | null): string {
  return String(input?.name ?? "");
}

export function clampCompCenter(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(-2, Math.min(3, value));
}

export function clampCompScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.05, Math.min(8, value));
}

export function clampCompRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.max(-180, Math.min(180, normalized));
}

function clampCompPoint(value: unknown): number | null {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return clampCompCenter(numeric);
}

function hasFiniteCompPoint(value: unknown): boolean {
  if (value == null || value === "") return false;
  return Number.isFinite(Number(value));
}

function hasNonDegenerateCompQuad(layer: Partial<CompLayerModel>): boolean {
  const xs = [Number(layer.tlX), Number(layer.trX), Number(layer.blX), Number(layer.brX)];
  const ys = [Number(layer.tlY), Number(layer.trY), Number(layer.blY), Number(layer.brY)];
  return (Math.max(...xs) - Math.min(...xs)) > 1e-4 && (Math.max(...ys) - Math.min(...ys)) > 1e-4;
}

function defaultCompLayer(slot: string, index: number): CompLayerModel {
  const offset = Math.min(index, 4) * 0.04;
  return {
    slot,
    centerX: 0.5 + offset,
    centerY: 0.5 + offset,
    scale: index === 0 ? 1 : 0.5,
    rotationDeg: 0,
    opacity: 1,
    mode: "over",
    enabled: true,
  };
}

function normalizeCompLayer(slot: string, index: number, layer: Partial<CompLayerModel> | null | undefined): CompLayerModel {
  const fallback = defaultCompLayer(slot, index);
  const anyLayer = (layer ?? {}) as Record<string, unknown>;
  const mode = String(anyLayer.mode ?? fallback.mode).trim().toLowerCase().replace(/[-\s]+/g, "_");
  return {
    slot,
    centerX: clampCompCenter(Number(anyLayer.centerX ?? anyLayer.center_x ?? fallback.centerX)),
    centerY: clampCompCenter(Number(anyLayer.centerY ?? anyLayer.center_y ?? fallback.centerY)),
    scale: clampCompScale(Number(anyLayer.scale ?? fallback.scale)),
    rotationDeg: clampCompRotation(Number(anyLayer.rotationDeg ?? anyLayer.rotate_deg ?? anyLayer.rotation_deg ?? anyLayer.rotation ?? fallback.rotationDeg)),
    opacity: Math.max(0, Math.min(1, Number(anyLayer.opacity ?? fallback.opacity))),
    mode: COMP_BLEND_MODES.includes(mode as (typeof COMP_BLEND_MODES)[number]) ? mode : "over",
    enabled: anyLayer.enabled !== false,
    tlX: clampCompPoint(anyLayer.tlX ?? anyLayer.tl_x),
    tlY: clampCompPoint(anyLayer.tlY ?? anyLayer.tl_y),
    trX: clampCompPoint(anyLayer.trX ?? anyLayer.tr_x),
    trY: clampCompPoint(anyLayer.trY ?? anyLayer.tr_y),
    blX: clampCompPoint(anyLayer.blX ?? anyLayer.bl_x),
    blY: clampCompPoint(anyLayer.blY ?? anyLayer.bl_y),
    brX: clampCompPoint(anyLayer.brX ?? anyLayer.br_x),
    brY: clampCompPoint(anyLayer.brY ?? anyLayer.br_y),
  };
}

export function getCompSlots(node: ComfyNode): CompSlotInfo[] {
  const slotMap = new Map<number, CompSlotInfo>();
  for (let inputIndex = 0; inputIndex < (node.inputs?.length ?? 0); inputIndex++) {
    const name = inputName(node.inputs?.[inputIndex]);
    const match = /^image_(\d+)$/.exec(name);
    if (match) {
      const layerNumber = Number(match[1]);
      slotMap.set(layerNumber, {
        slot: name,
        inputIndex,
        layerNumber,
        maskSlot: `mask_${layerNumber}`,
        maskInputIndex: null,
      });
    }
  }
  for (let inputIndex = 0; inputIndex < (node.inputs?.length ?? 0); inputIndex++) {
    const name = inputName(node.inputs?.[inputIndex]);
    const match = /^mask_(\d+)$/.exec(name);
    if (!match) continue;
    const layerNumber = Number(match[1]);
    const existing = slotMap.get(layerNumber);
    if (existing) {
      existing.maskInputIndex = inputIndex;
    } else {
      slotMap.set(layerNumber, {
        slot: `image_${layerNumber}`,
        inputIndex: -1,
        layerNumber,
        maskSlot: name,
        maskInputIndex: inputIndex,
      });
    }
  }
  return [...slotMap.values()]
    .filter((slot) => slot.inputIndex >= 0)
    .sort((a, b) => a.layerNumber - b.layerNumber);
}

export function parseCompLayers(raw: unknown): CompLayerModel[] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const source = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === "object" && Array.isArray((parsed as { layers?: unknown[] }).layers))
      ? (parsed as { layers: unknown[] }).layers
      : [];
  const layers: CompLayerModel[] = [];
  for (let index = 0; index < source.length; index++) {
    const entry = source[index];
    if (!entry || typeof entry !== "object") continue;
    const slot = String((entry as { slot?: unknown }).slot ?? "").trim();
    if (!slot) continue;
    layers.push(normalizeCompLayer(slot, index, entry as Partial<CompLayerModel>));
  }
  return layers;
}

export function syncCompLayers(raw: unknown, slots: CompSlotInfo[]): CompLayerModel[] {
  const existing = parseCompLayers(raw);
  const bySlot = new Map(existing.map((layer) => [layer.slot, layer]));
  return slots.map((slot, index) => normalizeCompLayer(slot.slot, index, bySlot.get(slot.slot)));
}

export function hasCompLayerCornerPin(layer: Partial<CompLayerModel> | null | undefined): boolean {
  if (!layer) return false;
  const hasAllPoints = [layer.tlX, layer.tlY, layer.trX, layer.trY, layer.blX, layer.blY, layer.brX, layer.brY].every(hasFiniteCompPoint);
  return hasAllPoints && hasNonDegenerateCompQuad(layer);
}

export function serializeCompLayers(layers: CompLayerModel[]): string {
  return JSON.stringify({
    version: 1,
    layers: layers.map((layer) => ({
      slot: layer.slot,
      center_x: layer.centerX,
      center_y: layer.centerY,
      scale: layer.scale,
      rotate_deg: layer.rotationDeg,
      opacity: layer.opacity,
      mode: layer.mode,
      enabled: layer.enabled,
      ...(hasCompLayerCornerPin(layer)
        ? {
            tl_x: layer.tlX,
            tl_y: layer.tlY,
            tr_x: layer.trX,
            tr_y: layer.trY,
            bl_x: layer.blX,
            bl_y: layer.blY,
            br_x: layer.brX,
            br_y: layer.brY,
          }
        : {}),
    })),
  });
}

export function getCompLayerOutputCorners(
  outputWidth: number,
  outputHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  layer: CompLayerModel,
): Record<CornerPinHandle, { x: number; y: number }> {
  if (hasCompLayerCornerPin(layer)) {
    const maxX = Math.max(1, outputWidth - 1);
    const maxY = Math.max(1, outputHeight - 1);
    return {
      tl: { x: Number(layer.tlX) * maxX, y: Number(layer.tlY) * maxY },
      tr: { x: Number(layer.trX) * maxX, y: Number(layer.trY) * maxY },
      bl: { x: Number(layer.blX) * maxX, y: Number(layer.blY) * maxY },
      br: { x: Number(layer.brX) * maxX, y: Number(layer.brY) * maxY },
    };
  }

  const rect = computeCompRect(outputWidth, outputHeight, sourceWidth, sourceHeight, { ...layer, tlX: null, tlY: null, trX: null, trY: null, blX: null, blY: null, brX: null, brY: null });
  const angleRad = rect.rotationDeg * Math.PI / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfWidth = rect.drawWidth / 2;
  const halfHeight = rect.drawHeight / 2;
  const makeCorner = (localX: number, localY: number) => ({
    x: rect.centerX + localX * cos - localY * sin,
    y: rect.centerY + localX * sin + localY * cos,
  });
  return {
    tl: makeCorner(-halfWidth, -halfHeight),
    tr: makeCorner(halfWidth, -halfHeight),
    bl: makeCorner(-halfWidth, halfHeight),
    br: makeCorner(halfWidth, halfHeight),
  };
}

export function computeCompRect(outputWidth: number, outputHeight: number, sourceWidth: number, sourceHeight: number, layer: CompLayerModel): CompRect {
  const drawWidth = Math.max(1, Math.round(Math.max(1, sourceWidth) * clampCompScale(layer.scale)));
  const drawHeight = Math.max(1, Math.round(Math.max(1, sourceHeight) * clampCompScale(layer.scale)));
  if (hasCompLayerCornerPin(layer)) {
    const points = getCompLayerOutputCorners(outputWidth, outputHeight, sourceWidth, sourceHeight, layer);
    const xs = [points.tl.x, points.tr.x, points.bl.x, points.br.x];
    const ys = [points.tl.y, points.tr.y, points.bl.y, points.br.y];
    const left = Math.round(Math.min(...xs));
    const top = Math.round(Math.min(...ys));
    const right = Math.round(Math.max(...xs));
    const bottom = Math.round(Math.max(...ys));
    return {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
      right,
      bottom,
      drawWidth,
      drawHeight,
      centerX: (points.tl.x + points.tr.x + points.bl.x + points.br.x) / 4,
      centerY: (points.tl.y + points.tr.y + points.bl.y + points.br.y) / 4,
      rotationDeg: clampCompRotation(layer.rotationDeg),
    };
  }
  const centerX = clampCompCenter(layer.centerX) * Math.max(1, outputWidth);
  const centerY = clampCompCenter(layer.centerY) * Math.max(1, outputHeight);
  const rad = clampCompRotation(layer.rotationDeg) * Math.PI / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const width = Math.max(1, Math.ceil(drawWidth * absCos + drawHeight * absSin));
  const height = Math.max(1, Math.ceil(drawWidth * absSin + drawHeight * absCos));
  const left = Math.round(centerX - width / 2);
  const top = Math.round(centerY - height / 2);
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    drawWidth,
    drawHeight,
    centerX,
    centerY,
    rotationDeg: clampCompRotation(layer.rotationDeg),
  };
}
