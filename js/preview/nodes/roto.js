import { resolveImageOpsClassName } from "../shared/classes.js";
import { styleSoftButton, styleSoftField } from "../shared/dom-styles.js";
import { evalShape, isAnimated, keyIndexAt, parseDoc } from "../shared/roto-shapes.js";
import { hideWidgetsByName, widgetNumber, widgetString } from "../shared/widgets.js";
const NODE_CLASS = "ImageOpsRoto";
const TOOLS = [
  { id: "select", label: "Select", title: "Select / edit points (V). Double-click a segment to add a point, Delete removes." },
  { id: "bezier", label: "Bezier", title: "Click to add points, drag to pull handles. Click the first point or press Enter to close, Esc to cancel (B)." },
  { id: "ellipse", label: "Ellipse", title: "Drag to draw an ellipse, hold Shift for a circle (E)." },
  { id: "rect", label: "Rect", title: "Drag to draw a rectangle, hold Shift for a square (R)." },
  { id: "free", label: "Free", title: "Draw freehand, the stroke becomes a smooth closed bezier (F)." }
];
const OP_COLORS = {
  add: "98, 224, 255",
  subtract: "255, 168, 76",
  intersect: "190, 140, 255"
};
function isNode(node) {
  return resolveImageOpsClassName(node?.comfyClass) === NODE_CLASS;
}
function getRotoState(node) {
  const st = node.__imageops_state;
  st.roto ?? (st.roto = { tool: "select", shapeId: null, pointIndex: null, drag: null, draft: null, hold: null, undo: [], redo: [] });
  return st.roto;
}
function getRotoKeyFrame(node) {
  const st = node?.__imageops_state;
  const index = st?.roto?.hold ?? (Number.isFinite(st?.previewFrameIndex) ? st.previewFrameIndex : 0);
  return index + Math.round(widgetNumber(node, "frame_offset", 0));
}
function getRotoSourceSize(node, fallbackWidth, fallbackHeight) {
  const st = node?.__imageops_state;
  const width = Number(st?.previewSourceWidth) || 0;
  const height = Number(st?.previewSourceHeight) || 0;
  return width > 0 && height > 0 ? { width, height } : { width: fallbackWidth, height: fallbackHeight };
}
function getRotoInfoText(node, width, height) {
  const count = parseDoc(widgetString(node, "shapes", "")).shapes.length;
  const hold = node?.__imageops_state?.roto?.hold;
  return `Roto (${count} shape${count === 1 ? "" : "s"}, ${width}x${height}${hold != null ? `, frame ${hold}` : ""})`;
}
function hideRotoWidgets(node) {
  if (!isNode(node)) return;
  hideWidgetsByName(node, "shapes");
}
function rotoToCanvas(geometry, x, y) {
  return { x: geometry.fitDx + x * geometry.fitDrawWidth, y: geometry.fitDy + y * geometry.fitDrawHeight };
}
function rotoFromCanvas(geometry, x, y) {
  return [(x - geometry.fitDx) / Math.max(1, geometry.fitDrawWidth), (y - geometry.fitDy) / Math.max(1, geometry.fitDrawHeight)];
}
function getSelectedShape(node, doc) {
  const rs = getRotoState(node);
  return doc.shapes.find((s) => s.id === rs.shapeId) ?? null;
}
function tracePath(ctx, geometry, pts, closed) {
  const n = pts.length;
  const at = (x, y) => rotoToCanvas(geometry, x, y);
  const start = at(pts[0][0], pts[0][1]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c1 = at(a[0] + a[4], a[1] + a[5]);
    const c2 = at(b[0] + b[2], b[1] + b[3]);
    const end = at(b[0], b[1]);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  }
  if (closed) ctx.closePath();
}
function drawPoint(ctx, geometry, pt, unit, mode) {
  const p = rotoToCanvas(geometry, pt[0], pt[1]);
  const half = 4.5 * unit;
  ctx.fillStyle = mode === "selected" ? "rgba(255, 214, 80, 1)" : mode === "first" ? "rgba(120, 255, 160, 1)" : "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "rgba(10, 18, 24, 0.95)";
  ctx.lineWidth = 1.25 * unit;
  ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
  ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
}
function drawDraft(ctx, geometry, draft, unit) {
  if (!draft) return;
  ctx.save();
  ctx.strokeStyle = "rgba(255, 230, 120, 0.95)";
  ctx.lineWidth = 1.5 * unit;
  ctx.setLineDash([5 * unit, 4 * unit]);
  if (draft.kind === "bezier" && draft.pts && draft.pts.length) {
    tracePath(ctx, geometry, draft.pts, false);
    ctx.stroke();
    if (draft.cursor) {
      const last = draft.pts[draft.pts.length - 1];
      const a = rotoToCanvas(geometry, last[0] + last[4], last[1] + last[5]);
      const c = rotoToCanvas(geometry, draft.cursor[0], draft.cursor[1]);
      const p = rotoToCanvas(geometry, last[0], last[1]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.bezierCurveTo(a.x, a.y, c.x, c.y, c.x, c.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    draft.pts.forEach((pt, i) => drawPoint(ctx, geometry, pt, unit, i === 0 ? "first" : "normal"));
  } else if (draft.kind === "free" && draft.stroke && draft.stroke.length > 1) {
    ctx.beginPath();
    draft.stroke.forEach(([x, y], i) => {
      const p = rotoToCanvas(geometry, x, y);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  } else if ((draft.kind === "ellipse" || draft.kind === "rect") && draft.pts) {
    tracePath(ctx, geometry, draft.pts, true);
    ctx.stroke();
  }
  ctx.restore();
}
function drawRotoBounds(node, ctx, width, height, sourceWidth, sourceHeight, fit) {
  if (!isNode(node)) return null;
  const geometry = { sourceWidth, sourceHeight, fitDx: fit.dx, fitDy: fit.dy, fitDrawWidth: fit.drawWidth, fitDrawHeight: fit.drawHeight };
  const st = node.__imageops_state;
  const rs = getRotoState(node);
  const doc = parseDoc(widgetString(node, "shapes", ""));
  const frame = getRotoKeyFrame(node);
  const unit = 1 / Math.max(0.35, st?.previewZoom ?? 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();
  for (const shape of doc.shapes) {
    const pts = evalShape(shape, frame);
    if (pts.length < 2) continue;
    const selected = shape.id === rs.shapeId;
    const color = OP_COLORS[shape.op] ?? OP_COLORS.add;
    tracePath(ctx, geometry, pts, shape.closed);
    ctx.lineWidth = (selected ? 2 : 1.25) * unit;
    ctx.strokeStyle = `rgba(${color}, ${shape.visible ? selected ? 1 : 0.7 : 0.25})`;
    ctx.stroke();
    if (!selected) continue;
    ctx.lineWidth = 1 * unit;
    for (const pt of pts) {
      const p = rotoToCanvas(geometry, pt[0], pt[1]);
      for (const [dx, dy] of [[pt[2], pt[3]], [pt[4], pt[5]]]) {
        if (dx === 0 && dy === 0) continue;
        const h = rotoToCanvas(geometry, pt[0] + dx, pt[1] + dy);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(h.x, h.y);
        ctx.stroke();
        ctx.fillStyle = `rgba(${color}, 1)`;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 3.5 * unit, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    pts.forEach((pt, i) => drawPoint(ctx, geometry, pt, unit, i === rs.pointIndex ? "selected" : "normal"));
  }
  drawDraft(ctx, geometry, rs.draft, unit);
  ctx.restore();
  return geometry;
}
function makeButton(label, title) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.title = title ?? "";
  styleSoftButton(button, false);
  return button;
}
function makeRow() {
  const row = document.createElement("div");
  row.style.display = "flex";
  row.style.flexWrap = "wrap";
  row.style.alignItems = "center";
  row.style.gap = "4px";
  return row;
}
function makeLabel(text) {
  const label = document.createElement("span");
  label.textContent = text;
  label.style.fontSize = "11px";
  label.style.opacity = "0.78";
  label.style.minWidth = "44px";
  return label;
}
function makeRange(min, max, step, width = "90px") {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.flex = `1 1 ${width}`;
  input.style.minWidth = "60px";
  return input;
}
function makeNumber(width = "56px") {
  const input = document.createElement("input");
  input.type = "number";
  styleSoftField(input);
  input.style.width = width;
  return input;
}
function createRotoControlsUi() {
  const controls = document.createElement("div");
  controls.style.marginTop = "8px";
  controls.style.display = "flex";
  controls.style.flexDirection = "column";
  controls.style.gap = "6px";
  controls.style.padding = "0 4px";
  controls.style.width = "100%";
  controls.style.boxSizing = "border-box";
  const toolRow = makeRow();
  const toolButtons = {};
  for (const tool of TOOLS) {
    const button = makeButton(tool.label, tool.title);
    toolButtons[tool.id] = button;
    toolRow.appendChild(button);
  }
  const shapeRow = makeRow();
  const shapeSelect = document.createElement("select");
  styleSoftField(shapeSelect);
  shapeSelect.style.flex = "1 1 100px";
  const opSelect = document.createElement("select");
  styleSoftField(opSelect);
  for (const op of ["add", "subtract", "intersect"]) {
    const option = document.createElement("option");
    option.value = op;
    option.textContent = op;
    opSelect.appendChild(option);
  }
  const visibleButton = makeButton("Hide", "Toggle shape visibility");
  const upButton = makeButton("\u25B2", "Move shape up (drawn later)");
  const downButton = makeButton("\u25BC", "Move shape down");
  const deleteShapeButton = makeButton("Delete", "Delete shape");
  shapeRow.append(shapeSelect, opSelect, visibleButton, upButton, downButton, deleteShapeButton);
  const shapeFeatherRow = makeRow();
  const featherRange = makeRange(0, 128, 0.5);
  const featherNumber = makeNumber();
  const opacityRange = makeRange(0, 1, 0.01);
  const opacityNumber = makeNumber();
  opacityNumber.step = "0.05";
  shapeFeatherRow.append(makeLabel("Feather"), featherRange, featherNumber, makeLabel("Opacity"), opacityRange, opacityNumber);
  const frameRow = makeRow();
  const frameRange = makeRange(0, 100, 1);
  const frameNumber = makeNumber();
  frameNumber.step = "1";
  const holdButton = makeButton("Live", "Live follows playback. Click to hold on a frame for editing and keyframing.");
  frameRow.append(makeLabel("Frame"), frameRange, frameNumber, holdButton);
  const keyRow = makeRow();
  const prevKeyButton = makeButton("\u25C0 Key", "Jump to previous keyframe");
  const setKeyButton = makeButton("\u25C6 Set key", "Add a keyframe for the selected shape at this frame (K)");
  const delKeyButton = makeButton("\u2715 Key", "Delete the keyframe at this frame");
  const nextKeyButton = makeButton("Key \u25B6", "Jump to next keyframe");
  const keyInfo = makeLabel("");
  keyInfo.style.minWidth = "0";
  keyRow.append(prevKeyButton, setKeyButton, delKeyButton, nextKeyButton, keyInfo);
  const pointRow = makeRow();
  const smoothButton = makeButton("Smooth", "Make the selected point smooth (S)");
  const cornerButton = makeButton("Corner", "Make the selected point a sharp corner (C)");
  const undoButton = makeButton("Undo", "Ctrl+Z");
  const redoButton = makeButton("Redo", "Ctrl+Shift+Z");
  pointRow.append(smoothButton, cornerButton, undoButton, redoButton);
  controls.append(toolRow, shapeRow, shapeFeatherRow, frameRow, keyRow, pointRow);
  return {
    controls,
    toolButtons,
    shapeSelect,
    opSelect,
    visibleButton,
    upButton,
    downButton,
    deleteShapeButton,
    featherRange,
    featherNumber,
    opacityRange,
    opacityNumber,
    frameRange,
    frameNumber,
    holdButton,
    prevKeyButton,
    setKeyButton,
    delKeyButton,
    nextKeyButton,
    keyInfo,
    smoothButton,
    cornerButton,
    undoButton,
    redoButton
  };
}
function setValueIfIdle(input, value) {
  if (document.activeElement !== input) input.value = String(value);
}
function syncRotoControls(node, frameCountHint = 0) {
  const st = node?.__imageops_state;
  const ui = st?.rotoUi;
  if (!st || !ui) return;
  const rs = getRotoState(node);
  const doc = parseDoc(widgetString(node, "shapes", ""));
  if (rs.shapeId && !doc.shapes.some((s) => s.id === rs.shapeId)) {
    rs.shapeId = null;
    rs.pointIndex = null;
  }
  for (const tool of TOOLS) styleSoftButton(ui.toolButtons[tool.id], rs.tool === tool.id);
  const signature = doc.shapes.map((s) => `${s.id}:${s.name}`).join("|");
  if (ui.shapeSelect.dataset.signature !== signature) {
    ui.shapeSelect.dataset.signature = signature;
    ui.shapeSelect.replaceChildren();
    for (const shape2 of doc.shapes) {
      const option = document.createElement("option");
      option.value = shape2.id;
      option.textContent = shape2.name || shape2.id;
      ui.shapeSelect.appendChild(option);
    }
  }
  const shape = getSelectedShape(node, doc);
  ui.shapeSelect.value = shape?.id ?? "";
  const shapeControls = [
    ui.opSelect,
    ui.visibleButton,
    ui.upButton,
    ui.downButton,
    ui.deleteShapeButton,
    ui.featherRange,
    ui.featherNumber,
    ui.opacityRange,
    ui.opacityNumber,
    ui.setKeyButton,
    ui.delKeyButton,
    ui.prevKeyButton,
    ui.nextKeyButton
  ];
  for (const el of shapeControls) el.disabled = !shape;
  if (shape) {
    ui.opSelect.value = shape.op;
    ui.visibleButton.textContent = shape.visible ? "Hide" : "Show";
    ui.featherRange.value = String(Math.min(128, shape.feather));
    setValueIfIdle(ui.featherNumber, shape.feather);
    ui.opacityRange.value = String(shape.opacity);
    setValueIfIdle(ui.opacityNumber, shape.opacity);
  }
  const held = rs.hold != null;
  styleSoftButton(ui.holdButton, held);
  ui.holdButton.textContent = held ? "Hold" : "Live";
  const frame = rs.hold ?? (Number.isFinite(st.previewFrameIndex) ? st.previewFrameIndex : 0);
  const lastKey = shape ? shape.keys[shape.keys.length - 1].f : 0;
  const count = Math.max(frameCountHint, Number(st.previewFrameCount) || 0, 1);
  ui.frameRange.max = String(Math.max(count - 1, lastKey, frame, 1));
  ui.frameRange.value = String(frame);
  setValueIfIdle(ui.frameNumber, frame);
  if (shape) {
    const onKey = keyIndexAt(shape, getRotoKeyFrame(node)) >= 0;
    ui.keyInfo.textContent = isAnimated(shape) ? `${shape.keys.length} keys${onKey ? " \u2022 key here" : ""}` : "static";
    ui.delKeyButton.disabled = !onKey || shape.keys.length <= 1;
    ui.setKeyButton.disabled = onKey;
  } else {
    ui.keyInfo.textContent = "";
  }
  ui.undoButton.disabled = rs.undo.length === 0;
  ui.redoButton.disabled = rs.redo.length === 0;
  ui.smoothButton.disabled = ui.cornerButton.disabled = !shape || rs.pointIndex == null;
}
export {
  NODE_CLASS,
  TOOLS,
  createRotoControlsUi,
  drawRotoBounds,
  getRotoInfoText,
  getRotoKeyFrame,
  getRotoSourceSize,
  getRotoState,
  getSelectedShape,
  hideRotoWidgets,
  isNode,
  rotoFromCanvas,
  rotoToCanvas,
  syncRotoControls
};
