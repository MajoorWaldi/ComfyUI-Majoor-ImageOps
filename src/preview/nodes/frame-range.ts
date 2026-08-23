import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { getUpstreamNode, getUpstreamNodes } from "../graph.js";
import { createContextMenuSelect, styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { getUpstreamVideoFps, getUpstreamVideoTiming } from "../shared/video.js";
import {
    findWidget,
    hideWidgetForGood,
    setWidgetBooleanValue,
    setWidgetStringValue,
    setWidgetValue,
    widgetBoolean,
    widgetNumber,
    widgetString,
} from "../shared/widgets.js";

export const NODE_CLASS = "ImageOpsFrameRange";

export function isNode(node: ComfyNode): boolean {
  return String(node?.comfyClass ?? "") === NODE_CLASS;
}

function getVhsVideoInfo(node: ComfyNode): { fps: number; frames: number } | null {
  const query = (node as any)?.video_query as any;
  const loaded = query?.loaded as any;
  const source = query?.source as any;
  const frames = Number(loaded?.frames ?? source?.frames ?? 0);
  const fps = Number(loaded?.fps ?? source?.fps ?? 0);
  if (!Number.isFinite(frames) || frames <= 0) return null;
  return {
    frames: Math.round(frames),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 0,
  };
}

function estimateNodeFrameCount(node: ComfyNode): number {
  const imgs = (node as any).imgs;
  if (Array.isArray(imgs) && imgs.length >= 1) return imgs.length;

  const videoInfo = getVhsVideoInfo(node);
  if (videoInfo?.frames) {
    const selectEveryNth = Math.max(1, Number((node.widgets ?? []).find(w => w?.name === "select_every_nth")?.value ?? 1));
    const capWidget = Math.max(0, Number((node.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0));
    let estimated = Math.max(1, Math.round(videoInfo.frames / selectEveryNth));
    if (capWidget > 0) estimated = Math.min(estimated, capWidget);
    return estimated;
  }

  const videoEl = (node as any).__imageops_media?.videoEl as HTMLVideoElement | undefined;
  if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
    const forceRate = Number((node.widgets ?? []).find(w => w?.name === "force_rate")?.value ?? 0);
    const fps = forceRate > 0 ? forceRate : (videoInfo?.fps && videoInfo.fps > 0 ? videoInfo.fps : 24);
    const selectEveryNth = Math.max(1, Number((node.widgets ?? []).find(w => w?.name === "select_every_nth")?.value ?? 1));
    const capWidget = Math.max(0, Number((node.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0));
    let estimated = Math.round(videoEl.duration * fps / selectEveryNth);
    if (capWidget > 0) estimated = Math.min(estimated, capWidget);
    if (estimated > 0) return estimated;
  }

  const capWidget = Number((node.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0);
  if (capWidget > 0) return Math.round(capWidget);

  return 0;
}

/** Walk upstream from the FrameSelector and return the best estimate of the
 *  source frame count, scanning:
 *  1. `node.imgs.length` — actual rendered batch (populated after any queue run)
 *  2. Video element duration × FPS — for live video preview without queue
 *  3. VHS `frame_load_cap` widget — explicit user cap
 */
export function getUpstreamFrameCount(node: ComfyNode, inputIndex: number = 0): number {
  return getUpstreamVideoTiming(node, inputIndex).frameCount;
}

function getUpstreamFrameCountLegacy(node: ComfyNode, inputIndex: number = 0): number {
  const seen = new Set<number>();
  const queue: ComfyNode[] = [];
  const up0 = getUpstreamNode(node, inputIndex);
  if (up0) queue.push(up0);

  let bestCount = 0;
  const MAX_HOPS = 8;
  let hops = 0;

  while (queue.length > 0 && hops < MAX_HOPS) {
    const cur = queue.shift()!;
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    hops++;
    const nearestCount = estimateNodeFrameCount(cur);
    if (nearestCount > 0) return nearestCount;

    // 1. Batch imgs array — the most reliable source (populated after execution)
    // Use >= 1 so that single static images (LoadImage) are also counted as 1-frame sources.
    const imgs = (cur as any).imgs;
    if (Array.isArray(imgs) && imgs.length >= 1) {
      bestCount = Math.max(bestCount, imgs.length);
    }

    // 2. VHS metadata — exact frame count/FPS when available
    const videoInfo = getVhsVideoInfo(cur);
    if (videoInfo?.frames) {
      const selectEveryNth = Math.max(1, Number((cur.widgets ?? []).find(w => w?.name === "select_every_nth")?.value ?? 1));
      const capWidget = Math.max(0, Number((cur.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0));
      let estimated = Math.max(1, Math.round(videoInfo.frames / selectEveryNth));
      if (capWidget > 0) estimated = Math.min(estimated, capWidget);
      bestCount = Math.max(bestCount, estimated);
    }

    // 3. Video element duration × FPS — works in live preview before queue run
    const videoEl = (cur as any).__imageops_media?.videoEl as HTMLVideoElement | undefined;
    if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
      const forceRate = Number((cur.widgets ?? []).find(w => w?.name === "force_rate")?.value ?? 0);
      const fps = forceRate > 0 ? forceRate : (videoInfo?.fps && videoInfo.fps > 0 ? videoInfo.fps : 24);
      const selectEveryNth = Math.max(1, Number((cur.widgets ?? []).find(w => w?.name === "select_every_nth")?.value ?? 1));
      const capWidget = Math.max(0, Number((cur.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0));
      let estimated = Math.round(videoEl.duration * fps / selectEveryNth);
      if (capWidget > 0) estimated = Math.min(estimated, capWidget);
      if (estimated > 0) bestCount = Math.max(bestCount, estimated);
    }

    // 4. VHS frame_load_cap widget — explicit user cap
    const capWidget = Number((cur.widgets ?? []).find(w => w?.name === "frame_load_cap")?.value ?? 0);
    if (capWidget > 0) bestCount = Math.max(bestCount, Math.round(capWidget));

    for (const upNode of getUpstreamNodes(cur)) {
      if (!seen.has(upNode.id)) queue.push(upNode);
    }
  }

  return bestCount;
}

export type FrameSelectorRepeatStyle = "loop" | "bounce" | "reverse" | "input_duration" | "custom_count" | "freeze";

export type FrameSelectorControlsUi = {
  controls: HTMLDivElement;
  label: HTMLDivElement | null;
  trimStart: HTMLInputElement;
  trimEnd: HTMLInputElement;
  holdFrame: HTMLInputElement;
  ruler: HTMLDivElement;
  sliderBox: HTMLDivElement;
  fill: HTMLDivElement;
  fillLabel: HTMLDivElement;
  startHandle: HTMLDivElement;
  endHandle: HTMLDivElement;
  playhead: HTMLDivElement;
  holdToggle: HTMLButtonElement;
  holdRow: HTMLDivElement;
  repeatRow: HTMLDivElement;
  repeatToggle: HTMLButtonElement;
  repeatModeSelect: HTMLSelectElement;
  repeatCountInput: HTMLInputElement;
};

type FrameSelectorTrimBounds = {
  sourceCount: number;
  start: number;
  end: number;
  selectionCount: number;
  indices: number[];
};

function frameSelectorSourceCount(node: ComfyNode): number {
  const upstreamCount = getUpstreamFrameCount(node);
  if (upstreamCount > 0) return Math.max(0, Math.round(upstreamCount));
  return Math.max(0, Math.round(Number((node.__imageops_state as any)?.frameSelectorSourceCount ?? 0)));
}

function getFrameSelectorTrimBounds(node: ComfyNode, sourceCountOverride?: number): FrameSelectorTrimBounds {
  const sourceCount = Math.max(0, Math.round(Number(sourceCountOverride ?? frameSelectorSourceCount(node))));
  if (sourceCount <= 0) {
    return { sourceCount: 0, start: 0, end: 0, selectionCount: 0, indices: [] };
  }

  const trimStart = Math.max(0, Math.round(widgetNumber(node, "trim_start", 0)));
  const trimEndRaw = Math.round(widgetNumber(node, "trim_end", -1));
  const lo = Math.max(0, Math.min(trimStart, sourceCount - 1));
  const hi = trimEndRaw < 0
    ? sourceCount - 1
    : Math.max(0, Math.min(trimEndRaw, sourceCount - 1));
  const [start, end] = lo <= hi ? [lo, hi] : [hi, lo];
  const indices = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  return {
    sourceCount,
    start,
    end,
    selectionCount: Math.max(1, end - start + 1),
    indices,
  };
}

export function normalizeFrameSelectorRepeatStyle(mode: string): FrameSelectorRepeatStyle {
  const normalized = String(mode || "loop").trim().toLowerCase();
  if (normalized === "input_duration" || normalized === "custom_count") return normalized;
  if (normalized === "bounce" || normalized === "reverse") return normalized;
  if (normalized === "freeze") return "freeze";
  return "loop";
}

function getFrameSelectorPattern(indices: number[], style: FrameSelectorRepeatStyle): number[] {
  if (indices.length <= 1) return [...indices];
  if (style === "reverse") return [...indices].reverse();
  if (style === "bounce") return indices.length <= 2 ? [...indices] : [...indices, ...indices.slice(1, -1).reverse()];
  return [...indices];
}

export function getFrameSelectorOutputCount(node: ComfyNode, sourceCountOverride?: number): number {
  const bounds = getFrameSelectorTrimBounds(node, sourceCountOverride);
  if (bounds.sourceCount <= 0) return 0;

  const frameHold = widgetBoolean(node, "frame_hold", false);
  const repeat = widgetBoolean(node, "repeat", false);
  const repeatMode = normalizeFrameSelectorRepeatStyle(widgetString(node, "repeat_mode", "loop"));
  const customFrameCount = Math.max(1, Math.round(widgetNumber(node, "custom_frame_count", Math.max(1, bounds.selectionCount || 24))));

  if (repeat && repeatMode === "input_duration") return bounds.sourceCount;
  if (repeat) return customFrameCount;
  if (frameHold) return 1;
  return bounds.selectionCount;
}

export function getFrameSelectorSourceFrame(node: ComfyNode, tick: number, sourceCountOverride?: number): number {
  const bounds = getFrameSelectorTrimBounds(node, sourceCountOverride);
  if (bounds.sourceCount <= 0 || bounds.indices.length === 0) return 0;

  const frameHold = widgetBoolean(node, "frame_hold", false);
  const repeat = widgetBoolean(node, "repeat", false);
  const holdFrame = Math.max(bounds.start, Math.min(bounds.end, Math.round(widgetNumber(node, "hold_frame", bounds.start))));
  const repeatMode = normalizeFrameSelectorRepeatStyle(widgetString(node, "repeat_mode", "loop"));
  const repeatUsesHold = repeatMode === "input_duration" || repeatMode === "custom_count" || repeatMode === "freeze";
  // freeze mode always locks to holdFrame regardless of the frame_hold toggle.
  const sourceIndices = (repeat && repeatMode === "freeze")
    ? [holdFrame]
    : (frameHold && (!repeat || repeatUsesHold) ? [holdFrame] : bounds.indices);

  if (repeat) {
    const pattern = getFrameSelectorPattern(sourceIndices, repeatMode);
    const outputIndex = Math.max(0, Math.round(tick));
    return pattern[outputIndex % Math.max(1, pattern.length)] ?? bounds.start;
  }

  if (frameHold) {
    return holdFrame;
  }

  const outputIndex = Math.max(0, Math.round(tick)) % Math.max(1, bounds.indices.length);
  return bounds.indices[outputIndex] ?? bounds.start;
}

function timelineMax(node: ComfyNode): number {
  const st = node.__imageops_state as any;
  const sourceCount = Math.max(0, Math.round(st?.frameSelectorSourceCount ?? 0));
  if (sourceCount > 0) {
    // Ruler spans exactly the source range — no empty padding beyond the video.
    return sourceCount - 1;
  }
  // Fallback: no source count yet, derive from widget values.
  const maxValue = Math.max(
    0,
    widgetNumber(node, "trim_start", 0),
    widgetNumber(node, "trim_end", -1) < 0 ? 0 : widgetNumber(node, "trim_end", 0),
    widgetNumber(node, "hold_frame", 0),
  );
  return Math.max(24, Math.ceil(maxValue + 4));
}

function formatFrame(frame: number): string {
  return `${Math.max(0, Math.round(frame))}f`;
}

/** Returns the source FPS from the upstream VHS/LoadVideo node, or 0 if unknown. */
export function getUpstreamFps(node: ComfyNode): number {
  return getUpstreamVideoFps(node, 0);
}

function formatTime(frames: number, fps: number): string {
  if (fps <= 0) return "";
  const totalSec = Math.max(0, frames) / fps;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const min = Math.floor(totalSec / 60);
  const sec = Math.round(totalSec % 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function writeInt(node: ComfyNode, name: string, value: number): void {
  const minValue = name === "trim_end" ? -1 : name === "custom_frame_count" ? 1 : 0;
  setWidgetValue(findWidget(node, name), Math.max(minValue, Math.round(value)));
}

export function createFrameSelectorControlsUi(): FrameSelectorControlsUi {
  const controls = document.createElement("div");
  controls.style.marginTop = "6px";
  controls.style.display = "flex";
  controls.style.flexDirection = "column";
  controls.style.gap = "5px";

  const trimArea = document.createElement("div");
  trimArea.style.display = "flex";
  trimArea.style.flexDirection = "column";
  trimArea.style.gap = "4px";

  const ruler = document.createElement("div");
  ruler.style.position = "relative";
  ruler.style.width = "100%";
  ruler.style.height = "18px";
  ruler.style.fontSize = "10px";
  ruler.style.color = "rgba(255,255,255,0.62)";
  ruler.style.pointerEvents = "none";
  ruler.style.userSelect = "none";
  trimArea.appendChild(ruler);

  const sliderBox = document.createElement("div");
  sliderBox.style.position = "relative";
  sliderBox.style.width = "100%";
  sliderBox.style.height = "16px";
  sliderBox.style.background = "rgba(255,255,255,0.09)";
  sliderBox.style.borderRadius = "4px";
  sliderBox.style.cursor = "pointer";
  sliderBox.style.userSelect = "none";
  sliderBox.style.boxShadow = "inset 0 1px 3px rgba(0,0,0,0.55)";

  const fillClip = document.createElement("div");
  fillClip.style.position = "absolute";
  fillClip.style.inset = "0";
  fillClip.style.overflow = "hidden";
  fillClip.style.borderRadius = "4px";
  fillClip.style.pointerEvents = "none";

  const fill = document.createElement("div");
  fill.style.position = "absolute";
  fill.style.top = "0";
  fill.style.height = "100%";
  fill.style.background = "linear-gradient(90deg, rgba(34,197,94,0.18), rgba(250,204,21,0.22), rgba(239,68,68,0.18))";
  fill.style.pointerEvents = "none";
  fill.style.display = "flex";
  fill.style.alignItems = "center";
  fill.style.justifyContent = "center";
  fill.style.overflow = "hidden";
  fill.style.borderLeft = "1px solid rgba(34,197,94,0.55)";
  fill.style.borderRight = "1px solid rgba(239,68,68,0.55)";

  const fillLabel = document.createElement("div");
  fillLabel.style.fontSize = "10px";
  fillLabel.style.color = "rgba(255,255,255,0.85)";
  fillLabel.style.whiteSpace = "nowrap";
  fillLabel.style.pointerEvents = "none";
  fillLabel.style.userSelect = "none";
  fillLabel.style.textShadow = "0 1px 3px rgba(0,0,0,0.9)";
  fill.appendChild(fillLabel);
  fillClip.appendChild(fill);
  sliderBox.appendChild(fillClip);

  const createHandle = (color: string): HTMLDivElement => {
    const handle = document.createElement("div");
    handle.style.position = "absolute";
    handle.style.top = "0";
    handle.style.width = "6px";
    handle.style.height = "100%";
    handle.style.background = color;
    handle.style.transform = "translateX(-50%)";
    handle.style.pointerEvents = "none";
    handle.style.boxShadow = "0 0 4px rgba(0,0,0,0.8)";
    handle.style.borderRadius = "2px";
    return handle;
  };

  const startHandle = createHandle("#22c55e");
  const endHandle = createHandle("#ef4444");

  const playhead = document.createElement("div");
  playhead.style.position = "absolute";
  playhead.style.top = "0";
  playhead.style.width = "2px";
  playhead.style.height = "100%";
  playhead.style.background = "rgba(255,220,50,0.9)";
  playhead.style.transform = "translateX(-50%)";
  playhead.style.pointerEvents = "none";
  playhead.style.boxShadow = "0 0 4px rgba(0,0,0,0.7)";
  playhead.style.borderRadius = "1px";
  playhead.style.zIndex = "2";

  sliderBox.appendChild(startHandle);
  sliderBox.appendChild(endHandle);
  sliderBox.appendChild(playhead);

  const hiddenRange = (): HTMLInputElement => {
    const input = document.createElement("input");
    input.type = "range";
    input.style.display = "none";
    return input;
  };

  const trimStart = hiddenRange();
  const trimEnd = hiddenRange();

  trimArea.appendChild(sliderBox);
  trimArea.appendChild(trimStart);
  trimArea.appendChild(trimEnd);
  controls.appendChild(trimArea);

  const holdToggle = document.createElement("button");
  holdToggle.type = "button";
  holdToggle.textContent = "Freeze";
  holdToggle.title = "Freeze output on a single source frame (frame_hold)";
  holdToggle.style.width = "100%";
  styleSoftButton(holdToggle, false);
  controls.appendChild(holdToggle);

  const holdRow = document.createElement("div");
  holdRow.style.display = "flex";
  holdRow.style.flexDirection = "row";
  holdRow.style.alignItems = "center";
  holdRow.style.gap = "6px";

  const holdLabel = document.createElement("div");
  holdLabel.textContent = "Frame";
  holdLabel.style.fontSize = "11px";
  holdLabel.style.opacity = "0.62";
  holdLabel.style.whiteSpace = "nowrap";
  holdLabel.style.flexShrink = "0";

  const holdScrubber = document.createElement("div");
  holdScrubber.style.position = "relative";
  holdScrubber.style.flex = "1";
  holdScrubber.style.height = "16px";
  holdScrubber.style.background = "rgba(255,255,255,0.09)";
  holdScrubber.style.borderRadius = "4px";
  holdScrubber.style.cursor = "pointer";
  holdScrubber.style.userSelect = "none";
  holdScrubber.style.boxShadow = "inset 0 1px 3px rgba(0,0,0,0.55)";

  const holdMarker = document.createElement("div");
  holdMarker.style.position = "absolute";
  holdMarker.style.top = "0";
  holdMarker.style.width = "10px";
  holdMarker.style.height = "100%";
  holdMarker.style.background = "#3b82f6";
  holdMarker.style.transform = "translateX(-50%)";
  holdMarker.style.pointerEvents = "none";
  holdMarker.style.boxShadow = "0 0 4px rgba(0,0,0,0.8)";
  holdMarker.style.borderRadius = "3px";
  holdMarker.style.left = "0%";
  holdScrubber.appendChild(holdMarker);

  const holdFrame = document.createElement("input");
  holdFrame.type = "range";
  holdFrame.min = "0";
  holdFrame.max = "120";
  holdFrame.step = "1";
  holdFrame.value = "0";
  holdFrame.style.display = "none";
  holdScrubber.appendChild(holdFrame);

  const holdFrameLabel = document.createElement("div");
  holdFrameLabel.textContent = "0f";
  holdFrameLabel.style.fontSize = "11px";
  holdFrameLabel.style.opacity = "0.85";
  holdFrameLabel.style.whiteSpace = "nowrap";
  holdFrameLabel.style.flexShrink = "0";
  holdFrameLabel.style.minWidth = "24px";
  holdFrameLabel.style.textAlign = "right";

  holdRow.appendChild(holdLabel);
  holdRow.appendChild(holdScrubber);
  holdRow.appendChild(holdFrameLabel);
  controls.appendChild(holdRow);

  (holdRow as any)._holdScrubber = holdScrubber;
  (holdRow as any)._holdMarker = holdMarker;
  (holdRow as any)._holdFrameLabel = holdFrameLabel;

  const repeatRow = document.createElement("div");
  repeatRow.style.display = "flex";
  repeatRow.style.alignItems = "center";
  repeatRow.style.gap = "6px";

  const repeatToggle = document.createElement("button");
  repeatToggle.type = "button";
  repeatToggle.textContent = "Repeat";
  repeatToggle.title = "Repeat the selected trimmed range as an output batch";
  repeatToggle.style.flexShrink = "0";
  styleSoftButton(repeatToggle, false);

  const repeatModeSelect = document.createElement("select");
  for (const [value, label] of [
    ["loop", "Loop"],
    ["bounce", "Bounce"],
    ["reverse", "Reverse"],
    ["input_duration", "Input duration"],
    ["custom_count", "Custom count"],
    ["freeze", "Freeze \u00d7 N"],
  ] as [FrameSelectorRepeatStyle, string][]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    repeatModeSelect.appendChild(option);
  }
  repeatModeSelect.title = "Repeat pattern for the selected range";
  repeatModeSelect.style.flex = "1";
  styleSoftField(repeatModeSelect);

  const repeatCountInput = document.createElement("input");
  repeatCountInput.type = "number";
  repeatCountInput.min = "1";
  repeatCountInput.step = "1";
  repeatCountInput.value = "24";
  repeatCountInput.title = "Output frame count for the repeated range";
  repeatCountInput.style.width = "72px";
  repeatCountInput.style.textAlign = "right";
  styleSoftField(repeatCountInput);

  repeatRow.appendChild(repeatToggle);
  repeatRow.appendChild(createContextMenuSelect(repeatModeSelect));
  repeatRow.appendChild(repeatCountInput);
  controls.appendChild(repeatRow);

  return {
    controls,
    label: null,
    trimStart,
    trimEnd,
    holdFrame,
    ruler,
    sliderBox,
    fill,
    fillLabel,
    startHandle,
    endHandle,
    playhead,
    holdToggle,
    holdRow,
    repeatRow,
    repeatToggle,
    repeatModeSelect,
    repeatCountInput,
  };
}

export function syncFrameSelectorWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state as any;
  const controls = st?.frameSelectorControls as HTMLElement | null | undefined;
  if (!controls) return;

  // Proactively scan upstream for source frame count (works in live preview + after queue run)
  const upstreamCount = getUpstreamFrameCount(node);
  if (upstreamCount > 0 && upstreamCount !== (st.frameSelectorSourceCount ?? 0)) {
    st.frameSelectorSourceCount = upstreamCount;
  }

  const max = timelineMax(node);
  const bounds = getFrameSelectorTrimBounds(node, Math.max(0, Math.round(Number(st.frameSelectorSourceCount ?? 0))));
  const trimStart = Math.max(0, Math.min(max, bounds.start));
  const trimEnd = Math.max(trimStart, Math.min(max, bounds.end));
  const frameHold = widgetBoolean(node, "frame_hold", false);
  const repeat = widgetBoolean(node, "repeat", false);
  const repeatMode = normalizeFrameSelectorRepeatStyle(widgetString(node, "repeat_mode", "loop"));
  const holdFrame = Math.max(trimStart, Math.min(trimEnd, Math.round(widgetNumber(node, "hold_frame", trimStart))));
  const effectiveOutputCount = getFrameSelectorOutputCount(node, bounds.sourceCount);

  const setRange = (input: HTMLInputElement | null, value: number, min = 0): void => {
    if (!input) return;
    input.min = String(min);
    input.max = String(max);
    input.value = String(Math.max(min, Math.min(max, value)));
  };

  setRange(st.frameSelectorTrimStart, trimStart);
  setRange(st.frameSelectorTrimEnd, trimEnd);
  setRange(st.frameSelectorHoldFrame, holdFrame, trimStart);
  if ((st as any).frameSelectorRepeatCountInput) {
    // For user-defined count modes (freeze, custom_count), always show customFrameCount directly
    // so the field stays editable even before any source has been queued (sourceCount=0).
    const customFrameCountVal = Math.max(1, Math.round(widgetNumber(node, "custom_frame_count", 24)));
    const displayCount = (repeat && (repeatMode === "freeze" || repeatMode === "custom_count"))
      ? customFrameCountVal
      : effectiveOutputCount;
    ((st as any).frameSelectorRepeatCountInput as HTMLInputElement).value = String(displayCount);
  }
  if ((st as any).frameSelectorRepeatModeSelect) {
    ((st as any).frameSelectorRepeatModeSelect as HTMLSelectElement).value = repeatMode;
  }

  const startPct = max > 0 ? (trimStart / max) * 100 : 0;
  const endPct = max > 0 ? (trimEnd / max) * 100 : 100;
  if (st.frameSelectorStartHandle) st.frameSelectorStartHandle.style.left = `${startPct}%`;
  if (st.frameSelectorEndHandle) st.frameSelectorEndHandle.style.left = `${endPct}%`;
  if (st.frameSelectorFill) {
    st.frameSelectorFill.style.left = `${startPct}%`;
    st.frameSelectorFill.style.width = `${Math.max(0, endPct - startPct)}%`;
  }
  // When the output is frozen on hold_frame, snap the playhead immediately to hold_frame so the
  // user gets instant visual feedback when scrubbing the main timeline (the renderer would only
  // update it on the next animation tick).
  const isFreezeOutput = (repeat && repeatMode === "freeze") || (frameHold && (!repeat || repeatMode === "input_duration" || repeatMode === "custom_count"));
  if (isFreezeOutput && st.frameSelectorPlayhead && max > 0) {
    const playheadPct = (Math.max(0, Math.min(max, holdFrame)) / max) * 100;
    (st.frameSelectorPlayhead as HTMLDivElement).style.left = `${playheadPct}%`;
  }
  if (st.frameSelectorRuler) {
    const fps = getUpstreamFps(node);
    const hasFps = fps > 0;
    // For single-frame sources in freeze/custom_count modes, show the output range on the ruler.
    const isUserCountRepeat = repeat && (repeatMode === "freeze" || repeatMode === "custom_count");
    const rulerMax = (max <= 0 && isUserCountRepeat)
      ? Math.max(0, Math.round(widgetNumber(node, "custom_frame_count", 24)) - 1)
      : max;
    const rulerKey = `${rulerMax}|${Math.round(fps * 1000)}|${repeat ? repeatMode : "off"}|${widgetNumber(node, "custom_frame_count", 24)}`;
    if ((st as any).frameSelectorRulerKey !== rulerKey) {
      (st as any).frameSelectorRulerKey = rulerKey;
      st.frameSelectorRuler.innerHTML = "";

      // Truly static single frame (no repeat configured): show a small indicator.
      if (rulerMax <= 0) {
        st.frameSelectorRuler.style.height = "18px";
        const singleLabel = document.createElement("div");
        singleLabel.style.position = "absolute";
        singleLabel.style.left = "0";
        singleLabel.style.top = "6px";
        singleLabel.textContent = "1 fr.";
        st.frameSelectorRuler.appendChild(singleLabel);
      } else {
        st.frameSelectorRuler.style.height = hasFps ? "30px" : "18px";
        const majorTicks = 5;
        const subTicks = 4;
        const totalTicks = (majorTicks - 1) * subTicks;
        for (let i = 0; i <= totalTicks; i++) {
          const pct = i / totalTicks;
          const isMajor = i % subTicks === 0;
          const tick = document.createElement("div");
          tick.style.position = "absolute";
          tick.style.left = `${pct * 100}%`;
          tick.style.top = "0";
          tick.style.display = "flex";
          tick.style.flexDirection = "column";
          tick.style.alignItems = "center";
          tick.style.transform = "translateX(-50%)";
          if (i === 0) {
            tick.style.transform = "none";
            tick.style.alignItems = "flex-start";
          } else if (i === totalTicks) {
            tick.style.transform = "translateX(-100%)";
            tick.style.alignItems = "flex-end";
          }
          const line = document.createElement("div");
          line.style.width = isMajor ? "2px" : "1px";
          line.style.height = isMajor ? "6px" : "4px";
          line.style.background = isMajor ? "rgba(255,255,255,0.62)" : "rgba(255,255,255,0.28)";
          line.style.marginBottom = "2px";
          line.style.borderRadius = "1px";
          tick.appendChild(line);
          if (isMajor) {
            const frameNum = Math.round(rulerMax * pct);
            const label = document.createElement("div");
            label.textContent = formatFrame(frameNum);
            label.style.lineHeight = "1.1";
            tick.appendChild(label);
            if (hasFps) {
              const timeLabel = document.createElement("div");
              timeLabel.textContent = formatTime(frameNum, fps);
              timeLabel.style.fontSize = "9px";
              timeLabel.style.opacity = "0.62";
              timeLabel.style.lineHeight = "1.1";
              timeLabel.style.marginTop = "1px";
              tick.appendChild(timeLabel);
            }
          }
          st.frameSelectorRuler.appendChild(tick);
        }
      }
    }
  }

  // Hold toggle button — active styling when frame_hold is on
  if (st.frameSelectorHoldToggle) {
    styleSoftButton(st.frameSelectorHoldToggle, frameHold && !repeat);
  }
  const repeatToggle = (st as any).frameSelectorRepeatToggle as HTMLButtonElement | null;
  if (repeatToggle) {
    styleSoftButton(repeatToggle, repeat);
  }
  // Hold frame row — always visible; active when frame_hold is on or freeze repeat mode is active
  const holdRow = (st as any).frameSelectorHoldRow as HTMLDivElement | null;
  if (holdRow) {
    const isFreezeRepeat = repeat && repeatMode === "freeze";
    holdRow.style.display = "flex";
    holdRow.style.opacity = (frameHold || isFreezeRepeat) ? "1" : "0.72";
    holdRow.style.pointerEvents = "auto";
    // Update scrubber marker and frame label
    const holdScrubber = (holdRow as any)._holdScrubber as HTMLElement | null;
    const holdMarker = (holdRow as any)._holdMarker as HTMLElement | null;
    const holdFrameLabel = (holdRow as any)._holdFrameLabel as HTMLElement | null;
    if (holdScrubber && holdMarker) {
      const holdSpan = Math.max(1, trimEnd - trimStart);
      const pct = Math.max(0, Math.min(1, (holdFrame - trimStart) / holdSpan)) * 100;
      holdMarker.style.left = `${pct}%`;
    }
    if (holdFrameLabel) holdFrameLabel.textContent = `${holdFrame}f`;
    // Sync the hidden range input
    if (st.frameSelectorHoldFrame) {
      st.frameSelectorHoldFrame.min = String(trimStart);
      st.frameSelectorHoldFrame.max = String(trimEnd);
      st.frameSelectorHoldFrame.value = String(holdFrame);
    }
  }
  const repeatRow = (st as any).frameSelectorRepeatRow as HTMLDivElement | null;
  if (repeatRow) {
    repeatRow.style.display = "flex";
    repeatRow.style.opacity = repeat ? "1" : "0.72";
  }
  const repeatModeSelect = (st as any).frameSelectorRepeatModeSelect as HTMLSelectElement | null;
  if (repeatModeSelect) {
    repeatModeSelect.disabled = !repeat;
    repeatModeSelect.style.opacity = repeat ? "1" : "0.6";
  }
  const repeatCountInput = (st as any).frameSelectorRepeatCountInput as HTMLInputElement | null;
  if (repeatCountInput) {
    repeatCountInput.style.display = "block";
    repeatCountInput.disabled = !repeat;
    repeatCountInput.style.opacity = repeat ? "1" : "0.6";
    repeatCountInput.title = "Repeated output frame count";
  }
  if ((st as any).frameSelectorFillLabel) {
    (st as any).frameSelectorFillLabel.textContent = `${trimStart}\u2013${trimEnd} (${Math.max(1, bounds.selectionCount)}f)`;
  }
}

function selectionFallbackCount(trimStart: number, trimEnd: number): number {
  return Math.max(1, trimEnd - trimStart + 1);
}

/** Re-hides ComfyUI native widgets that onConfigure may restore.
 *  Safe to call multiple times — does NOT re-attach event listeners.
 */
export function hideFrameSelectorWidgets(node: ComfyNode): void {
  if (!isNode(node)) return;
  // includes legacy widgets that may still exist in saved workflows
  for (const name of ["bypass", "trim_start", "trim_end", "output_frames",
                       "speed", "offset", "reverse", "edge_mode", "frame_hold", "hold_frame",
                       "repeat", "repeat_mode", "custom_frame_count"]) {
    hideWidgetForGood(node, findWidget(node, name));
  }
  // Also hide any DOM element widgets (e.g. bypass toggle)
  for (const w of (node.widgets ?? [])) {
    if (w?.name === "preview") continue;
    const el = (w as any).element as HTMLElement | null;
    if (el) el.style.display = "none";
  }
}

export function attachFrameSelectorControls(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state as any;
  if (!st?.frameSelectorControls || st.frameSelectorHooked) return;
  st.frameSelectorHooked = true;

  hideFrameSelectorWidgets(node);

  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : undefined;
  let moveRafPending = false;

  const refreshInteractive = (): void => {
    syncFrameSelectorWidgets(node);
    if (moveRafPending) return;
    moveRafPending = true;
    requestAnimationFrame(() => {
      moveRafPending = false;
      ctx.refreshPreviewOnly(node);
    });
  };

  const refreshCommit = (): void => {
    syncFrameSelectorWidgets(node);
    ctx.refreshNode(node);
  };

  let dragging: "start" | "end" | "center" | "hold" | null = null;
  let dragOffset = 0;
  let dragSelectionWidth = 0;

  const frameFromPointer = (event: PointerEvent): number => {
    const box = st.frameSelectorSliderBox as HTMLDivElement | null;
    if (!box) return 0;
    const rect = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    return Math.round((x / Math.max(1, rect.width)) * timelineMax(node));
  };

  st.frameSelectorSliderBox?.addEventListener("pointerdown", (event: PointerEvent) => {
    const max = timelineMax(node);
    const val = Math.max(0, Math.min(max, frameFromPointer(event)));
    const start = Math.max(0, Math.round(widgetNumber(node, "trim_start", 0)));
    const endRaw = Math.round(widgetNumber(node, "trim_end", -1));
    const end = endRaw < 0 ? max : Math.max(start, endRaw);
    const repeat = widgetBoolean(node, "repeat", false);
    const repeatMode = normalizeFrameSelectorRepeatStyle(widgetString(node, "repeat_mode", "loop"));
    const pickHoldFrame = widgetBoolean(node, "frame_hold", false) || (repeat && repeatMode === "freeze");
    const rect = st.frameSelectorSliderBox.getBoundingClientRect();
    const tolerance = Math.max(1, Math.round((10 / Math.max(1, rect.width)) * max));

    if (pickHoldFrame) {
      dragging = "hold";
      writeInt(node, "hold_frame", Math.max(start, Math.min(end, val)));
    } else if (val > start + tolerance && val < end - tolerance) {
      dragging = "center";
      dragOffset = val - start;
      dragSelectionWidth = end - start;
    } else if (Math.abs(val - start) <= Math.abs(val - end)) {
      dragging = "start";
      writeInt(node, "trim_start", Math.min(val, end));
    } else {
      dragging = "end";
      writeInt(node, "trim_end", Math.max(val, start));
    }
    refreshInteractive();
    st.frameSelectorSliderBox.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, listenerOptions);

  st.frameSelectorSliderBox?.addEventListener("pointermove", (event: PointerEvent) => {
    if (!dragging) return;
    const max = timelineMax(node);
    const val = Math.max(0, Math.min(max, frameFromPointer(event)));
    const start = Math.max(0, Math.round(widgetNumber(node, "trim_start", 0)));
    const endRaw = Math.round(widgetNumber(node, "trim_end", -1));
    const end = endRaw < 0 ? max : Math.max(start, endRaw);
    if (dragging === "hold") {
      writeInt(node, "hold_frame", Math.max(start, Math.min(end, val)));
    } else if (dragging === "start") {
      writeInt(node, "trim_start", Math.min(val, end));
    } else if (dragging === "end") {
      writeInt(node, "trim_end", Math.max(val, start));
    } else {
      let nextStart = val - dragOffset;
      let nextEnd = nextStart + dragSelectionWidth;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = dragSelectionWidth;
      } else if (nextEnd > max) {
        nextEnd = max;
        nextStart = max - dragSelectionWidth;
      }
      writeInt(node, "trim_start", nextStart);
      writeInt(node, "trim_end", nextEnd);
    }
    refreshInteractive();
    event.preventDefault();
  }, listenerOptions);

  const release = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = null;
    st.frameSelectorSliderBox?.releasePointerCapture?.(event.pointerId);
    refreshCommit();
  };
  st.frameSelectorSliderBox?.addEventListener("pointerup", release, listenerOptions);
  st.frameSelectorSliderBox?.addEventListener("pointercancel", release, listenerOptions);

  st.frameSelectorTrimStart?.addEventListener("input", () => {
    const start = Math.round(Number(st.frameSelectorTrimStart.value) || 0);
    const end = Math.round(widgetNumber(node, "trim_end", -1));
    writeInt(node, "trim_start", start);
    if (end >= 0 && end < start) writeInt(node, "trim_end", start);
    refreshCommit();
  }, listenerOptions);

  st.frameSelectorTrimEnd?.addEventListener("input", () => {
    const end = Math.round(Number(st.frameSelectorTrimEnd.value) || 0);
    const start = Math.round(widgetNumber(node, "trim_start", 0));
    writeInt(node, "trim_end", Math.max(start, end));
    refreshCommit();
  }, listenerOptions);

  st.frameSelectorHoldFrame?.addEventListener("input", () => {
    writeInt(node, "hold_frame", Number(st.frameSelectorHoldFrame.value) || 0);
    refreshCommit();
  }, listenerOptions);

  const repeatCountInput = (st as any).frameSelectorRepeatCountInput as HTMLInputElement | null;
  repeatCountInput?.addEventListener("input", () => {
    writeInt(node, "custom_frame_count", Number(repeatCountInput.value) || 1);
    refreshCommit();
  }, listenerOptions);

  const repeatModeSelect = (st as any).frameSelectorRepeatModeSelect as HTMLSelectElement | null;
  repeatModeSelect?.addEventListener("change", () => {
    const value = normalizeFrameSelectorRepeatStyle(repeatModeSelect.value);
    const widget = findWidget(node, "repeat_mode");
    setWidgetStringValue(widget, value);
    (widget as any)?.callback?.(value);
    refreshCommit();
  }, listenerOptions);

  // ── Hold scrubber pointer drag ────────────────────────────────────────
  const holdRow = (st as any).frameSelectorHoldRow as HTMLDivElement | null;
  const holdScrubber = holdRow ? (holdRow as any)._holdScrubber as HTMLElement | null : null;
  if (holdScrubber) {
    const holdFrameFromPointer = (event: PointerEvent): number => {
      const rect = holdScrubber.getBoundingClientRect();
      const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
      const max = timelineMax(node);
      const trimStart = Math.max(0, Math.min(max, Math.round(widgetNumber(node, "trim_start", 0))));
      const trimEndRaw = Math.round(widgetNumber(node, "trim_end", -1));
      const trimEnd = trimEndRaw < 0 ? max : Math.max(trimStart, Math.min(max, trimEndRaw));
      const span = Math.max(0, trimEnd - trimStart);
      return trimStart + Math.round((x / Math.max(1, rect.width)) * span);
    };
    holdScrubber.addEventListener("pointerdown", (event: PointerEvent) => {
      writeInt(node, "hold_frame", holdFrameFromPointer(event));
      refreshInteractive();
      holdScrubber.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }, listenerOptions);
    holdScrubber.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.buttons === 0) return;
      writeInt(node, "hold_frame", holdFrameFromPointer(event));
      refreshInteractive();
      event.preventDefault();
    }, listenerOptions);
    holdScrubber.addEventListener("pointerup", (event: PointerEvent) => {
      holdScrubber.releasePointerCapture?.(event.pointerId);
      refreshCommit();
    }, listenerOptions);
  }

  st.frameSelectorHoldToggle?.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    const w = findWidget(node, "frame_hold");
    if (!w) return;
    const newVal = !widgetBoolean(node, "frame_hold", false);
    setWidgetBooleanValue(w, newVal);
    (w as any).callback?.(newVal);
    refreshCommit();
  }, listenerOptions);

  const repeatToggle = (st as any).frameSelectorRepeatToggle as HTMLButtonElement | null;
  repeatToggle?.addEventListener("click", (event: MouseEvent) => {
    event.preventDefault();
    const w = findWidget(node, "repeat");
    if (!w) return;
    const newVal = !widgetBoolean(node, "repeat", false);
    setWidgetBooleanValue(w, newVal);
    (w as any).callback?.(newVal);
    refreshCommit();
  }, listenerOptions);

  syncFrameSelectorWidgets(node);
}
