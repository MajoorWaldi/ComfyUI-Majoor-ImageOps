import type { ComfyNode, NodeInteractionContext } from "../../types.js";
import { isNode, syncPreviewWidgets } from "../nodes/preview.js";
import { findWidget, setWidgetStringValue } from "../shared/widgets.js";

export function attachInteractions(node: ComfyNode, ctx: NodeInteractionContext): void {
  if (!isNode(node)) return;
  const st = node.__imageops_state ?? null;
  const root = st?.canvas?.parentElement as HTMLElement | null;
  if (!st || !root || root.dataset.previewInteractiveHooked === "1") return;
  root.dataset.previewInteractiveHooked = "1";

  for (const button of Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-preview-target]"))) {
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

  const modeSelect = root.querySelector<HTMLSelectElement>("select[data-preview-mode]");
  modeSelect?.addEventListener("change", () => {
    setWidgetStringValue(findWidget(node, "mode"), modeSelect.value);
    syncPreviewWidgets(node);
    st.nativeDirty = true;
    ctx.schedule(node, () => ctx.startLoopIfVideo(node), 0);
  });

  syncPreviewWidgets(node);
}
