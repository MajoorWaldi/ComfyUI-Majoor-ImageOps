const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createCanvas, Canvas } = require("@napi-rs/canvas");

// applySpherize/makeCanvas need a DOM canvas; @napi-rs/canvas provides one without
// requiring a real browser. Only shimmed for the duration of this test file.
globalThis.HTMLCanvasElement = Canvas;
if (typeof globalThis.document === "undefined") globalThis.document = {};
globalThis.document.createElement = (tag) => {
    if (tag !== "canvas") throw new Error(`unsupported tag: ${tag}`);
    return createCanvas(1, 1);
};

test("Frontend applySpherize matches the backend _spherize_frame golden fixture", async () => {
    const { applySpherize } = await import("../../js/preview/ops/geometry/spherize.js");
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, "..", "golden", "spherize.json"), "utf-8"));
    const { width, height, tolerance_abs_255: tolerance } = fixture._meta;
    const { mode, strength, invert } = fixture.params;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    const image = ctx.createImageData(width, height);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [r, g, b] = fixture.input_rgb[y][x];
            const offset = (y * width + x) * 4;
            image.data[offset] = r;
            image.data[offset + 1] = g;
            image.data[offset + 2] = b;
            image.data[offset + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);

    applySpherize(ctx, width, height, mode, strength, invert);

    const actual = ctx.getImageData(0, 0, width, height).data;
    let maxDiff = 0;
    let worst = null;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const [er, eg, eb] = fixture.expected_rgb[y][x];
            const offset = (y * width + x) * 4;
            for (const [channel, expected] of [[0, er], [1, eg], [2, eb]]) {
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
        `applySpherize diverges from the backend by ${maxDiff} (tolerance ${tolerance}) at ${JSON.stringify(worst)}`,
    );
});
