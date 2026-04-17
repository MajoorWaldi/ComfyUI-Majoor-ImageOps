function widgetHasAnimatedValues(value) {
  if (!Array.isArray(value)) return false;
  if (value.length > 1) return true;
  return value.length === 1 ? widgetHasAnimatedValues(value[0]) : false;
}
function widgetAnimatedLength(value) {
  if (!Array.isArray(value)) return 1;
  if (value.length > 1) return value.length;
  return value.length === 1 ? widgetAnimatedLength(value[0]) : 1;
}
function getProceduralFrameCount(node) {
  const cls = String(node?.comfyClass ?? "");
  const animatedLength = Math.max(1, ...(node.widgets ?? []).map((entry) => widgetAnimatedLength(entry?.value)));
  if (cls !== "ImageOpsNoise") {
    return animatedLength > 1 ? animatedLength : null;
  }
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name, fallback = 0) => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const batchSize = Math.max(1, Math.round(numeric("batch_size", 1)));
  const frameLength = Math.max(0, Math.round(numeric("frame_length", 0)));
  const frameCount = frameLength > 0 ? frameLength : batchSize;
  const animSpeed = numeric("animation_speed", 0);
  if (animSpeed !== 0) return 1e6;
  return Math.max(frameCount, animatedLength);
}
function hasProceduralAnimation(node) {
  const cls = String(node?.comfyClass ?? "");
  const animatedWidgets = (node.widgets ?? []).some((entry) => widgetHasAnimatedValues(entry?.value));
  if (cls !== "ImageOpsNoise") return animatedWidgets && (getProceduralFrameCount(node) ?? 1) > 1;
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name, fallback = 0) => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const frameCount = getProceduralFrameCount(node) ?? 1;
  if (frameCount <= 1) return false;
  if (numeric("animation_speed", 0) !== 0) return true;
  if (numeric("seed_step", 0) !== 0) return true;
  if (numeric("frame_offset_x", 0) !== 0) return true;
  if (numeric("frame_offset_y", 0) !== 0) return true;
  if (numeric("frame_offset_z", 0) !== 0) return true;
  return animatedWidgets;
}
function getProceduralPlaybackFps(node) {
  const cls = String(node?.comfyClass ?? "");
  if (cls !== "ImageOpsNoise") return null;
  const widget = (name) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const value = parseFloat(widget("fps")?.value);
  return Number.isFinite(value) ? Math.max(1, value) : 12;
}
export {
  getProceduralFrameCount,
  getProceduralPlaybackFps,
  hasProceduralAnimation,
  widgetAnimatedLength,
  widgetHasAnimatedValues
};
