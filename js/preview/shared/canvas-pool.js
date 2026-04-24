const POOL_MAX = 24;
const pool = [];
function clampDim(value) {
  return Math.max(1, Math.round(value || 1));
}
function acquireCanvas(width, height) {
  const w = clampDim(width);
  const h = clampDim(height);
  for (let i = pool.length - 1; i >= 0; i--) {
    const c = pool[i];
    if (c.width === w && c.height === h) {
      pool.splice(i, 1);
      return c;
    }
  }
  const reused = pool.pop();
  if (reused) {
    if (reused.width !== w) reused.width = w;
    if (reused.height !== h) reused.height = h;
    return reused;
  }
  const fresh = document.createElement("canvas");
  fresh.width = w;
  fresh.height = h;
  return fresh;
}
function releaseCanvas(canvas) {
  if (!canvas) return;
  if (pool.length >= POOL_MAX) return;
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    return;
  }
  pool.push(canvas);
}
function _poolSize() {
  return pool.length;
}
export {
  _poolSize,
  acquireCanvas,
  releaseCanvas
};
