import { getUpstreamNode, getUpstreamNodes } from "../graph.js";
function widgetNumber(node, name, fallback) {
  const value = (node?.widgets ?? []).find((widget) => widget?.name === name)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function getVhsVideoInfo(node) {
  const query = node?.video_query;
  const loaded = query?.loaded;
  const source = query?.source;
  const frames = Number(loaded?.frames ?? source?.frames ?? 0);
  const fps = Number(loaded?.fps ?? source?.fps ?? 0);
  if (!Number.isFinite(frames) || frames <= 0) return null;
  return {
    frames: Math.round(frames),
    fps: Number.isFinite(fps) && fps > 0 ? fps : 0
  };
}
function getNodeVideoTiming(node, options = {}) {
  if (!node) return { frameCount: 0, fps: 0, source: "none" };
  const state = node.__imageops_state;
  const knownFrameCount = Math.round(Number(
    state?.frameSelectorSourceCount ?? state?.joinFrameCount ?? 0
  ));
  if (knownFrameCount > 0) {
    return { frameCount: knownFrameCount, fps: 0, source: "metadata" };
  }
  const videoInfo = getVhsVideoInfo(node);
  if (videoInfo?.frames) {
    const selectEveryNth = Math.max(1, widgetNumber(node, "select_every_nth", 1));
    const capWidget2 = Math.max(0, widgetNumber(node, "frame_load_cap", 0));
    let frameCount = Math.max(1, Math.round(videoInfo.frames / selectEveryNth));
    if (capWidget2 > 0) frameCount = Math.min(frameCount, Math.round(capWidget2));
    return { frameCount, fps: videoInfo.fps, source: "vhs" };
  }
  const videoEl = node.__imageops_media?.videoEl;
  if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
    const forceRate = widgetNumber(node, "force_rate", 0);
    const fps = forceRate > 0 ? forceRate : videoInfo?.fps && videoInfo.fps > 0 ? videoInfo.fps : 24;
    const selectEveryNth = Math.max(1, widgetNumber(node, "select_every_nth", 1));
    const capWidget2 = Math.max(0, widgetNumber(node, "frame_load_cap", 0));
    let frameCount = Math.round(videoEl.duration * fps / selectEveryNth);
    if (capWidget2 > 0) frameCount = Math.min(frameCount, Math.round(capWidget2));
    if (frameCount > 0) return { frameCount, fps, source: "video" };
  }
  const capWidget = Math.max(0, widgetNumber(node, "frame_load_cap", 0));
  if (capWidget > 0) return { frameCount: Math.round(capWidget), fps: 0, source: "cap" };
  const imgs = node.imgs;
  if (Array.isArray(imgs) && (imgs.length > 1 || options.allowSingleImagePreview)) {
    return { frameCount: imgs.length, fps: 0, source: "imgs" };
  }
  return { frameCount: 0, fps: 0, source: "none" };
}
function getUpstreamVideoTiming(node, inputIndex = 0, maxHops = 8) {
  const seen = /* @__PURE__ */ new Set();
  const queue = [];
  const up0 = getUpstreamNode(node, inputIndex);
  if (up0) queue.push(up0);
  let hops = 0;
  while (queue.length > 0 && hops < maxHops) {
    const cur = queue.shift();
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    hops++;
    const info = getNodeVideoTiming(cur, { allowSingleImagePreview: false });
    if (info.frameCount > 0 || info.fps > 0) return info;
    for (const upNode of getUpstreamNodes(cur)) {
      if (!seen.has(upNode.id)) queue.push(upNode);
    }
  }
  return { frameCount: 0, fps: 0, source: "none" };
}
function getUpstreamVideoFps(node, inputIndex = 0) {
  const direct = getNodeVideoTiming(getUpstreamNode(node, inputIndex), { allowSingleImagePreview: false });
  if (direct.fps > 0) return direct.fps;
  return getUpstreamVideoTiming(node, inputIndex).fps;
}
export {
  getNodeVideoTiming,
  getUpstreamVideoFps,
  getUpstreamVideoTiming,
  getVhsVideoInfo
};
