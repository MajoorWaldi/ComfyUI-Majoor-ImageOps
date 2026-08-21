const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("Frontend blend preview matches golden fixture", async () => {
    // Import the pure blend module so the test does not depend on ComfyUI's
    // browser-only app module.
    const { blendChannel01 } = await import("../../js/preview/shared/blend-modes.js");
    
    // Load the golden fixture
    const fixturePath = path.join(__dirname, "..", "golden", "blend_modes.json");
    const fixtureData = await fs.readFile(fixturePath, "utf-8");
    const fixture = JSON.parse(fixtureData);
    
    for (const [mode, modeData] of Object.entries(fixture.modes)) {
        for (const testCase of modeData.cases) {
            const base = testCase.base;
            const top = testCase.top;
            const expectedValue = testCase.expected;
            
            const actual = blendChannel01(base, top, mode);
            assert.ok(Number.isFinite(actual), `Blend ${mode} must return a finite value`);
            assert.ok(Math.abs(actual - expectedValue) < 1e-4,
                `Blend ${mode} failed for base=${base}, top=${top}. Expected ${expectedValue}, got ${actual}`);
        }
    }
});
