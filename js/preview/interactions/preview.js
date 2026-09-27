import { isNode, syncPreviewWidgets } from "../nodes/preview.js";
import { findWidget, setWidgetStringValue } from "../shared/widgets.js";
function attachInteractions(node, ctx) {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.canvas?.parentElement;
  if (!st || !root || root.dataset.previewInteractiveHooked === "1") return;
  root.dataset.previewInteractiveHooked = "1";
  for (const button of Array.from(root.querySelectorAll("button[data-preview-target]"))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const target = String(button.dataset.previewTarget ?? "auto");
      setWidgetStringValue(findWidget(node, "preview_target"), target);
      syncPreviewWidgets(node);
      st.nativeDirty = true;
      ctx.markCanvasDirty();
      ctx.schedule(node, () => ctx.startLoopIfVideo(node), 0);
    });
  }
  const modeSelect = root.querySelector("select[data-preview-mode]");
  modeSelect?.addEventListener("change", () => {
    setWidgetStringValue(findWidget(node, "mode"), modeSelect.value);
    syncPreviewWidgets(node);
    st.nativeDirty = true;
    ctx.schedule(node, () => ctx.startLoopIfVideo(node), 0);
  });
  for (const button of Array.from(root.querySelectorAll("button[data-compare-mode]"))) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      st.previewCompareMode = button.dataset.compareMode ?? "live";
      syncPreviewWidgets(node);
      ctx.refreshPreviewOnly(node, 0);
    });
  }
  const wipeTrack = root.querySelector("div[data-wipe-track]");
  if (wipeTrack) {
    const fractionFromPointer = (event) => {
      const rect = wipeTrack.getBoundingClientRect();
      return Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
    };
    wipeTrack.addEventListener("pointerdown", (event) => {
      st.previewWipeDrag = { pointerId: event.pointerId };
      st.previewWipeFraction = fractionFromPointer(event);
      syncPreviewWidgets(node);
      ctx.refreshPreviewOnly(node, 0);
      wipeTrack.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    wipeTrack.addEventListener("pointermove", (event) => {
      if (!st.previewWipeDrag || st.previewWipeDrag.pointerId !== event.pointerId) return;
      st.previewWipeFraction = fractionFromPointer(event);
      syncPreviewWidgets(node);
      ctx.refreshPreviewOnly(node, 0);
      event.preventDefault();
    });
    const release = (event) => {
      if (!st.previewWipeDrag || st.previewWipeDrag.pointerId !== event.pointerId) return;
      st.previewWipeDrag = null;
      wipeTrack.releasePointerCapture?.(event.pointerId);
    };
    wipeTrack.addEventListener("pointerup", release);
    wipeTrack.addEventListener("pointercancel", release);
  }
  syncPreviewWidgets(node);
}
export {
  attachInteractions
};
