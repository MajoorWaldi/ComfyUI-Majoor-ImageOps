import { app } from "../../../../scripts/app.js";
let _dirtyRaf = null;
function markCanvasDirty() {
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
