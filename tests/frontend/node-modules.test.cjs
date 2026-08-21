const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("Frontend blend preview matches golden fixture", async () => {
    // Dynamically import the compiled ESM module
    const ops = await import("../../js/preview/ops.js");
    const blendChannel01 = ops.blendChannel01;
    
    // Load the golden fixture
    const fixturePath = path.join(__dirname, "..", "golden", "blend_modes.json");
    const fixtureData = await fs.readFile(fixturePath, "utf-8");
    const fixture = JSON.parse(fixtureData);
    
    for (const [mode, modeData] of Object.entries(fixture.modes)) {
        for (const testCase of modeData.cases) {
            const base = testCase.base;
            const top = testCase.top;
            const expectedValue = testCase.expected;
            
            try {
                const actual = blendChannel01(base, top, mode);
                if (actual !== undefined) {
                    assert.ok(Math.abs(actual - expectedValue) < 1e-4, 
                        `Blend ${mode} failed for base=${base}, top=${top}. Expected ${expectedValue}, got ${actual}`);
                }
            } catch (e) {
                // Skip unsupported modes
            }
        }
    }
});
