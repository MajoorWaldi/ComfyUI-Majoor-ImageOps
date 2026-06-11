import { app } from "../../../../scripts/app.js";
let _dirtyRaf = null;
let _graphChangeTimer = null;
function markGraphChangedSoon() {
  if (_graphChangeTimer != null) clearTimeout(_graphChangeTimer);
  _graphChangeTimer = setTimeout(() => {
    _graphChangeTimer = null;
    const graph = app?.graph;
    try {
      graph?.change?.();
    } catch {
    }
  }, 80);
}
function markCanvasDirty() {
  markGraphChangedSoon();
  if (_dirtyRaf != null) return;
  _dirtyRaf = requestAnimationFrame(() => {
    _dirtyRaf = null;
    app?.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
  });
}
export {
  markCanvasDirty
};
