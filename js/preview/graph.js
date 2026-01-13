// Graph traversal helpers for ImageOps Live Preview (v6)

const MAX_RECURSION = 64;

export function getInputLink(node, inputIndex = 0) {
  try { return node?.getInputLink?.(inputIndex) ?? null; } catch { return null; }
}

export function getUpstreamNode(node, inputIndex = 0) {
  const link = getInputLink(node, inputIndex);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  if (originId == null) return null;
  return node?.graph?.getNodeById?.(originId) ?? null;
}

export function isGraphTooLarge(graph, maxNodes = 140) {
  const nodes = graph?._nodes ?? [];
  return nodes.length > maxNodes;
}

export function detectSource(node) {
  const IMAGE_EXTS = new Set(["png","jpg","jpeg","webp","bmp","gif","tif","tiff"]);
  const VIDEO_EXTS = new Set(["mp4","mov","webm","mkv","avi","gif","webp"]);

  function getFileExtLower(s) {
    const m = String(s ?? "").toLowerCase().match(/\.([a-z0-9]+)(\s*\[[^\]]+\]\s*)?$/i);
    return m ? m[1] : "";
  }
  function looksLikeMediaValue(v) {
    if (v == null) return false;
    if (typeof v !== "string") return false;
    const ext = getFileExtLower(v);
    return IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext);
  }
  function pickMediaWidget(n) {
    const preferred = ["image","video","path","filepath","file","filename","input_video","input_image"];
    for (const name of preferred) {
      const w = n?.widgets?.find(x => x?.name === name);
      if (w && looksLikeMediaValue(w.value)) return w;
    }
    for (const w of (n?.widgets ?? [])) {
      if (looksLikeMediaValue(w?.value)) return w;
    }
    return null;
  }

  const w = pickMediaWidget(node);
  if (!w) return null;

  const ext = getFileExtLower(w.value);
  const kind = VIDEO_EXTS.has(ext) ? "video" : "image";
  return { kind, value: w.value };
}

export function detectSourceUpstream(node, maxHops = MAX_RECURSION) {
  let cur = node;
  for (let i = 0; i < maxHops && cur; i++) {
    const s = detectSource(cur);
    if (s) return s;
    cur = getUpstreamNode(cur, 0);
  }
  return null;
}

export function findDependents(changedNode, predicate) {
  const g = changedNode?.graph;
  const nodes = g?._nodes ?? [];
  const out = [];
  for (const n of nodes) {
    if (!n || !predicate(n)) continue;
    if (isUpstreamOf(changedNode, n)) out.push(n);
  }
  return out;
}

function isUpstreamOf(candidate, node, max=MAX_RECURSION) {
  const seen = new Set();
  const stack = [node];
  let steps = 0;
  while (stack.length && steps < max) {
    const cur = stack.pop();
    if (!cur || seen.has(cur.id)) continue;
    seen.add(cur.id);
    steps++;
    if (cur.id === candidate.id) return true;

    for (let i = 0; i < 4; i++) {
      const up = getUpstreamNode(cur, i);
      if (up) stack.push(up);
    }
  }
  return false;
}
