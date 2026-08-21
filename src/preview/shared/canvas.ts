// @ts-ignore — resolved by ComfyUI's web server at runtime
import { app } from "../../../../scripts/app.js";

let _dirtyRaf: number | null = null;

export function markCanvasDirty(): void {
  if (_dirtyRaf != null) return;
  _dirtyRaf = requestAnimationFrame(() => {
    _dirtyRaf = null;
    (app as any)?.graph?.setDirtyCanvas?.(true, true);
    (app as any)?.canvas?.setDirty?.(true, true);
  });
}
