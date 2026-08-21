const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

test("all manifest nodes are enabled for frontend previews", async () => {
  const root = path.join(__dirname, "..", "..");
  const manifest = JSON.parse(await fs.readFile(path.join(root, "imageops_nodes.json"), "utf8"));
  const classes = await import("../../js/preview/shared/classes.js");

  const expected = manifest.nodes.map((node) => node.className);
  assert.equal(expected.length, 26, "the canonical manifest must contain all 26 ImageOps nodes");
  assert.deepEqual([...classes.IMAGEOPS_CLASSES], expected);

  const custom = manifest.nodes.filter((node) => node.ui === "custom").map((node) => node.className);
  const native = manifest.nodes.filter((node) => node.ui === "native").map((node) => node.className);
  assert.deepEqual([...classes.IMAGEOPS_CUSTOM_UI_CLASSES], custom);
  assert.deepEqual([...classes.IMAGEOPS_NATIVE_UI_CLASSES], native);
});

test("the previews removed by the vNext regression remain routed", async () => {
  const root = path.join(__dirname, "..", "..");
  const adapter = await fs.readFile(path.join(root, "src", "preview", "adapters", "imageops.ts"), "utf8");
  const host = await fs.readFile(path.join(root, "src", "preview", "host.ts"), "utf8");

  for (const className of [
    "ImageOpsCameraShake",
    "ImageOpsConstant",
    "ImageOpsCropStitch",
    "ImageOpsFrameRange",
    "ImageOpsGrain",
    "ImageOpsAppend",
    "ImageOpsKeyer",
    "ImageOpsRamp",
    "ImageOpsText",
  ]) {
    assert.match(adapter, new RegExp(`\\b${className}\\b`), `${className} must have an adapter route`);
  }

  assert.match(host, /isImageOpsClass\(node\.comfyClass\)/, "host hooks must use generated ImageOps metadata");
});
