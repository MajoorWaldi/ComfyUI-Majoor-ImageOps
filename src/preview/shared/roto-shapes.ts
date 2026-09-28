// Roto shape document: bezier point lists in normalised image coordinates.
// A point is [x, y, inDx, inDy, outDx, outDy]; handle offsets are relative to the point.
// Keyframe evaluation and flattening mirror nodes/core/roto.py.

export type RotoPoint = number[];
export type RotoOp = "add" | "subtract" | "intersect";

export interface RotoKey {
  f: number;
  pts: RotoPoint[];
}

export interface RotoShape {
  id: string;
  name: string;
  closed: boolean;
  op: RotoOp;
  feather: number;
  opacity: number;
  visible: boolean;
  keys: RotoKey[];
}

export interface RotoDoc {
  v: number;
  shapes: RotoShape[];
}

export const KAPPA = 0.5522847498;
export const OPS: RotoOp[] = ["add", "subtract", "intersect"];

let cachedText: string | null = null;
let cachedDoc: RotoDoc | null = null;

export function emptyDoc(): RotoDoc {
  return { v: 1, shapes: [] };
}

export function parseDoc(text: string): RotoDoc {
  if (text === cachedText && cachedDoc) return cachedDoc;
  let doc = emptyDoc();
  try {
    const data = text ? JSON.parse(text) : null;
    if (data && Array.isArray(data.shapes)) {
      doc = { v: 1, shapes: data.shapes.filter((s: any) => Array.isArray(s?.keys) && s.keys.length > 0).map(normalizeShape) };
    }
  } catch { /* invalid JSON falls back to an empty document */ }
  cachedText = text;
  cachedDoc = doc;
  return doc;
}

function normalizeShape(raw: any): RotoShape {
  const keys: RotoKey[] = raw.keys
    .map((k: any) => ({ f: Number(k.f) || 0, pts: (k.pts ?? []).map((p: number[]) => p.slice(0, 6).map(Number)) }))
    .sort((a: RotoKey, b: RotoKey) => a.f - b.f);
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    closed: raw.closed !== false,
    op: OPS.includes(raw.op) ? raw.op : "add",
    feather: Math.max(0, Number(raw.feather) || 0),
    opacity: Math.min(1, Math.max(0, raw.opacity == null ? 1 : Number(raw.opacity))),
    visible: raw.visible !== false,
    keys,
  };
}

export function cloneDoc(doc: RotoDoc): RotoDoc {
  return JSON.parse(JSON.stringify(doc));
}

export function serializeDoc(doc: RotoDoc): string {
  const text = JSON.stringify(doc, (_key, value) => typeof value === "number" ? Math.round(value * 1e5) / 1e5 : value);
  cachedText = text;
  cachedDoc = JSON.parse(text);
  return text;
}

