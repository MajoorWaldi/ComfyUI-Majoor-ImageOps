const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("Frontend curve preview matches the ComfyUI CurveInput golden samples", async () => {
    const { createCurveInterpolator, curveLut8 } = await import("../../js/preview/shared/curve.js");
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "..", "golden", "curve.json"), "utf-8"));
    const tolerance = fixture._meta.tolerance_abs;

    for (const [name, curve] of Object.entries(fixture.curves)) {
        const interp = createCurveInterpolator({ points: curve.points, interpolation: curve.interpolation });
        assert.ok(interp, `${name} must parse`);
        for (const [x, expected] of curve.samples) {
            const actual = interp(x);
            assert.ok(Math.abs(actual - expected) <= tolerance, `${name} at x=${x}: expected ${expected}, got ${actual}`);
        }
    }

    assert.equal(curveLut8({ points: [[0, 0], [1, 1]] }), null, "identity curve must be a no-op");
    assert.equal(curveLut8(null), null);
    const inverted = curveLut8({ points: [[0, 1], [1, 0]], interpolation: "linear" });
    assert.equal(inverted[0], 255);
    assert.equal(inverted[255], 0);
    assert.equal(inverted[128], 127);
});
