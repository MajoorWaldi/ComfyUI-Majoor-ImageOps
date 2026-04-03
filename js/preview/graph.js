const MAX_RECURSION = 64;
const DEFAULT_INPUT_SCAN = 4;
const IMAGE_EXTS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]);
const VIDEO_EXTS = /* @__PURE__ */ new Set(["mp4", "mov", "webm", "mkv", "avi", "m4v", "flv", "wmv", "mpg", "mpeg"]);
const MAYBE_ANIMATED_IMAGE_EXTS = /* @__PURE__ */ new Set(["gif"]);
function getInputLink(node, inputIndex = 0) {
  try {
    return node?.getInputLink?.(inputIndex) ?? null;
  } catch {
    return null;
  }
}
function getInputCount(node, fallback = DEFAULT_INPUT_SCAN) {
  const count = Array.isArray(node?.inputs) ? node.inputs.length : 0;
  return count > 0 ? count : fallback;
}
function getUpstreamNode(node, inputIndex = 0) {
  const link = getInputLink(node, inputIndex);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  if (originId == null) return null;
  return node?.graph?.getNodeById?.(originId) ?? null;
}
function getUpstreamNodes(node) {
  const out = [];
  for (let i = 0; i < getInputCount(node); i++) {
    const upstream = getUpstreamNode(node, i);
    if (upstream) out.push(upstream);
  }
  return out;
}
function isGraphTooLarge(graph, maxNodes = 140) {
  const nodes = graph?._nodes ?? [];
  return nodes.length > maxNodes;
}
function detectSource(node) {
  function getFileExtLower(s) {
    const m = String(s ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
    return m ? m[1] : "";
  }
  function looksLikeMediaValue(v) {
    if (v == null) return false;
    if (typeof v !== "string") return false;
    const ext2 = getFileExtLower(v);
    return IMAGE_EXTS.has(ext2) || VIDEO_EXTS.has(ext2);
  }
  function pickMediaWidget(n) {
    const preferred = ["image", "video", "path", "filepath", "file", "filename", "input_video", "input_image"];
    for (const name of preferred) {
      const w2 = n?.widgets?.find((x) => x?.name === name);
      if (w2 && looksLikeMediaValue(w2.value)) return w2;
    }
    for (const w2 of n?.widgets ?? []) {
      if (looksLikeMediaValue(w2?.value)) return w2;
    }
    return null;
  }
  const w = pickMediaWidget(node);
  if (!w) return null;
  const ext = getFileExtLower(w.value);
  const kind = VIDEO_EXTS.has(ext) ? "video" : "image";
  return { kind, value: w.value, animated: kind === "image" && MAYBE_ANIMATED_IMAGE_EXTS.has(ext) };
}
function detectSourceUpstream(node, maxHops = MAX_RECURSION) {
  const queue = [node];
  const seen = /* @__PURE__ */ new Set();
  let best = null;
  let steps = 0;
  let head = 0;
  while (head < queue.length && steps < maxHops && queue.length < 4096) {
    const cur = queue[head++];
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;
    const source = detectSource(cur);
    if (source?.kind === "video") return source;
    if (source?.animated) best = source;
    else if (!best && source) best = source;
    for (const upstream of getUpstreamNodes(cur)) {
      queue.push(upstream);
    }
  }
  return best;
}
function findDependents(changedNode, predicate) {
  const g = changedNode?.graph;
  const nodes = g?._nodes ?? [];
  const out = [];
  for (const n of nodes) {
    if (!n || !predicate(n)) continue;
    if (isUpstreamOf(changedNode, n)) out.push(n);
  }
  return out;
}
function isUpstreamOf(candidate, node, max = MAX_RECURSION) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [node];
  let steps = 0;
  while (stack.length && steps < max) {
    const cur = stack.pop();
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;
    if (cur.id === candidate.id) return true;
    for (let i = 0; i < getInputCount(cur); i++) {
      const up = getUpstreamNode(cur, i);
      if (up) stack.push(up);
    }
  }
  return false;
}
export {
  detectSource,
  detectSourceUpstream,
  findDependents,
  getInputCount,
  getInputLink,
  getUpstreamNode,
  getUpstreamNodes,
  isGraphTooLarge
};
