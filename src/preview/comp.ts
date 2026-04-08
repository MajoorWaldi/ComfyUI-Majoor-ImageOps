import type { ComfyInputSlot, ComfyNode } from "../types.js";

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
    })),
  });
}

export function computeCompRect(outputWidth: number, outputHeight: number, sourceWidth: number, sourceHeight: number, layer: CompLayerModel): CompRect {
  const drawWidth = Math.max(1, Math.round(Math.max(1, sourceWidth) * clampCompScale(layer.scale)));
  const drawHeight = Math.max(1, Math.round(Math.max(1, sourceHeight) * clampCompScale(layer.scale)));
  const centerX = clampCompCenter(layer.centerX) * Math.max(1, outputWidth);
  const centerY = clampCompCenter(layer.centerY) * Math.max(1, outputHeight);
  const rad = clampCompRotation(layer.rotationDeg) * Math.PI / 180;
  const absCos = Math.abs(Math.cos(rad));
  const absSin = Math.abs(Math.sin(rad));
  const width = Math.max(1, Math.round(drawWidth * absCos + drawHeight * absSin));
  const height = Math.max(1, Math.round(drawWidth * absSin + drawHeight * absCos));
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
