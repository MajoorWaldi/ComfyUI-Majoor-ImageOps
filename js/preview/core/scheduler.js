import { ensureState } from "../shared/state.js";
function schedule(node, fn, delayMs = 120) {
  const state = ensureState(node);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(fn, delayMs);
}
function stopRAF(state) {
  if (state?.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}
export {
  schedule,
  stopRAF
};
