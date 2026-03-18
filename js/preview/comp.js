const COMP_BLEND_MODES = [
  "over",
  "add",
  "multiply",
  "screen",
  "overlay",
  "soft_light",
  "difference",
  "lighten",
  "darken"
];
function inputName(input) {
  return String(input?.name ?? "");
}
function clampCompCenter(value) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(-2, Math.min(3, value));
}
function clampCompScale(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.05, Math.min(8, value));
}
function defaultCompLayer(slot, index) {
  const offset = Math.min(index, 4) * 0.04;
  return {
    slot,
    centerX: 0.5 + offset,
    centerY: 0.5 + offset,
    scale: index === 0 ? 1 : 0.5,
    opacity: 1,
    mode: "over",
    enabled: true
  };
}
function normalizeCompLayer(slot, index, layer) {
  const fallback = defaultCompLayer(slot, index);
  const anyLayer = layer ?? {};
  const mode = String(anyLayer.mode ?? fallback.mode).trim().toLowerCase();
  return {
    slot,
    centerX: clampCompCenter(Number(anyLayer.centerX ?? anyLayer.center_x ?? fallback.centerX)),
    centerY: clampCompCenter(Number(anyLayer.centerY ?? anyLayer.center_y ?? fallback.centerY)),
    scale: clampCompScale(Number(anyLayer.scale ?? fallback.scale)),
    opacity: Math.max(0, Math.min(1, Number(anyLayer.opacity ?? fallback.opacity))),
    mode: COMP_BLEND_MODES.includes(mode) ? mode : "over",
    enabled: anyLayer.enabled !== false
  };
}
function getCompSlots(node) {
  const slotMap = /* @__PURE__ */ new Map();
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
        maskInputIndex: null
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
        maskInputIndex: inputIndex
      });
    }
  }
  return [...slotMap.values()].filter((slot) => slot.inputIndex >= 0).sort((a, b) => a.layerNumber - b.layerNumber);
}
function parseCompLayers(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const source = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray(parsed.layers) ? parsed.layers : [];
  const layers = [];
  for (let index = 0; index < source.length; index++) {
    const entry = source[index];
    if (!entry || typeof entry !== "object") continue;
    const slot = String(entry.slot ?? "").trim();
    if (!slot) continue;
    layers.push(normalizeCompLayer(slot, index, entry));
  }
  return layers;
}
function syncCompLayers(raw, slots) {
  const existing = parseCompLayers(raw);
  const bySlot = new Map(existing.map((layer) => [layer.slot, layer]));
  return slots.map((slot, index) => normalizeCompLayer(slot.slot, index, bySlot.get(slot.slot)));
}
function serializeCompLayers(layers) {
  return JSON.stringify({
    version: 1,
    layers: layers.map((layer) => ({
      slot: layer.slot,
      center_x: layer.centerX,
      center_y: layer.centerY,
      scale: layer.scale,
      opacity: layer.opacity,
      mode: layer.mode,
      enabled: layer.enabled
    }))
  });
}
function computeCompRect(outputWidth, outputHeight, sourceWidth, sourceHeight, layer) {
  const width = Math.max(1, Math.round(Math.max(1, sourceWidth) * clampCompScale(layer.scale)));
  const height = Math.max(1, Math.round(Math.max(1, sourceHeight) * clampCompScale(layer.scale)));
  const left = Math.round(clampCompCenter(layer.centerX) * Math.max(1, outputWidth) - width / 2);
  const top = Math.round(clampCompCenter(layer.centerY) * Math.max(1, outputHeight) - height / 2);
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  };
}
export {
  COMP_BLEND_MODES,
  clampCompCenter,
  clampCompScale,
  computeCompRect,
  getCompSlots,
  parseCompLayers,
  serializeCompLayers,
  syncCompLayers
};
