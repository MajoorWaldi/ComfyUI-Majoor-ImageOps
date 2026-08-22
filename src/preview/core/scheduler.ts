import type { ComfyNode, NodeState } from "../../types.js";
import { ensureState } from "../shared/state.js";

/** Debounce a render/lifecycle callback for a ComfyUI node. */
export function schedule(node: ComfyNode, fn: () => void, delayMs: number = 120): void {
  const state = ensureState(node);
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(fn, delayMs);
}

/** Stop the node's active requestAnimationFrame loop. */
export function stopRAF(state: NodeState): void {
  if (state?.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }
}
