const KAPPA = 0.5522847498;
const OPS = ["add", "subtract", "intersect"];
let cachedText = null;
let cachedDoc = null;
function emptyDoc() {
  return { v: 1, shapes: [] };
}
function parseDoc(text) {
  if (text === cachedText && cachedDoc) return cachedDoc;
  let doc = emptyDoc();
  try {
    const data = text ? JSON.parse(text) : null;
    if (data && Array.isArray(data.shapes)) {
      doc = { v: 1, shapes: data.shapes.filter((s) => Array.isArray(s?.keys) && s.keys.length > 0).map(normalizeShape) };
    }
  } catch {
  }
  cachedText = text;
  cachedDoc = doc;
  return doc;
}
function normalizeShape(raw) {
  const keys = raw.keys.map((k) => ({ f: Number(k.f) || 0, pts: (k.pts ?? []).map((p) => p.slice(0, 6).map(Number)) })).sort((a, b) => a.f - b.f);
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    closed: raw.closed !== false,
    op: OPS.includes(raw.op) ? raw.op : "add",
    feather: Math.max(0, Number(raw.feather) || 0),
    opacity: Math.min(1, Math.max(0, raw.opacity == null ? 1 : Number(raw.opacity))),
    visible: raw.visible !== false,
    keys
  };
}
function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}
function serializeDoc(doc) {
  const text = JSON.stringify(doc, (_key, value) => typeof value === "number" ? Math.round(value * 1e5) / 1e5 : value);
  cachedText = text;
  cachedDoc = JSON.parse(text);
  return text;
}
function nextShapeId(doc) {
  let n = doc.shapes.length + 1;
  const used = new Set(doc.shapes.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}
function makeShape(doc, pts, closed = true, label = "Shape") {
  const id = nextShapeId(doc);
  return { id, name: `${label} ${id.slice(1)}`, closed, op: "add", feather: 0, opacity: 1, visible: true, keys: [{ f: 0, pts }] };
}
function ellipsePoints(cx, cy, rx, ry) {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return [
    [cx, cy - ry, -kx, 0, kx, 0],
    [cx + rx, cy, 0, -ky, 0, ky],
    [cx, cy + ry, kx, 0, -kx, 0],
    [cx - rx, cy, 0, ky, 0, -ky]
  ];
}
function rectPoints(x0, y0, x1, y1) {
  return [[x0, y0, 0, 0, 0, 0], [x1, y0, 0, 0, 0, 0], [x1, y1, 0, 0, 0, 0], [x0, y1, 0, 0, 0, 0]];
}
function evalShape(shape, frame) {
  const keys = shape.keys;
  if (keys.length === 1 || frame <= keys[0].f) return keys[0].pts;
  const last = keys[keys.length - 1];
  if (frame >= last.f) return last.pts;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame >= a.f && frame <= b.f) {
      if (a.pts.length !== b.pts.length) return a.pts;
      const t = (frame - a.f) / (b.f - a.f);
      return a.pts.map((p, j) => p.map((v, k) => v + (b.pts[j][k] - v) * t));
    }
  }
  return last.pts;
}
function keyIndexAt(shape, frame) {
  return shape.keys.findIndex((k) => k.f === frame);
}
function isAnimated(shape) {
  return shape.keys.length > 1;
}
function setPointsAtFrame(shape, frame, pts) {
  if (shape.keys.length <= 1) {
    shape.keys = [{ f: shape.keys[0]?.f ?? 0, pts }];
    return;
  }
  const index = keyIndexAt(shape, frame);
  if (index >= 0) {
    shape.keys[index].pts = pts;
    return;
  }
  shape.keys.push({ f: frame, pts });
  shape.keys.sort((a, b) => a.f - b.f);
}
function addKey(shape, frame) {
  if (keyIndexAt(shape, frame) >= 0) return false;
  const pts = evalShape(shape, frame).map((p) => p.slice());
  shape.keys.push({ f: frame, pts });
  shape.keys.sort((a, b) => a.f - b.f);
  return true;
}
function removeKey(shape, frame) {
  const index = keyIndexAt(shape, frame);
  if (index < 0 || shape.keys.length <= 1) return false;
  shape.keys.splice(index, 1);
  return true;
}
function adjacentKeyFrame(shape, frame, direction) {
  const frames = shape.keys.map((k) => k.f);
  if (direction < 0) return frames.filter((f) => f < frame).pop() ?? null;
  return frames.find((f) => f > frame) ?? null;
}
function segmentCount(pts, closed) {
  return closed ? pts.length : pts.length - 1;
}
function segmentPoints(pts, i) {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return [
    [a[0], a[1]],
    [a[0] + a[4], a[1] + a[5]],
    [b[0] + b[2], b[1] + b[3]],
    [b[0], b[1]]
  ];
}
function bezierAt(seg, t) {
  const m = 1 - t;
  return [
    m * m * m * seg[0][0] + 3 * m * m * t * seg[1][0] + 3 * m * t * t * seg[2][0] + t * t * t * seg[3][0],
    m * m * m * seg[0][1] + 3 * m * m * t * seg[1][1] + 3 * m * t * t * seg[2][1] + t * t * t * seg[3][1]
  ];
}
function flatten(pts, closed, width, height) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < segmentCount(pts, closed); i++) {
    const seg = segmentPoints(pts, i).map(([x, y]) => [x * width, y * height]);
    const [p0, p1, p2, p3] = seg;
    const length = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const steps = Math.min(64, Math.max(6, Math.floor(length / 3)));
    for (let s = 0; s < steps; s++) out.push(bezierAt(seg, s / steps));
  }
  if (!closed && n > 0) out.push([pts[n - 1][0] * width, pts[n - 1][1] * height]);
  return out;
}
function lerp2(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function insertPointInPts(pts, segment, t) {
  const [p0, p1, p2, p3] = segmentPoints(pts, segment);
  const a = lerp2(p0, p1, t);
  const b = lerp2(p1, p2, t);
  const c = lerp2(p2, p3, t);
  const d = lerp2(a, b, t);
  const e = lerp2(b, c, t);
  const f = lerp2(d, e, t);
  const next = (segment + 1) % pts.length;
  const out = pts.map((p) => p.slice());
  out[segment][4] = a[0] - p0[0];
  out[segment][5] = a[1] - p0[1];
  out[next][2] = c[0] - p3[0];
  out[next][3] = c[1] - p3[1];
  out.splice(segment + 1, 0, [f[0], f[1], d[0] - f[0], d[1] - f[1], e[0] - f[0], e[1] - f[1]]);
  return out;
}
function insertPoint(shape, segment, t) {
  for (const key of shape.keys) key.pts = insertPointInPts(key.pts, segment, t);
  return segment + 1;
}
function removePoint(shape, index) {
  for (const key of shape.keys) key.pts.splice(index, 1);
}
function autoHandles(pts, i, closed) {
  const n = pts.length;
  const prev = i > 0 || closed ? pts[(i - 1 + n) % n] : pts[i];
  const next = i < n - 1 || closed ? pts[(i + 1) % n] : pts[i];
  const tx = (next[0] - prev[0]) / 6;
  const ty = (next[1] - prev[1]) / 6;
  const p = pts[i];
  p[2] = -tx;
  p[3] = -ty;
  p[4] = tx;
  p[5] = ty;
}
function cornerHandles(pts, i) {
  pts[i][2] = pts[i][3] = pts[i][4] = pts[i][5] = 0;
}
function simplifyPolyline(points, epsilon) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop();
    let worst = 0;
    let worstIndex = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i][0], points[i][1], points[lo], points[hi]).dist;
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex >= 0 && worst > epsilon) {
      keep[worstIndex] = true;
      stack.push([lo, worstIndex], [worstIndex, hi]);
    }
  }
  return points.filter((_p, i) => keep[i]);
}
function freehandToPoints(stroke, width, height) {
  const px = stroke.map(([x, y]) => [x * width, y * height]);
  const epsilon = Math.max(1.5, Math.max(width, height) * 4e-3);
  const simple = simplifyPolyline(px, epsilon);
  if (simple.length > 2 && Math.hypot(simple[0][0] - simple[simple.length - 1][0], simple[0][1] - simple[simple.length - 1][1]) < epsilon * 3) simple.pop();
  const pts = simple.map(([x, y]) => [x / width, y / height, 0, 0, 0, 0]);
  for (let i = 0; i < pts.length; i++) autoHandles(pts, i, true);
  return pts;
}
function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
  return { dist: Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t)), t };
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearestOnPath(pts, closed, width, height, x, y) {
  let best = null;
  for (let i = 0; i < segmentCount(pts, closed); i++) {
    const seg = segmentPoints(pts, i).map(([sx, sy]) => [sx * width, sy * height]);
    const steps = 24;
    let prev = seg[0];
    for (let s = 1; s <= steps; s++) {
      const cur = bezierAt(seg, s / steps);
      const hit = distToSegment(x, y, prev, cur);
      if (!best || hit.dist < best.dist) best = { segment: i, t: (s - 1 + hit.t) / steps, dist: hit.dist };
      prev = cur;
    }
  }
  return best;
}
export {
  KAPPA,
  OPS,
  addKey,
  adjacentKeyFrame,
  autoHandles,
  cloneDoc,
  cornerHandles,
  distToSegment,
  ellipsePoints,
  emptyDoc,
  evalShape,
  flatten,
  freehandToPoints,
  insertPoint,
  isAnimated,
  keyIndexAt,
  makeShape,
  nearestOnPath,
  parseDoc,
  pointInPolygon,
  rectPoints,
  removeKey,
  removePoint,
  segmentCount,
  serializeDoc,
  setPointsAtFrame
};