function nextShapeId(doc: RotoDoc): string {
  let n = doc.shapes.length + 1;
  const used = new Set(doc.shapes.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

export function makeShape(doc: RotoDoc, pts: RotoPoint[], closed = true, label = "Shape"): RotoShape {
  const id = nextShapeId(doc);
  return { id, name: `${label} ${id.slice(1)}`, closed, op: "add", feather: 0, opacity: 1, visible: true, keys: [{ f: 0, pts }] };
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number): RotoPoint[] {
  const kx = KAPPA * rx;
  const ky = KAPPA * ry;
  return [
    [cx, cy - ry, -kx, 0, kx, 0],
    [cx + rx, cy, 0, -ky, 0, ky],
    [cx, cy + ry, kx, 0, -kx, 0],
    [cx - rx, cy, 0, ky, 0, -ky],
  ];
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number): RotoPoint[] {
  return [[x0, y0, 0, 0, 0, 0], [x1, y0, 0, 0, 0, 0], [x1, y1, 0, 0, 0, 0], [x0, y1, 0, 0, 0, 0]];
}

export function evalShape(shape: RotoShape, frame: number): RotoPoint[] {
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

export function keyIndexAt(shape: RotoShape, frame: number): number {
  return shape.keys.findIndex((k) => k.f === frame);
}

export function isAnimated(shape: RotoShape): boolean {
  return shape.keys.length > 1;
}

export function setPointsAtFrame(shape: RotoShape, frame: number, pts: RotoPoint[]): void {
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

export function addKey(shape: RotoShape, frame: number): boolean {
  if (keyIndexAt(shape, frame) >= 0) return false;
  const pts = evalShape(shape, frame).map((p) => p.slice());
  shape.keys.push({ f: frame, pts });
  shape.keys.sort((a, b) => a.f - b.f);
  return true;
}

export function removeKey(shape: RotoShape, frame: number): boolean {
  const index = keyIndexAt(shape, frame);
  if (index < 0 || shape.keys.length <= 1) return false;
  shape.keys.splice(index, 1);
  return true;
}

export function adjacentKeyFrame(shape: RotoShape, frame: number, direction: number): number | null {
  const frames = shape.keys.map((k) => k.f);
  if (direction < 0) return frames.filter((f) => f < frame).pop() ?? null;
  return frames.find((f) => f > frame) ?? null;
}

export function segmentCount(pts: RotoPoint[], closed: boolean): number {
  return closed ? pts.length : pts.length - 1;
}

function segmentPoints(pts: RotoPoint[], i: number): number[][] {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  return [
    [a[0], a[1]],
    [a[0] + a[4], a[1] + a[5]],
    [b[0] + b[2], b[1] + b[3]],
    [b[0], b[1]],
  ];
}

function bezierAt(seg: number[][], t: number): number[] {
  const m = 1 - t;
  return [
    m * m * m * seg[0][0] + 3 * m * m * t * seg[1][0] + 3 * m * t * t * seg[2][0] + t * t * t * seg[3][0],
    m * m * m * seg[0][1] + 3 * m * m * t * seg[1][1] + 3 * m * t * t * seg[2][1] + t * t * t * seg[3][1],
  ];
}

export function flatten(pts: RotoPoint[], closed: boolean, width: number, height: number): number[][] {
  const out: number[][] = [];
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

function lerp2(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function insertPointInPts(pts: RotoPoint[], segment: number, t: number): RotoPoint[] {
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

// Structural edits apply to every keyframe so the point count stays shared.
export function insertPoint(shape: RotoShape, segment: number, t: number): number {
  for (const key of shape.keys) key.pts = insertPointInPts(key.pts, segment, t);
  return segment + 1;
}

export function removePoint(shape: RotoShape, index: number): void {
  for (const key of shape.keys) key.pts.splice(index, 1);
}

export function autoHandles(pts: RotoPoint[], i: number, closed: boolean): void {
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

export function cornerHandles(pts: RotoPoint[], i: number): void {
  pts[i][2] = pts[i][3] = pts[i][4] = pts[i][5] = 0;
}

function simplifyPolyline(points: number[][], epsilon: number): number[][] {
  if (points.length < 3) return points.slice();
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: number[][] = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
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

// Freehand stroke (normalised) -> smooth closed bezier shape.
export function freehandToPoints(stroke: number[][], width: number, height: number): RotoPoint[] {
  const px = stroke.map(([x, y]) => [x * width, y * height]);
  const epsilon = Math.max(1.5, Math.max(width, height) * 4e-3);
  const simple = simplifyPolyline(px, epsilon);
  if (simple.length > 2 && Math.hypot(simple[0][0] - simple[simple.length - 1][0], simple[0][1] - simple[simple.length - 1][1]) < epsilon * 3) simple.pop();
  const pts: RotoPoint[] = simple.map(([x, y]) => [x / width, y / height, 0, 0, 0, 0]);
  for (let i = 0; i < pts.length; i++) autoHandles(pts, i, true);
  return pts;
}

export function distToSegment(px: number, py: number, a: number[], b: number[]): { dist: number; t: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2)) : 0;
  return { dist: Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t)), t };
}

export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Closest point on the bezier path in pixel space.
export function nearestOnPath(pts: RotoPoint[], closed: boolean, width: number, height: number, x: number, y: number): { segment: number; t: number; dist: number } | null {
  let best: { segment: number; t: number; dist: number } | null = null;
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
