const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const load = () => import(pathToFileURL(path.join(__dirname, "..", "..", "js", "preview", "shared", "roto-shapes.js")).href);

// The same document and expected values are asserted in tests/unit/test_roto.py
// (test_js_parity_anchor) so the preview and the backend interpolate identically.
test("keyframe interpolation and flattening match the backend anchor", async () => {
  const m = await load();
  const shape = {
    id: "s1",
    closed: true,
    keys: [
      { f: 0, pts: m.ellipsePoints(0.4, 0.5, 0.2, 0.3) },
      { f: 10, pts: m.ellipsePoints(0.6, 0.4, 0.25, 0.2) },
    ],
  };
  const parsed = m.parseDoc(m.serializeDoc({ v: 1, shapes: [shape] }));
  const poly = m.flatten(m.evalShape(parsed.shapes[0], 4), true, 200, 100);
  assert.equal(poly.length, 80);
  assert.deepEqual(poly[0].map((v) => Math.round(v * 1e4) / 1e4), [96, 20]);
  assert.deepEqual(poly[poly.length - 1].map((v) => Math.round(v * 1e4) / 1e4), [92.3913, 20.0862]);
});

test("structural edits apply to every keyframe", async () => {
  const m = await load();
  const doc = m.cloneDoc(m.parseDoc(JSON.stringify({
    shapes: [{ id: "s1", keys: [{ f: 0, pts: m.rectPoints(0, 0, 1, 1) }, { f: 5, pts: m.rectPoints(0, 0, 0.5, 0.5) }] }],
  })));
  const shape = doc.shapes[0];
  m.insertPoint(shape, 0, 0.5);
  assert.deepEqual(shape.keys.map((k) => k.pts.length), [5, 5]);
  assert.deepEqual(shape.keys[0].pts[1].slice(0, 2), [0.5, 0]);
  m.removePoint(shape, 1);
  assert.deepEqual(shape.keys.map((k) => k.pts.length), [4, 4]);
});

test("freehand strokes become a smooth closed shape", async () => {
  const m = await load();
  const stroke = Array.from({ length: 60 }, (_, i) => [0.5 + 0.3 * Math.cos((i / 60) * 2 * Math.PI), 0.5 + 0.3 * Math.sin((i / 60) * 2 * Math.PI)]);
  const pts = m.freehandToPoints(stroke, 1000, 800);
  assert.ok(pts.length >= 4 && pts.length < stroke.length);
  assert.ok(pts.some((p) => p[4] !== 0 || p[5] !== 0));
});
