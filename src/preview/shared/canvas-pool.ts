// Canvas pool — reduces GC churn in hot per-tick paths (blur tmp canvases,
// renderer working surfaces, etc.).
//
// Design notes:
//   - The pool is bounded (POOL_MAX) so a runaway leak can't grow indefinitely.
//   - Pooled canvases are cleared on release (clearRect) so the next acquirer
//     never sees stale pixels.
//   - Acquire is by exact (w,h) match first, then by reuse-and-resize of any
//     pooled canvas (cheap when sizes are similar).
//   - This pool is OPT-IN: callers must explicitly release. Anything that
//     escapes back to the caller (cached canvases, returned results) MUST NOT
//     be released.

const POOL_MAX = 24;
const pool: HTMLCanvasElement[] = [];

function clampDim(value: number): number {
  return Math.max(1, Math.round(value || 1));
}

export function acquireCanvas(width: number, height: number): HTMLCanvasElement {
  const w = clampDim(width);
  const h = clampDim(height);
  // Prefer exact size match (cheap reuse, no realloc).
  for (let i = pool.length - 1; i >= 0; i--) {
    const c = pool[i];
    if (c.width === w && c.height === h) {
      pool.splice(i, 1);
      return c;
    }
  }
  // Fallback: reuse the most recent pooled canvas, resize it.
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

export function releaseCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  if (pool.length >= POOL_MAX) return; // bound the pool
  // Clear so the next acquirer doesn't inherit stale pixels.
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  } catch {
    // If the context is wedged we just drop the canvas instead of pooling it.
    return;
  }
  pool.push(canvas);
}

/** For diagnostics only. */
export function _poolSize(): number { return pool.length; }
