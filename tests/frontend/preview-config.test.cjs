const test = require("node:test");
const assert = require("node:assert/strict");

test("preview config prefers settings, then legacy localStorage, then defaults", async () => {
    const stored = new Map();
    globalThis.localStorage = { getItem: (key) => (stored.has(key) ? stored.get(key) : null) };
    const { getPreviewConfig, setPreviewSettingReader } = await import("../../js/preview/config.js");
    const { PREVIEW_DEFAULTS, PREVIEW_SETTING_IDS } = await import("../../js/preview/shared/preview-defaults.js");

    setPreviewSettingReader(() => undefined);
    assert.equal(getPreviewConfig().canvasSize, PREVIEW_DEFAULTS.canvasSize);

    stored.set("imageops.preview.canvasSize", "512");
    setPreviewSettingReader((id) => (id === PREVIEW_SETTING_IDS.canvasSize ? PREVIEW_DEFAULTS.canvasSize : undefined));
    assert.equal(getPreviewConfig().canvasSize, 512, "legacy value applies while the setting is at its default");

    setPreviewSettingReader((id) => (id === PREVIEW_SETTING_IDS.canvasSize ? 768 : undefined));
    assert.equal(getPreviewConfig().canvasSize, 768, "a changed setting wins over the legacy value");

    setPreviewSettingReader((id) => ({
        [PREVIEW_SETTING_IDS.canvasSize]: 800,
        [PREVIEW_SETTING_IDS.playbackCanvasSize]: 1600,
        [PREVIEW_SETTING_IDS.interactionCanvasSize]: 4000,
        [PREVIEW_SETTING_IDS.debounceMs]: 50,
    })[id]);
    const cfg = getPreviewConfig();
    assert.equal(cfg.playbackCanvasSize, 800, "playback size is capped by the idle size");
    assert.equal(cfg.interactionCanvasSize, 800, "interaction size is capped by the playback size");
    assert.equal(cfg.debounceMs, 50);
    assert.equal(cfg.maxGraphNodes, PREVIEW_DEFAULTS.maxGraphNodes);
});
