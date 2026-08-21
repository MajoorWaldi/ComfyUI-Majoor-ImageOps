// @ts-ignore — resolved by ComfyUI's web server at runtime
import { app } from "../../../../scripts/app.js";

let _dirtyRaf: number | null = null;
let _graphChangeTimer: ReturnType<typeof setTimeout> | null = null;

function markGraphChangedSoon(): void {
  if (_graphChangeTimer != null) clearTimeout(_graphChangeTimer);
  _graphChangeTimer = setTimeout(() => {
    _graphChangeTimer = null;
    const graph = (app as any)?.graph;
    try {
      graph?.change?.();
    } catch {}
  }, 80);
}

export function markCanvasDirty(): void {
  markGraphChangedSoon();
  if (_dirtyRaf != null) return;
  _dirtyRaf = requestAnimationFrame(() => {
    _dirtyRaf = null;
    (app as any)?.graph?.setDirtyCanvas?.(true, true);
    (app as any)?.canvas?.setDirty?.(true, true);
  });
}
