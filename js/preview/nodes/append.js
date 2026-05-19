import { getUpstreamNode } from "../graph.js";
import { styleSoftButton } from "../shared/dom-styles.js";
import { findWidget, hideWidgetForGood, setWidgetStringValue } from "../shared/widgets.js";
import { getFrameSelectorOutputCount as getFrameSelectorEffectiveOutputCount, getUpstreamFrameCount, isNode as isFrameSelectorNode } from "./frame-range.js";
const NODE_CLASS = "ImageOpsAppend";
function isNode(node) {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}
function createJoinControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "grid";
  controls.style.gap = "6px";
  const top = document.createElement("div");
  top.style.display = "grid";
  top.style.gridTemplateColumns = "auto minmax(0,1fr)";
  top.style.gap = "6px";
  top.style.alignItems = "center";
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.textContent = "+ Clip";
  styleSoftButton(addButton, false);
  const hint = document.createElement("div");
  hint.textContent = "Trim each clip before concatenation";
  hint.style.fontSize = "11px";
  hint.style.opacity = "0.72";
  top.appendChild(addButton);
  top.appendChild(hint);
  const trimList = document.createElement("div");
  trimList.style.display = "grid";
  trimList.style.gap = "6px";
  controls.appendChild(top);
  controls.appendChild(trimList);
  return {
    controls,
    addButton,
    trimList
  };
}
function getJoinSlots(node) {
  const slots = /* @__PURE__ */ new Set();
  for (const input of node.inputs ?? []) {
    const match = /^image_(\d+)$/.exec(String(input?.name ?? ""));
    if (match) slots.add(Math.max(1, Math.round(Number(match[1]))));
  }
  return [...slots].sort((a, b) => a - b);
}
function removeJoinInputAt(node, inputIndex) {
  if (inputIndex < 0) return;
  if (typeof node.removeInput === "function") {
    node.removeInput(inputIndex);
    return;
  }
  if (Array.isArray(node.inputs)) {
    node.inputs.splice(inputIndex, 1);
  }
}
function nextJoinInputName(node, reservedNames) {
  let slotNumber = 1;
  while (reservedNames.has(`image_${slotNumber}`) || (node.inputs ?? []).some((input) => String(input?.name ?? "") === `image_${slotNumber}`)) {
    slotNumber += 1;
  }
  return `image_${slotNumber}`;
}
function migrateLegacyJoinTrimSlots(node, renamedSlots) {
  if (renamedSlots.size === 0) return;
  const widget = findWidget(node, "trims_json");
  if (!widget) return;
  let parsed = {};
  try {
    parsed = JSON.parse(String(widget.value ?? ""));
  } catch {
    return;
  }
  const clips = Array.isArray(parsed?.clips) ? parsed.clips : null;
  if (!clips) return;
  let changed = false;
  for (const entry of clips) {
    if (!entry || typeof entry !== "object") continue;
    const nextSlot = renamedSlots.get(String(entry.slot ?? ""));
    if (!nextSlot) continue;
    entry.slot = nextSlot;
    changed = true;
  }
  if (changed) {
    setWidgetStringValue(widget, JSON.stringify(parsed));
  }
}
function normalizeLegacyJoinInputs(node) {
  if (!isNode(node) || !Array.isArray(node.inputs) || node.inputs.length === 0) return;
  const renamedSlots = /* @__PURE__ */ new Map();
  const reservedNames = /* @__PURE__ */ new Set();
  const legacyToModern = [
    ["image_a", "image_1"],
    ["image_b", "image_2"]
  ];
  for (const [legacyName, preferredName] of legacyToModern) {
    const legacyIndex = (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === legacyName);
    if (legacyIndex < 0) continue;
    const legacyInput = node.inputs?.[legacyIndex];
    if (!legacyInput) continue;
    const modernIndex = (node.inputs ?? []).findIndex((input, index) => index !== legacyIndex && String(input?.name ?? "") === preferredName);
    const legacyLinked = (legacyInput.link ?? null) != null;
    if (modernIndex < 0) {
      legacyInput.name = preferredName;
      reservedNames.add(preferredName);
      renamedSlots.set(legacyName, preferredName);
      continue;
    }
    const modernInput = node.inputs?.[modernIndex];
    const modernLinked = (modernInput?.link ?? null) != null;
    if (!modernLinked) {
      legacyInput.name = preferredName;
      reservedNames.add(preferredName);
      renamedSlots.set(legacyName, preferredName);
      const duplicateIndex = (node.inputs ?? []).findIndex((input, index) => index !== legacyIndex && String(input?.name ?? "") === preferredName && (input?.link ?? null) == null);
      removeJoinInputAt(node, duplicateIndex);
      continue;
    }
    if (!legacyLinked) {
      removeJoinInputAt(node, legacyIndex);
      continue;
    }
    const nextName = nextJoinInputName(node, reservedNames);
    legacyInput.name = nextName;
    reservedNames.add(nextName);
    renamedSlots.set(legacyName, nextName);
  }
  migrateLegacyJoinTrimSlots(node, renamedSlots);
}
function widgetNumber(node, name, fallback) {
  const value = (node.widgets ?? []).find((widget) => widget?.name === name)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function widgetBoolean(node, name, fallback) {
  const value = (node.widgets ?? []).find((widget) => widget?.name === name)?.value;
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}
function getVhsVideoFrameCount(node) {
  const query = node?.video_query;
  const loaded = query?.loaded;
  const source = query?.source;
  const frames = Number(loaded?.frames ?? source?.frames ?? 0);
  if (Number.isFinite(frames) && frames > 0) return Math.round(frames);
  const cap = Number((node.widgets ?? []).find((widget) => widget?.name === "frame_load_cap")?.value ?? 0);
  return Number.isFinite(cap) && cap > 0 ? Math.round(cap) : 0;
}
function getFrameSelectorOutputCount(node) {
  return getFrameSelectorEffectiveOutputCount(node);
}
function trimSelectionCount(frameCount, start, end) {
  if (!Number.isFinite(frameCount) || frameCount <= 0) return 0;
  const max = Math.max(0, Math.round(frameCount) - 1);
  const actualStart = Math.max(0, Math.min(max, Math.round(start)));
  const actualEnd = end < 0 ? max : Math.max(0, Math.min(max, Math.round(end)));
  const [lo, hi] = actualStart <= actualEnd ? [actualStart, actualEnd] : [actualEnd, actualStart];
  return Math.max(1, hi - lo + 1);
}
function trimsBySlot(node) {
  return new Map(readJoinTrims(node).map((trim) => [trim.slot, trim]));
}
function getJoinConnectedInputFrameCountsInternal(node, seen) {
  const counts = [];
  const trimMap = trimsBySlot(node);
  for (const slotNumber of getJoinSlots(node)) {
    const inputIndex = (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === `image_${slotNumber}`);
    if (inputIndex < 0 || (node.inputs?.[inputIndex]?.link ?? null) == null) continue;
    const slot = `image_${slotNumber}`;
    const trim = trimMap.get(slot) ?? { slot, start: 0, end: -1 };
    const upstreamCount = getNodePreviewFrameCount(getUpstreamNode(node, inputIndex), seen);
    counts.push({
      inputIndex,
      slotNumber,
      frameCount: trimSelectionCount(upstreamCount, trim.start, trim.end)
    });
  }
  return counts;
}
function getNodePreviewFrameCount(node, seen) {
  if (!node) return 0;
  if (seen.has(node.id)) return 0;
  if (isFrameSelectorNode(node)) {
    return getFrameSelectorOutputCount(node);
  }
  if (isNode(node)) {
    seen.add(node.id);
    const localJoinCount = getJoinConnectedInputFrameCountsInternal(node, seen).reduce((sum, entry) => sum + Math.max(1, entry.frameCount), 0);
    seen.delete(node.id);
    if (localJoinCount > 0) return localJoinCount;
    const state = node.__imageops_state;
    const knownJoinCount = Math.round(Number(state?.joinFrameCount ?? 0));
    if (knownJoinCount > 0) return knownJoinCount;
    return 0;
  }
  const imgs = node?.imgs;
  if (Array.isArray(imgs) && imgs.length > 1) {
    return imgs.length;
  }
  const vhsFrameCount = getVhsVideoFrameCount(node);
  if (vhsFrameCount > 0) return vhsFrameCount;
  const upstreamCount = getUpstreamFrameCount(node);
  if (upstreamCount > 0) return upstreamCount;
  return 0;
}
function getPreviewNodeFrameCount(node) {
  return getNodePreviewFrameCount(node, /* @__PURE__ */ new Set());
}
function getJoinConnectedInputFrameCounts(node) {
  if (!isNode(node)) return [];
  return getJoinConnectedInputFrameCountsInternal(node, /* @__PURE__ */ new Set([node.id]));
}
function getJoinPreviewFrameCount(node) {
  return getJoinConnectedInputFrameCounts(node).reduce((sum, entry) => sum + Math.max(1, entry.frameCount), 0);
}
function ensureJoinInputs(node, minClips = 2) {
  if (!isNode(node) || !node.addInput) return;
  normalizeLegacyJoinInputs(node);
  const existingNames = new Set((node.inputs ?? []).map((input) => String(input?.name ?? "")));
  const currentMax = getJoinSlots(node).reduce((max, slot) => Math.max(max, slot), 0);
  const target = Math.max(minClips, currentMax || 0);
  for (let index = currentMax + 1; index <= target; index++) {
    const name = `image_${index}`;
    if (!existingNames.has(name)) {
      node.addInput?.(name, "IMAGE,VIDEO", { shape: 7 });
      existingNames.add(name);
    }
  }
}
function removeJoinInput(node, slotNumber) {
  if (!isNode(node) || !node.removeInput) return false;
  const slots = getJoinSlots(node);
  if (slots.length <= 2) return false;
  const inputIndex = (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === `image_${slotNumber}`);
  if (inputIndex < 0) return false;
  node.removeInput(inputIndex);
  const trims = readJoinTrims(node).filter((trim) => trim.slot !== `image_${slotNumber}`);
  writeJoinTrims(node, trims);
  return true;
}
function readJoinTrims(node) {
  let parsed = {};
  try {
    parsed = JSON.parse(String(findWidget(node, "trims_json")?.value ?? ""));
  } catch {
    parsed = {};
  }
  const clips = Array.isArray(parsed?.clips) ? parsed.clips : [];
  const bySlot = /* @__PURE__ */ new Map();
  for (const entry of clips) {
    const slot = String(entry?.slot ?? "");
    if (!slot) continue;
    bySlot.set(slot, {
      slot,
      start: Math.max(0, Math.round(Number(entry?.start ?? 0))),
      end: Math.round(Number(entry?.end ?? -1))
    });
  }
  for (const index of getJoinSlots(node)) {
    const slot = `image_${index}`;
    if (!bySlot.has(slot)) bySlot.set(slot, { slot, start: 0, end: -1 });
  }
  return [...bySlot.values()].sort((a, b) => Number(a.slot.split("_")[1] ?? 0) - Number(b.slot.split("_")[1] ?? 0));
}
function writeJoinTrims(node, trims) {
  setWidgetStringValue(findWidget(node, "trims_json"), JSON.stringify({ version: 1, clips: trims }));
}
function hideJoinWidgets(node) {
  hideWidgetForGood(node, findWidget(node, "trims_json"));
}
export {
  NODE_CLASS,
  createJoinControlsUi,
  ensureJoinInputs,
  getJoinConnectedInputFrameCounts,
  getJoinPreviewFrameCount,
  getJoinSlots,
  getPreviewNodeFrameCount,
  hideJoinWidgets,
  isNode,
  normalizeLegacyJoinInputs,
  readJoinTrims,
  removeJoinInput,
  writeJoinTrims
};
