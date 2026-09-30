const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createCanvas, Canvas } = require("@napi-rs/canvas");

// applyTransform/makeCanvas need a DOM canvas; @napi-rs/canvas provides one
// without requiring a real browser. Only shimmed for the duration of this file.
globalThis.HTMLCanvasElement = Canvas;
if (typeof globalThis.document === "undefined") globalThis.document = {};
globalThis.document.createElement = (tag) => {
    if (tag !== "canvas") throw new Error(`unsupported tag: ${tag}`);
    return createCanvas(1, 1);
};

test("Frontend applyTransform matches the backend _transform_batch_affine golden fixture", async () => {
    const { applyTransform } = await import("../../js/preview/ops/geometry/transform.js");
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "..", "golden", "transform.json"), "utf-8"));
    const { width, height, tolerance_abs_255: tolerance, border_margin: margin } = fixture._meta;
    const { translate_x, translate_y, rotate_deg, scale, filter_mode, fill_mode, fill_color, expand } = fixture.params;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b, a] = fixture.input_rgba[y][x];
            const offset = (y * width + x) * 4;
            image.data[offset] = r;
            image.data[offset + 1] = g;
            image.data[offset + 2] = b;
            image.data[offset + 3] = a;
        }
    }
    ctx.putImageData(image, 0, 0);

    const result = applyTransform(ctx, width, height, translate_x, translate_y, rotate_deg, scale, filter_mode, expand, fill_mode, fill_color);
    const resultCtx = (result ?? canvas).getContext("2d");
    const actual = resultCtx.getImageData(0, 0, width, height).data;

    let maxDiff = 0;
    let worst = null;
    // The fixture's params zoom in deliberately so every sample stays inside the
    // source bounds (see tests/golden/transform.json's _meta.description) — this
    // isolates the core rotate/scale bilinear sampling math from a separate, real
    // gap at frame edges where content maps outside the source (torch's
    // grid_sample blends smoothly into zero-padding there; the frontend's
    // per-pixel sampler does a hard inside/outside cutoff instead).
    for (let y = margin; y < height - margin; y++) {
        for (let x = margin; x < width - margin; x++) {
            const [er, eg, eb, ea] = fixture.expected_rgba[y][x];
            const offset = (y * width + x) * 4;
            for (const [channel, expected] of [[0, er], [1, eg], [2, eb], [3, ea]]) {
                const diff = Math.abs(actual[offset + channel] - expected);
                if (diff > maxDiff) {
                    maxDiff = diff;
                    worst = { x, y, channel, expected, actual: actual[offset + channel] };
                }
            }
        }
    }

    assert.ok(
        maxDiff <= tolerance,
        `applyTransform diverges from the backend by ${maxDiff} (tolerance ${tolerance}) at ${JSON.stringify(worst)}`,
    );
});
