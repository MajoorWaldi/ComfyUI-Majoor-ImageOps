import { detectSource, getUpstreamNodes } from "../core/graph.js";
import { getUpstreamVideoFps, getUpstreamVideoTiming } from "../core/video.js";
import {
  getRotoKeyFrame,
  getRotoState,
  getSelectedShape,
  isNode,
  rotoFromCanvas,
  rotoToCanvas,
  syncRotoControls
} from "../nodes/roto.js";
import { getCanvasPointer, screenToWorld } from "../shared/geometry.js";
import {
  addKey,
  adjacentKeyFrame,
  autoHandles,
  cloneDoc,
  cornerHandles,
  ellipsePoints,
  evalShape,
  flatten,
  freehandToPoints,
  insertPoint,
  makeShape,
  nearestOnPath,
  parseDoc,
  pointInPolygon,
  rectPoints,
  removeKey,
  removePoint,
  serializeDoc,
  setPointsAtFrame
} from "../shared/roto-shapes.js";
import { findWidget, setWidgetStringValue, widgetNumber, widgetString } from "../shared/widgets.js";
const HIT_POINT = 9;
const HIT_HANDLE = 8;
const HIT_PATH = 8;
const MIN_DRAG = 4e-3;
function clonePts(pts) {
  return pts.map((p) => p.slice());
}
function attachInteractions(node, ctx) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  if (!st?.canvas || st.rotoHooked || !st.rotoUi) return;
  st.rotoHooked = true;
  const canvas = st.canvas;
  const ui = st.rotoUi;
  const rs = getRotoState(node);
  const listenerOptions = st._abortController?.signal ? { signal: st._abortController.signal } : void 0;
  const readText = () => widgetString(node, "shapes", "");
  const readDoc = () => cloneDoc(parseDoc(readText()));
  const keyFrame = () => getRotoKeyFrame(node);
  const geometry = () => st.rotoGeometry ?? null;
  const unit = () => 1 / Math.max(0.35, st.previewZoom ?? 1);
  const frameCount = () => Math.max(getUpstreamVideoTiming(node, 0).frameCount || 0, Number(st.previewFrameCount) || 0, 1);
  let refreshPending = false;
  const refresh = () => {
    syncRotoControls(node, frameCount());
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => {
      refreshPending = false;
      ctx.refreshNode(node);
    });
  };
  const write = (doc) => {
    setWidgetStringValue(findWidget(node, "shapes"), serializeDoc(doc), { notify: false });
    refresh();
  };
  const pushUndo = () => {
    rs.undo.push(readText());
    if (rs.undo.length > 100) rs.undo.shift();
    rs.redo.length = 0;
  };
  const commit = (doc) => {
    pushUndo();
    write(doc);
  };
  const restore = (from, to) => {
    if (from.length === 0) return;
    to.push(readText());
    setWidgetStringValue(findWidget(node, "shapes"), from.pop(), { notify: false });
    refresh();
  };
  const forEachUpstream = (fn) => {
    const seen = /* @__PURE__ */ new Set();
    const queue = [...getUpstreamNodes(node)];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      fn(cur);
      queue.push(...getUpstreamNodes(cur));
    }
  };
  const setHold = (index) => {
    rs.hold = index == null ? null : Math.max(0, Math.round(index));
    const fps = getUpstreamVideoFps(node, 0) || 24;
    forEachUpstream((upstream) => {
      upstream.__imageops_media?.staticRenderCache?.clear();
      if (detectSource(upstream)?.kind !== "video") return;
      upstream.__imageops_media ?? (upstream.__imageops_media = {});
      upstream.__imageops_media.holdTime = rs.hold == null ? void 0 : (rs.hold + 0.5) / fps;
    });
    node.__imageops_media?.staticRenderCache?.clear();
    st.nativeDirty = true;
    refresh();
  };
  const ensureHold = () => {
    if (rs.hold == null) setHold(Number.isFinite(st.previewFrameIndex) ? st.previewFrameIndex : 0);
  };
  const setTool = (tool) => {
    rs.tool = tool;
    rs.draft = null;
    rs.drag = null;
    canvas.style.cursor = tool === "select" ? "default" : "crosshair";
    refresh();
  };
  const select = (shapeId, pointIndex = null) => {
    rs.shapeId = shapeId;
    rs.pointIndex = pointIndex;
    refresh();
  };
  const worldPoint = (event) => {
    const raw = getCanvasPointer(canvas, event);
    return screenToWorld(raw.x, raw.y, st.previewZoom ?? 1, st.previewPanX ?? 0, st.previewPanY ?? 0, canvas.width);
  };
  const normalized = (event) => {
    const g = geometry();
    if (!g) return null;
    const world = worldPoint(event);
    return { world, norm: rotoFromCanvas(g, world.x, world.y) };
  };
  const dist = (world, x, y) => {
    const p = rotoToCanvas(geometry(), x, y);
    return Math.hypot(world.x - p.x, world.y - p.y);
  };
  const addShape = (pts, label) => {
    const doc = readDoc();
    const shape = makeShape(doc, pts, true, label);
    doc.shapes.push(shape);
    rs.shapeId = shape.id;
    rs.pointIndex = null;
    commit(doc);
  };
  const finishBezier = () => {
    const draft = rs.draft;
    rs.draft = null;
    if (draft?.kind === "bezier" && draft.pts && draft.pts.length >= 3) {
      addShape(draft.pts, "Bezier");
      setTool("select");
    } else {
      refresh();
    }
  };
  const deleteSelectedShape = () => {
    const doc = readDoc();
    doc.shapes = doc.shapes.filter((s) => s.id !== rs.shapeId);
    rs.shapeId = null;
    rs.pointIndex = null;
    commit(doc);
  };
  const editSelected = (mutate) => {
    const doc = readDoc();
    const shape = getSelectedShape(node, doc);
    if (!shape) return;
    mutate(shape, doc);
    commit(doc);
  };
  const hitSelectedShape = (world, shape) => {
    const pts = evalShape(shape, keyFrame());
    const tol = unit();
    for (let i = 0; i < pts.length; i++) {
      const handles = [["out", pts[i][4], pts[i][5]], ["in", pts[i][2], pts[i][3]]];
      for (const [kind, dx, dy] of handles) {
        if ((dx !== 0 || dy !== 0) && dist(world, pts[i][0] + dx, pts[i][1] + dy) <= HIT_HANDLE * tol) return { kind, index: i };
      }
    }
    for (let i = 0; i < pts.length; i++) {
      if (dist(world, pts[i][0], pts[i][1]) <= HIT_POINT * tol) return { kind: "point", index: i };
    }
    return null;
  };
  const hitShapeBody = (world, doc) => {
    const g = geometry();
    const frame = keyFrame();
    const tol = HIT_PATH * unit();
    const lx = world.x - g.fitDx;
    const ly = world.y - g.fitDy;
    for (let s = doc.shapes.length - 1; s >= 0; s--) {
      const shape = doc.shapes[s];
      if (!shape.visible) continue;
      const pts = evalShape(shape, frame);
      if (pts.length < 2) continue;
      const near = nearestOnPath(pts, shape.closed, g.fitDrawWidth, g.fitDrawHeight, lx, ly);
      if (near && near.dist <= tol) return shape;
      if (shape.closed && pointInPolygon(lx, ly, flatten(pts, true, g.fitDrawWidth, g.fitDrawHeight))) return shape;
    }
    return null;
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || !geometry()) return;
    const at = normalized(event);
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    canvas.focus();
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
    }
    const doc = readDoc();
    if (rs.tool === "select") {
      const selected = getSelectedShape(node, doc);
      const handleHit = selected ? hitSelectedShape(at.world, selected) : null;
      if (selected && handleHit) {
        ensureHold();
        rs.pointIndex = handleHit.index;
        rs.drag = { pointerId: event.pointerId, kind: handleHit.kind, index: handleHit.index, start: at.norm, pts: clonePts(evalShape(selected, keyFrame())), undone: false };
        refresh();
        return;
      }
      const body = hitShapeBody(at.world, doc);
      if (body) {
        ensureHold();
        rs.shapeId = body.id;
        rs.pointIndex = null;
        rs.drag = { pointerId: event.pointerId, kind: "shape", start: at.norm, pts: clonePts(evalShape(body, keyFrame())), undone: false };
      } else {
        rs.shapeId = null;
        rs.pointIndex = null;
      }
      refresh();
      return;
    }
    ensureHold();
    if (rs.tool === "bezier") {
      const draft = rs.draft;
      if (draft?.pts && draft.pts.length >= 3 && dist(at.world, draft.pts[0][0], draft.pts[0][1]) <= HIT_POINT * unit()) {
        finishBezier();
        return;
      }
      const next = draft ?? (rs.draft = { kind: "bezier", pts: [], cursor: null });
      next.pts.push([at.norm[0], at.norm[1], 0, 0, 0, 0]);
      rs.drag = { pointerId: event.pointerId, kind: "draw-handle", index: next.pts.length - 1 };
    } else if (rs.tool === "free") {
      rs.draft = { kind: "free", pts: null, stroke: [at.norm] };
      rs.drag = { pointerId: event.pointerId, kind: "free" };
    } else {
      rs.draft = { kind: rs.tool, a: at.norm, pts: null };
      rs.drag = { pointerId: event.pointerId, kind: "shape-draw" };
    }
    refresh();
  }, listenerOptions);
  const shapeFromDrag = (draft, cur, shift) => {
    const g = geometry();
    const a = draft.a;
    let [x1, y1] = cur;
    if (shift) {
      const dx = (x1 - a[0]) * g.sourceWidth;
      const dy = (y1 - a[1]) * g.sourceHeight;
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      x1 = a[0] + Math.sign(dx || 1) * size / g.sourceWidth;
      y1 = a[1] + Math.sign(dy || 1) * size / g.sourceHeight;
    }
    const [x0, y0] = a;
    return draft.kind === "ellipse" ? ellipsePoints((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2) : rectPoints(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
  };
  canvas.addEventListener("pointermove", (event) => {
    const at = normalized(event);
    if (!at) return;
    const drag = rs.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      if (rs.draft?.kind === "bezier") {
        rs.draft.cursor = at.norm;
        refresh();
      } else if (rs.tool === "select") {
        const doc = readDoc();
        const selected = getSelectedShape(node, doc);
        const overHandle = selected && hitSelectedShape(at.world, selected);
        canvas.style.cursor = overHandle ? "grab" : hitShapeBody(at.world, doc) ? "move" : "default";
      }
      return;
    }
    event.preventDefault();
    const dx = at.norm[0] - (drag.start?.[0] ?? 0);
    const dy = at.norm[1] - (drag.start?.[1] ?? 0);
    if (drag.kind === "draw-handle") {
      const pt = rs.draft.pts[drag.index];
      pt[4] = at.norm[0] - pt[0];
      pt[5] = at.norm[1] - pt[1];
      pt[2] = -pt[4];
      pt[3] = -pt[5];
      refresh();
    } else if (drag.kind === "free") {
      const stroke = rs.draft.stroke;
      const last = stroke[stroke.length - 1];
      if (Math.hypot(at.norm[0] - last[0], at.norm[1] - last[1]) > 2e-3) stroke.push(at.norm);
      refresh();
    } else if (drag.kind === "shape-draw") {
      rs.draft.pts = shapeFromDrag(rs.draft, at.norm, event.shiftKey);
      refresh();
    } else {
      if (!drag.undone) {
        pushUndo();
        drag.undone = true;
      }
      const doc = readDoc();
      const shape = getSelectedShape(node, doc);
      if (!shape || !drag.pts) return;
      const pts = clonePts(drag.pts);
      const index = drag.index ?? 0;
      if (drag.kind === "shape") {
        for (const p of pts) {
          p[0] += dx;
          p[1] += dy;
        }
      } else if (drag.kind === "point") {
        pts[index][0] = drag.pts[index][0] + dx;
        pts[index][1] = drag.pts[index][1] + dy;
      } else {
        const p = pts[index];
        const anchor = drag.pts[index];
        const own = drag.kind === "out" ? 4 : 2;
        const other = drag.kind === "out" ? 2 : 4;
        p[own] = anchor[own] + dx;
        p[own + 1] = anchor[own + 1] + dy;
        if (!event.altKey) {
          p[other] = -p[own];
          p[other + 1] = -p[own + 1];
        }
      }
      setPointsAtFrame(shape, keyFrame(), pts);
      write(doc);
    }
  }, listenerOptions);
  const endDrag = (event) => {
    const drag = rs.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    rs.drag = null;
    try {
      canvas.releasePointerCapture?.(event.pointerId);
    } catch {
    }
    if (drag.kind === "free") {
      const stroke = rs.draft?.stroke ?? [];
      rs.draft = null;
      const g = geometry();
      const pts = stroke.length >= 3 && g ? freehandToPoints(stroke, g.sourceWidth, g.sourceHeight) : [];
      if (pts.length >= 3) {
        addShape(pts, "Freehand");
        setTool("select");
      } else {
        refresh();
      }
    } else if (drag.kind === "shape-draw") {
      const draft = rs.draft;
      rs.draft = null;
      const box = draft?.pts;
      const span = (axis) => box ? Math.max(...box.map((p) => p[axis])) - Math.min(...box.map((p) => p[axis])) : 0;
      if (draft && box && span(0) > MIN_DRAG && span(1) > MIN_DRAG) {
        addShape(box, draft.kind === "ellipse" ? "Ellipse" : "Rect");
        setTool("select");
      } else {
        refresh();
      }
    } else if (drag.kind === "draw-handle") {
      refresh();
    } else {
      if (drag.kind === "point") rs.pointIndex = drag.index ?? null;
      refresh();
    }
  };
  canvas.addEventListener("pointerup", endDrag, listenerOptions);
  canvas.addEventListener("pointercancel", endDrag, listenerOptions);
  canvas.addEventListener("dblclick", (event) => {
    const g = geometry();
    if (rs.tool !== "select" || !g) return;
    const at = normalized(event);
    const doc = readDoc();
    const shape = getSelectedShape(node, doc);
    if (!at || !shape) return;
    event.preventDefault();
    event.stopPropagation();
    const pts = evalShape(shape, keyFrame());
    const near = nearestOnPath(pts, shape.closed, g.fitDrawWidth, g.fitDrawHeight, at.world.x - g.fitDx, at.world.y - g.fitDy);
    if (!near || near.dist > HIT_PATH * unit()) return;
    ensureHold();
    rs.pointIndex = insertPoint(shape, near.segment, near.t);
    commit(doc);
  }, listenerOptions);
  const deletePoint = () => {
    editSelected((shape, doc) => {
      const minimum = shape.closed ? 3 : 2;
      if (shape.keys[0].pts.length <= minimum) {
        doc.shapes = doc.shapes.filter((s) => s !== shape);
        rs.shapeId = null;
      } else if (rs.pointIndex != null) {
        removePoint(shape, rs.pointIndex);
      }
      rs.pointIndex = null;
    });
  };
  const setPointMode = (smooth) => {
    const index = rs.pointIndex;
    if (index == null) return;
    ensureHold();
    editSelected((shape) => {
      const pts = clonePts(evalShape(shape, keyFrame()));
      if (smooth) autoHandles(pts, index, shape.closed);
      else cornerHandles(pts, index);
      setPointsAtFrame(shape, keyFrame(), pts);
    });
  };
  const setKey = () => {
    ensureHold();
    editSelected((shape) => {
      addKey(shape, keyFrame());
    });
  };
  const jumpKey = (direction) => {
    const shape = getSelectedShape(node, readDoc());
    if (!shape) return;
    const target = adjacentKeyFrame(shape, keyFrame(), direction);
    if (target != null) setHold(target - Math.round(widgetNumber(node, "frame_offset", 0)));
  };
  const tools = { v: "select", b: "bezier", e: "ellipse", r: "rect", f: "free" };
  canvas.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if ((event.ctrlKey || event.metaKey) && (key === "z" || key === "y")) {
      handled();
      if (key === "y" || event.shiftKey) restore(rs.redo, rs.undo);
      else restore(rs.undo, rs.redo);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (key === "delete" || key === "backspace") {
      handled();
      if (rs.draft?.kind === "bezier" && rs.draft.pts) {
        rs.draft.pts.pop();
        if (rs.draft.pts.length === 0) rs.draft = null;
        refresh();
      } else if (rs.pointIndex != null) {
        deletePoint();
      } else if (rs.shapeId) {
        deleteSelectedShape();
      }
    } else if (key === "enter" && rs.draft?.kind === "bezier") {
      handled();
      finishBezier();
    } else if (key === "escape") {
      handled();
      if (rs.draft) {
        rs.draft = null;
        refresh();
      } else {
        select(null);
      }
    } else if (tools[key]) {
      handled();
      setTool(tools[key]);
    } else if (key === "k") {
      handled();
      setKey();
    } else if (key === "s") {
      handled();
      setPointMode(true);
    } else if (key === "c") {
      handled();
      setPointMode(false);
    }
  }, listenerOptions);
  for (const [id, button] of Object.entries(ui.toolButtons)) button.addEventListener("click", () => setTool(id), listenerOptions);
  ui.shapeSelect.addEventListener("change", () => select(ui.shapeSelect.value || null), listenerOptions);
  ui.opSelect.addEventListener("change", () => editSelected((shape) => {
    shape.op = ui.opSelect.value;
  }), listenerOptions);
  ui.visibleButton.addEventListener("click", () => editSelected((shape) => {
    shape.visible = !shape.visible;
  }), listenerOptions);
  const moveShape = (delta) => editSelected((shape, doc) => {
    const from = doc.shapes.indexOf(shape);
    const to = from + delta;
    if (to < 0 || to >= doc.shapes.length) return;
    doc.shapes.splice(from, 1);
    doc.shapes.splice(to, 0, shape);
  });
  ui.upButton.addEventListener("click", () => moveShape(1), listenerOptions);
  ui.downButton.addEventListener("click", () => moveShape(-1), listenerOptions);
  ui.deleteShapeButton.addEventListener("click", deleteSelectedShape, listenerOptions);
  const bindParam = (inputs, apply) => {
    let gesture = false;
    for (const input of inputs) {
      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        const doc = readDoc();
        const shape = getSelectedShape(node, doc);
        if (!shape) return;
        if (!gesture) {
          pushUndo();
          gesture = true;
        }
        apply(shape, value);
        write(doc);
      }, listenerOptions);
      input.addEventListener("change", () => {
        gesture = false;
      }, listenerOptions);
    }
  };
  bindParam([ui.featherRange, ui.featherNumber], (shape, value) => {
    shape.feather = Math.max(0, value);
  });
  bindParam([ui.opacityRange, ui.opacityNumber], (shape, value) => {
    shape.opacity = Math.min(1, Math.max(0, value));
  });
  for (const input of [ui.frameRange, ui.frameNumber]) {
    input.addEventListener("input", () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) setHold(value);
    }, listenerOptions);
  }
  ui.holdButton.addEventListener("click", () => rs.hold == null ? ensureHold() : setHold(null), listenerOptions);
  ui.setKeyButton.addEventListener("click", setKey, listenerOptions);
  ui.delKeyButton.addEventListener("click", () => editSelected((shape) => {
    removeKey(shape, keyFrame());
  }), listenerOptions);
  ui.prevKeyButton.addEventListener("click", () => jumpKey(-1), listenerOptions);
  ui.nextKeyButton.addEventListener("click", () => jumpKey(1), listenerOptions);
  ui.smoothButton.addEventListener("click", () => setPointMode(true), listenerOptions);
  ui.cornerButton.addEventListener("click", () => setPointMode(false), listenerOptions);
  ui.undoButton.addEventListener("click", () => restore(rs.undo, rs.redo), listenerOptions);
  ui.redoButton.addEventListener("click", () => restore(rs.redo, rs.undo), listenerOptions);
  syncRotoControls(node, frameCount());
}
export {
  attachInteractions
};
