import { ensureJoinInputs, getJoinSlots, getPreviewNodeFrameCount, readJoinTrims, removeJoinInput, writeJoinTrims } from "../nodes/append.js";
import { getUpstreamNode } from "../graph.js";
import { styleInlineAction, styleSoftField } from "../shared/dom-styles.js";
function inputIndexForSlot(node, slot) {
  return (node.inputs ?? []).findIndex((input) => String(input?.name ?? "") === slot);
}
function getDirectInputFrameCount(node, inputIndex) {
  return getPreviewNodeFrameCount(getUpstreamNode(node, inputIndex));
}
function selectionCount(start, end, frameCount) {
  const max = Math.max(0, frameCount - 1);
  const s = Math.max(0, Math.min(max, Math.round(start)));
  const e = end < 0 ? max : Math.max(0, Math.min(max, Math.round(end)));
  return Math.max(1, Math.abs(e - s) + 1);
}
function syncFill(fill, start, end, max) {
  const lo = Math.max(0, Math.min(max, Math.min(start, end)));
  const hi = Math.max(0, Math.min(max, Math.max(start, end)));
  const startPct = max > 0 ? lo / max * 100 : 0;
  const endPct = max > 0 ? hi / max * 100 : 100;
  fill.style.left = `${startPct}%`;
  fill.style.width = `${Math.max(0, endPct - startPct)}%`;
}
function formatFrame(frame) {
  return `${Math.max(0, Math.round(frame))}f`;
}
function createHandle(color) {
  const handle = document.createElement("div");
  handle.style.position = "absolute";
  handle.style.top = "-4px";
  handle.style.width = "2px";
  handle.style.height = "24px";
  handle.style.background = color;
  handle.style.borderRadius = "999px";
  handle.style.boxShadow = `0 0 0 1px ${color}, 0 0 10px ${color}55`;
  handle.style.transform = "translateX(-50%)";
  handle.style.pointerEvents = "none";
  return handle;
}
function buildRuler(max) {
  const ruler = document.createElement("div");
  ruler.style.position = "relative";
  ruler.style.height = "18px";
  ruler.style.fontSize = "9px";
  ruler.style.color = "rgba(255,255,255,0.52)";
  ruler.style.userSelect = "none";
  ruler.style.pointerEvents = "none";
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
      const label = document.createElement("div");
      label.textContent = formatFrame(max * pct);
      tick.appendChild(label);
    }
    ruler.appendChild(tick);
  }
  return ruler;
}
function selectionText(start, end, frameCount) {
  return `${start}\u2013${end} (${selectionCount(start, end, frameCount)}f)`;
}
function buildJoinTrimRow(node, ctx, st, slot, index) {
  const wrap = document.createElement("div");
  wrap.style.display = "grid";
  wrap.style.gap = "4px";
  const header = document.createElement("div");
  header.style.display = "grid";
  header.style.gridTemplateColumns = "minmax(0,1fr) auto";
  header.style.gap = "8px";
  header.style.alignItems = "center";
  const title = document.createElement("div");
  title.style.fontSize = "11px";
  title.style.opacity = "0.82";
  const meta = document.createElement("div");
  meta.style.fontSize = "10px";
  meta.style.opacity = "0.68";
  meta.style.fontFamily = "ui-monospace, SFMono-Regular, Consolas, monospace";
  header.append(title, meta);
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
  const fill = document.createElement("div");
  fill.style.position = "absolute";
  fill.style.top = "0";
  fill.style.height = "100%";
  fill.style.display = "flex";
  fill.style.alignItems = "center";
  fill.style.justifyContent = "center";
  fill.style.background = "linear-gradient(90deg, rgba(34,197,94,0.18), rgba(250,204,21,0.22), rgba(239,68,68,0.18))";
  fill.style.pointerEvents = "none";
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
  const startHandle = createHandle("#22c55e");
  const endHandle = createHandle("#ef4444");
  sliderBox.append(startHandle, endHandle);
  let ruler = buildRuler(0);
  const timelineWrap = document.createElement("div");
  timelineWrap.style.display = "grid";
  timelineWrap.style.gap = "4px";
  timelineWrap.append(sliderBox, ruler);
  const row = document.createElement("div");
  row.style.display = "grid";
  row.style.gridTemplateColumns = "auto 54px auto 54px auto";
  row.style.gap = "6px";
  row.style.alignItems = "center";
  const startLabel = document.createElement("div");
  startLabel.textContent = "In";
  startLabel.style.fontSize = "10px";
  startLabel.style.fontWeight = "600";
  startLabel.style.color = "#22c55e";
  startLabel.style.textTransform = "uppercase";
  startLabel.style.letterSpacing = "0.04em";
  const startNumber = document.createElement("input");
  startNumber.type = "number";
  startNumber.min = "0";
  startNumber.step = "1";
  styleSoftField(startNumber);
  const endLabel = document.createElement("div");
  endLabel.textContent = "Out";
  endLabel.style.fontSize = "10px";
  endLabel.style.fontWeight = "600";
  endLabel.style.color = "#ef4444";
  endLabel.style.textTransform = "uppercase";
  endLabel.style.letterSpacing = "0.04em";
  const endNumber = document.createElement("input");
  endNumber.type = "number";
  endNumber.min = "0";
  endNumber.step = "1";
  styleSoftField(endNumber);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "x";
  styleInlineAction(removeButton);
  removeButton.style.width = "24px";
  removeButton.style.paddingLeft = "0";
  removeButton.style.paddingRight = "0";
  row.append(startLabel, startNumber, endLabel, endNumber, removeButton);
  wrap.append(header, timelineWrap, row);
  const rowState = {
    slot,
    index,
    wrap,
    title,
    meta,
    sliderBox,
    fill,
    fillLabel,
    startHandle,
    endHandle,
    ruler,
    startNumber,
    endNumber,
    removeButton,
    maxFrame: 0,
    frameCount: 1,
    dragging: null,
    dragOffset: 0,
    dragSelectionWidth: 0,
    syncTimeline() {
      const start = Math.max(0, Math.min(rowState.maxFrame, Math.round(Number(rowState.startNumber.value || 0))));
      const end = Math.max(start, Math.min(rowState.maxFrame, Math.round(Number(rowState.endNumber.value || rowState.maxFrame))));
      const startPct = rowState.maxFrame > 0 ? start / rowState.maxFrame * 100 : 0;
      const endPct = rowState.maxFrame > 0 ? end / rowState.maxFrame * 100 : 100;
      rowState.startHandle.style.left = `${startPct}%`;
      rowState.endHandle.style.left = `${endPct}%`;
      syncFill(rowState.fill, start, end, rowState.maxFrame);
      rowState.fillLabel.textContent = selectionText(start, end, Math.max(1, rowState.frameCount || rowState.maxFrame + 1));
    },
    commit(refreshMode = "now") {
      const next = readJoinTrims(node);
      let existing = next.find((entry) => entry.slot === rowState.slot);
      if (!existing) {
        existing = { slot: rowState.slot, start: 0, end: -1 };
        next.push(existing);
      }
      existing.start = Math.max(0, Math.min(rowState.maxFrame, Math.round(Number(rowState.startNumber.value || 0))));
      existing.end = Math.max(0, Math.min(rowState.maxFrame, Math.round(Number(rowState.endNumber.value || rowState.maxFrame))));
      if (existing.end < existing.start) existing.end = existing.start;
      rowState.startNumber.value = String(existing.start);
      rowState.endNumber.value = String(existing.end);
      rowState.meta.textContent = rowState.frameCount > 0 ? `${selectionCount(existing.start, existing.end, rowState.frameCount)}/${rowState.frameCount}f` : `${selectionCount(existing.start, existing.end, rowState.maxFrame + 1)}f`;
      rowState.syncTimeline();
      writeJoinTrims(node, next);
      if (refreshMode === "now") {
        ctx.refreshNode(node);
      }
    }
  };
  const frameFromPointer = (event) => {
    const rect = rowState.sliderBox.getBoundingClientRect();
    const x = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    return Math.round(x / Math.max(1, rect.width) * rowState.maxFrame);
  };
  rowState.sliderBox.addEventListener("pointerdown", (event) => {
    st.joinDragActive = true;
    const val = Math.max(0, Math.min(rowState.maxFrame, frameFromPointer(event)));
    const start = Math.round(Number(rowState.startNumber.value) || 0);
    const end = Math.round(Number(rowState.endNumber.value) || rowState.maxFrame);
    const rect = rowState.sliderBox.getBoundingClientRect();
    const tolerance = Math.max(1, Math.round(10 / Math.max(1, rect.width) * rowState.maxFrame));
    if (val > start + tolerance && val < end - tolerance) {
      rowState.dragging = "center";
      rowState.dragOffset = val - start;
      rowState.dragSelectionWidth = end - start;
    } else if (Math.abs(val - start) <= Math.abs(val - end)) {
      rowState.dragging = "start";
      rowState.startNumber.value = String(Math.min(val, end));
    } else {
      rowState.dragging = "end";
      rowState.endNumber.value = String(Math.max(val, start));
    }
    rowState.commit("none");
    rowState.sliderBox.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  rowState.sliderBox.addEventListener("pointermove", (event) => {
    if (!rowState.dragging) return;
    const val = Math.max(0, Math.min(rowState.maxFrame, frameFromPointer(event)));
    const start = Math.round(Number(rowState.startNumber.value) || 0);
    const end = Math.round(Number(rowState.endNumber.value) || rowState.maxFrame);
    if (rowState.dragging === "start") {
      rowState.startNumber.value = String(Math.min(val, end));
    } else if (rowState.dragging === "end") {
      rowState.endNumber.value = String(Math.max(val, start));
    } else {
      let nextStart = val - rowState.dragOffset;
      let nextEnd = nextStart + rowState.dragSelectionWidth;
      if (nextStart < 0) {
        nextStart = 0;
        nextEnd = rowState.dragSelectionWidth;
      } else if (nextEnd > rowState.maxFrame) {
        nextEnd = rowState.maxFrame;
        nextStart = Math.max(0, rowState.maxFrame - rowState.dragSelectionWidth);
      }
      rowState.startNumber.value = String(nextStart);
      rowState.endNumber.value = String(nextEnd);
    }
    rowState.commit("none");
    event.preventDefault();
  });
  const release = (event) => {
    if (!rowState.dragging) return;
    rowState.dragging = null;
    st.joinDragActive = false;
    rowState.sliderBox.releasePointerCapture?.(event.pointerId);
    ctx.refreshNode(node);
  };
  rowState.sliderBox.addEventListener("pointerup", release);
  rowState.sliderBox.addEventListener("pointercancel", release);
  rowState.startNumber.addEventListener("change", () => rowState.commit("now"));
  rowState.endNumber.addEventListener("change", () => rowState.commit("now"));
  rowState.removeButton.addEventListener("click", (event) => {
    event.preventDefault();
    if (!removeJoinInput(node, rowState.index)) return;
    renderJoinTrimControls(node, ctx);
    ctx.refreshNode(node);
  });
  return rowState;
}
function syncJoinTrimRow(row, index, frameCount, startValue, endValue, maxFrame, canRemove) {
  row.index = index;
  row.title.textContent = `Clip ${index}`;
  row.meta.textContent = frameCount > 0 ? `${selectionCount(startValue, endValue, frameCount)}/${frameCount}f` : `${selectionCount(startValue, endValue, maxFrame + 1)}f`;
  row.frameCount = Math.max(1, frameCount || maxFrame + 1);
  row.maxFrame = maxFrame;
  row.startNumber.max = String(maxFrame);
  row.endNumber.max = String(maxFrame);
  row.startNumber.value = String(startValue);
  row.endNumber.value = String(endValue);
  row.removeButton.title = `Remove clip ${index}`;
  row.removeButton.disabled = !canRemove;
  row.removeButton.style.opacity = row.removeButton.disabled ? "0.35" : "0.85";
  const nextRuler = buildRuler(maxFrame);
  row.ruler.replaceWith(nextRuler);
  row.ruler = nextRuler;
  row.syncTimeline();
}
function renderJoinTrimControls(node, ctx) {
  const st = node.__imageops_state;
  const list = st?.joinTrimList;
  if (!list) return;
  if (st?.joinDragActive) return;
  ensureJoinInputs(node, 2);
  const trims = readJoinTrims(node);
  const bySlot = new Map(trims.map((trim) => [trim.slot, trim]));
  let rows = st.joinTrimRows;
  if (!(rows instanceof Map)) {
    rows = /* @__PURE__ */ new Map();
    st.joinTrimRows = rows;
  }
  const slots = getJoinSlots(node);
  const liveSlots = /* @__PURE__ */ new Set();
  for (const index of slots) {
    const slot = `image_${index}`;
    liveSlots.add(slot);
    const trim = bySlot.get(slot) ?? { slot, start: 0, end: -1 };
    const inputIndex = inputIndexForSlot(node, slot);
    const frameCount = inputIndex >= 0 ? getDirectInputFrameCount(node, inputIndex) : 0;
    const maxFrame = Math.max(0, (frameCount > 0 ? frameCount : 1001) - 1);
    const startValue = Math.max(0, Math.min(maxFrame, trim.start));
    const endValue = trim.end < 0 ? maxFrame : Math.max(0, Math.min(maxFrame, trim.end));
    let row = rows.get(slot);
    if (!row) {
      row = buildJoinTrimRow(node, ctx, st, slot, index);
      rows.set(slot, row);
    }
    syncJoinTrimRow(row, index, frameCount, startValue, endValue, maxFrame, slots.length > 2);
    list.appendChild(row.wrap);
  }
  for (const [slot, row] of Array.from(rows.entries())) {
    if (liveSlots.has(slot)) continue;
    row.wrap.remove();
    rows.delete(slot);
  }
}
function attachInteractions(node, ctx) {
  const st = node.__imageops_state;
  if (!st) return;
  if (st.joinInteractiveHooked) {
    renderJoinTrimControls(node, ctx);
    return;
  }
  st.joinInteractiveHooked = true;
  renderJoinTrimControls(node, ctx);
  if (st.joinAddButtonHooked) return;
  st.joinAddButtonHooked = true;
  st.joinAddButton?.addEventListener("click", (event) => {
    event.preventDefault();
    const before = getJoinSlots(node);
    const nextIndex = Math.max(0, ...before) + 1;
    ensureJoinInputs(node, nextIndex);
    renderJoinTrimControls(node, ctx);
    ctx.refreshNode(node);
  });
}
function syncJoinControls(node, ctx) {
  renderJoinTrimControls(node, ctx);
}
export {
  attachInteractions,
  syncJoinControls
};
