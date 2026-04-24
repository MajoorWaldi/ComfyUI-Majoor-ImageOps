// @ts-ignore
import { app } from "../../../scripts/app.js";
// @ts-ignore
import { api } from "../../../scripts/api.js";
import type {
  ComfyNode,
  ComfyNodeConstructor,
  DrawRenderSession,
  NodeInteractionContext,
  CropInteractionContext,
  DrawInteractionContext,
  CompInteractionContext,
} from "../types.js";
import { buildRenderer } from "./renderer.js";
import { buildAdapterRegistry } from "./registry.js";
import { detectSourceUpstream, getInputOriginSlot, getUpstreamNode, getUpstreamNodes, isGraphTooLarge, findDependents } from "./graph.js";
import { resolveNodeStreamPreview } from "./nodestream.js";
import { disposeMediaState } from "./source.js";
import { attachProgressBus } from "./progress.js";
import { getPreviewConfig } from "./config.js";
import { initOpsConstants } from "./constants.js";
import { getCompSlots } from "./comp.js";
import { renderCompPreview } from "./ops.js";
import { widgetNumber, widgetString } from "./shared/widgets.js";
import { getProceduralFrameCount, hasProceduralAnimation, getProceduralPlaybackFps } from "./shared/animation.js";
import { getInputIndexByName, getNativePreviewImage } from "./shared/media.js";
import { isNode as isPreviewNode, hidePreviewWidgets, syncPreviewWidgets } from "./nodes/preview.js";
import { isNode as isColorCorrectNode, hideColorCorrectWidgets, syncColorCorrectWidgets } from "./nodes/color-correct.js";
import { isNode as isCropNode, hideCropGeometryWidgets, syncCropWidgets, setCropOutputDimensions, getCropInfoText } from "./nodes/crop.js";
import { isNode as isDrawNode, hideDrawWidgets, syncDrawWidgets, updateDrawOverlayWidget } from "./nodes/draw.js";
import {
  isNode as isCompNode,
  hideCompWidgets,
  ensureCompState,
  updateCompControls,
  updateSelectedCompLayer,
  compCanvasToOutputPoint,
  getCompHit,
  writeCompLayerCorners,
  syncDarkColorInputUI,
  setDarkColorInputState,
  getCompInfoText,
} from "./nodes/comp.js";
import { isNode as isCornerPinNode, getCornerPinInfoText } from "./nodes/corner-pin.js";
import { isNode as isPadOutNode, getPadOutInfoText } from "./nodes/pad-out.js";
import { ensureState, setInfo, schedule, stopRAF, markPreviewInteraction, getRenderCanvasSize, buildPreviewRenderKey } from "./shared/state.js";
import { markCanvasDirty } from "./shared/canvas.js";
import { noteFrame } from "./shared/fps-monitor.js";
import { IMAGEOPS_CLASSES } from "./shared/classes.js";
import { ensurePreviewWidget, getNodePreviewMinHeight, getNodePreviewTargetSize } from "./shared/preview-widget.js";
import { blit, tryRenderNativePreview } from "./shared/bounds.js";
import { attachPreviewNavigation } from "./shared/navigation.js";
import {
  renderDrawNode,
  setDrawTool,
  ensureDrawInteractionReady,
  renderMaskCanvasFromNode,
  renderMaskInputForComp,
  deriveMaskCanvasFromCanvas,
  maskToOpaqueDisplayCanvas,
  cloneCanvas,
  restoreCanvas,
  pushDrawUndoSnapshot,
  popDrawUndoSnapshot,
  paintDrawSegment,
  ensureDrawCanvasSize,
  drawPointerDynamics,
  setDrawBrushSize,
} from "./nodes/draw-renderer.js";
import { attachInteractions as attachColorCorrectInteractionsExt } from "./interactions/color-correct.js";
import { attachInteractions as attachCornerPinInteractionsExt } from "./interactions/corner-pin.js";
import { attachInteractions as attachPadOutInteractionsExt } from "./interactions/pad-out.js";
import { attachInteractions as attachPreviewInteractionsExt } from "./interactions/preview.js";
import { attachInteractions as attachCropInteractionsExt } from "./interactions/crop.js";
import { attachInteractions as attachDrawInteractionsExt } from "./interactions/draw.js";
import { attachInteractions as attachCompInteractionsExt } from "./interactions/comp.js";

console.info("[ImageOps] LivePreview v6 loaded");

const EXT_NAME = "ImageOps.LivePreview.v6";

export function registerImageOpsLivePreview(): void {
  initOpsConstants();
  const cfg = getPreviewConfig();
  const canvasSize = cfg.canvasSize;
  const registry = buildAdapterRegistry();
  const renderer = buildRenderer({ api, registry, canvasSize });
  const progress = attachProgressBus(api);
  const session: DrawRenderSession = { renderer, progress, canvasSize };

  const nodeCtx: NodeInteractionContext = {
    schedule,
    markCanvasDirty,
    startLoopIfVideo(node) { startLoopIfVideo(node); },
    refreshDependents(node) { refreshDependents(node); },
    refreshNode(node) {
      const st = ensureState(node);
      st.nativeDirty = true;
      markPreviewInteraction(node);
      markCanvasDirty();
      schedule(node, () => {
        startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
    },
  };

  const cropCtx: CropInteractionContext = {
    ...nodeCtx,
    setCropOutputDimensions,
  };

  const drawCtx: DrawInteractionContext = {
    ...nodeCtx,
    markPreviewInteraction,
    renderDrawNode: (node, tick) => renderDrawNode(node, tick, session),
    ensureDrawCanvasSize,
    setDrawTool: (node, tool) => setDrawTool(node, tool, session),
    cloneCanvas,
    restoreCanvas,
    pushDrawUndoSnapshot,
    popDrawUndoSnapshot,
    paintDrawSegment,
    ensureDrawInteractionReady: (node) => ensureDrawInteractionReady(node, session),
    drawPointerDynamics,
    setDrawBrushSize,
    updateDrawOverlayWidget,
    syncDrawWidgets,
    syncDarkColorInputUI,
    setDarkColorInputState,
  };

  const compCtx: CompInteractionContext = {
    ...nodeCtx,
    markPreviewInteraction,
    ensureCompState,
    updateCompControls,
    updateSelectedCompLayer,
    compCanvasToOutputPoint,
    getCompHit,
    writeCompLayerCorners,
  };

  async function renderPreviewBridgeNode(node: ComfyNode, tick: number): Promise<void> {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const renderCanvasSize = getRenderCanvasSize(st);

    const imageIndex = getInputIndexByName(node, "image");
    const maskIndex = getInputIndexByName(node, "mask");
    const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();

    let imageCanvas: HTMLCanvasElement | null = null;
    let maskCanvas: HTMLCanvasElement | null = null;
    let imageFromNodeStream = false;
    let maskFromNodeStream = false;

    if (imageIndex >= 0) {
      const imageUpstream = getUpstreamNode(node, imageIndex);
      if (imageUpstream) {
        const rendered = await renderer.render(imageUpstream, tick, getInputOriginSlot(node, imageIndex), renderCanvasSize);
        imageCanvas = rendered.canvas;
        if (!imageCanvas) {
          const nodeStream = await resolveNodeStreamPreview(imageUpstream, renderCanvasSize);
          imageCanvas = nodeStream?.canvas ?? null;
          imageFromNodeStream = !!imageCanvas;
        }
      }
    }
    if (maskIndex >= 0) {
      const maskUpstream = getUpstreamNode(node, maskIndex);
      if (maskUpstream) {
        const maskOutputSlot = getInputOriginSlot(node, maskIndex, 1);
        const directMask = await renderMaskCanvasFromNode(maskUpstream, tick, session, maskOutputSlot);
        maskCanvas = directMask ? deriveMaskCanvasFromCanvas(directMask) : null;
        if (!maskCanvas) {
          const nodeStream = await resolveNodeStreamPreview(maskUpstream, renderCanvasSize);
          if (nodeStream?.canvas) {
            maskCanvas = deriveMaskCanvasFromCanvas(nodeStream.canvas);
            maskFromNodeStream = true;
          }
        }
      }
    }

    const chosen = previewTarget === "mask"
      ? (maskCanvas ?? imageCanvas)
      : previewTarget === "image"
        ? (imageCanvas ?? maskCanvas)
        : (imageCanvas ?? maskCanvas);

    if (!chosen) {
      setInfo(st, "Preview bridge: connect image or mask");
      return;
    }

    blit(node, st, chosen, renderCanvasSize);
    syncPreviewWidgets(node);
    if (previewTarget === "mask" || (!imageCanvas && maskCanvas)) {
      setInfo(st, maskFromNodeStream ? "Preview bridge (mask, nodestream)" : "Preview bridge (mask)");
    } else if (imageCanvas) {
      setInfo(st, imageFromNodeStream ? "Preview bridge (image, nodestream)" : "Preview bridge (image)");
    } else {
      setInfo(st, "Preview bridge");
    }
  }

  function renderNode(node: ComfyNode, tick: number = 0): void {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const renderCanvasSize = getRenderCanvasSize(st);
    const renderKey = buildPreviewRenderKey(node, tick, st, renderCanvasSize);

    if (!st.nativeDirty && st.lastKey === renderKey && st.lastRenderTick === tick) {
      return;
    }

    if (st.renderInFlight) {
      st.queuedRenderTick = tick;
      return;
    }

    const finishRender = (): void => {
      st.renderInFlight = false;
      const queuedTick = st.queuedRenderTick;
      st.queuedRenderTick = null;
      if (queuedTick != null) {
        renderNode(node, queuedTick);
      }
    };

    const commitRender = (): void => {
      st.lastKey = renderKey;
      st.lastRenderTick = tick;
      st.nativeDirty = false;
    };

    const failRender = (message: string, error: unknown): void => {
      setInfo(st, message);
      console.warn("[ImageOps] render error", error);
      // Commit the failed render key so the next RAF tick does not immediately
      // retry the same state — prevents a spin-on-error loop.
      commitRender();
      finishRender();
    };

    st.renderInFlight = true;

    if (isPreviewNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        setInfo(st, "Live preview disabled: graph too large");
        stopRAF(st);
        finishRender();
        return;
      }
      renderPreviewBridgeNode(node, tick).then(() => {
        commitRender();
        finishRender();
      }).catch((err) => {
        failRender("Preview bridge error (check console)", err);
      });
      return;
    }

    if (isDrawNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        setInfo(st, "Live preview disabled: graph too large");
        stopRAF(st);
        finishRender();
        return;
      }

      renderDrawNode(node, tick, session).then(() => {
        commitRender();
        finishRender();
      }).catch((err) => {
        failRender("Paint preview error (check console)", err);
      });
      return;
    }

    if (isCropNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        setInfo(st, "Live preview disabled: graph too large");
        st.cropGeometry = null;
        stopRAF(st);
        finishRender();
        return;
      }

      const upstream = getUpstreamNode(node, 0);
      if (!upstream) {
        setInfo(st, "Live preview: connect a supported loader/chain");
        st.cropGeometry = null;
        finishRender();
        return;
      }

      renderer.render(upstream, tick, getInputOriginSlot(node, 0), renderCanvasSize).then(result => {
        if (!result?.canvas) {
          setInfo(st, "Live preview: connect a supported loader/chain");
          st.cropGeometry = null;
          finishRender();
          return;
        }
        blit(node, st, result.canvas, renderCanvasSize);
        setInfo(st, getCropInfoText(node));
        commitRender();
        finishRender();
      }).catch(err => {
        st.cropGeometry = null;
        failRender("Live preview error (check console)", err);
      });
      return;
    }

    if (isCompNode(node)) {
      if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
        setInfo(st, "Live preview disabled: graph too large");
        st.compLayers = [];
        stopRAF(st);
        finishRender();
        return;
      }

      const slots = getCompSlots(node);
      const connected: Array<{ slot: string; layerNumber: number; inputIndex: number; image: HTMLCanvasElement; mask: HTMLCanvasElement | null }> = [];
      Promise.all(slots.map(async (slot) => {
        const upstream = getUpstreamNode(node, slot.inputIndex);
        if (!upstream) return null;
        const result = await renderer.render(upstream, tick, getInputOriginSlot(node, slot.inputIndex), renderCanvasSize);
        if (!result?.canvas) return null;
        let mask: HTMLCanvasElement | null = null;
        if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
          mask = await renderMaskInputForComp(node, slot.maskInputIndex, tick, session);
        }
        return { slot: slot.slot, layerNumber: slot.layerNumber, inputIndex: slot.inputIndex, image: result.canvas, mask };
      })).then((resolved) => {
        const ordered = resolved.filter((entry): entry is { slot: string; layerNumber: number; inputIndex: number; image: HTMLCanvasElement; mask: HTMLCanvasElement | null } => !!entry);
        if (ordered.length === 0) {
          setInfo(st, "Comp preview: connect at least one layer");
          st.compLayers = [];
          st.compOutputWidth = Math.max(1, Math.round(widgetNumber(node, "width", 1024)));
          st.compOutputHeight = Math.max(1, Math.round(widgetNumber(node, "height", 1024)));
          updateCompControls(node);
          commitRender();
          finishRender();
          return;
        }
        const rendered = renderCompPreview(node, ordered);
        st.compLayers = rendered.layers;
        st.compOutputWidth = rendered.canvas.width || 1;
        st.compOutputHeight = rendered.canvas.height || 1;
        blit(node, st, rendered.canvas, renderCanvasSize);
        setInfo(st, getCompInfoText(node, ordered.length, slots.length, st.compOutputWidth, st.compOutputHeight));
        updateCompControls(node);
        commitRender();
        finishRender();
      }).catch((err) => {
        failRender("Comp preview error (check console)", err);
        st.compLayers = [];
      });
      return;
    }

    if (tryRenderNativePreview(node, st, renderCanvasSize)) {
      commitRender();
      finishRender();
      return;
    }

    if (isGraphTooLarge(node?.graph, cfg.maxGraphNodes)) {
      setInfo(st, "Live preview disabled: graph too large");
      stopRAF(st);
      finishRender();
      return;
    }

    renderer.render(node, tick, null, renderCanvasSize).then(result => {
      if (!result?.canvas) {
        setInfo(st, "Live preview: connect a supported loader/chain");
        finishRender();
        return;
      }
      blit(node, st, result.canvas, renderCanvasSize);
      if (isCornerPinNode(node)) {
        setInfo(st, getCornerPinInfoText(node, result.canvas.width || 1, result.canvas.height || 1));
      } else if (isPadOutNode(node)) {
        setInfo(st, getPadOutInfoText(node, result.canvas.width || 1, result.canvas.height || 1));
      } else {
        const src = detectSourceUpstream(node);
        if (src?.kind === "video") {
          setInfo(st, "Live preview (video)");
        } else if (src?.animated) {
          setInfo(st, "Live preview (animated image)");
        } else if (src?.kind) {
          setInfo(st, `Live preview (${src.kind})`);
        } else {
          setInfo(st, "Live preview (no queue)");
        }
      }
      commitRender();
      finishRender();
    }).catch(err => {
      failRender("Live preview error (check console)", err);
    });
  }

  function findUpstreamProceduralNode(node: ComfyNode): ComfyNode | null {
    const seen = new Set<number>();
    const queue: ComfyNode[] = [...getUpstreamNodes(node)];
    while (queue.length) {
      const cur = queue.shift()!;
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (hasProceduralAnimation(cur)) return cur;
      queue.push(...getUpstreamNodes(cur));
    }
    return null;
  }

  function startLoopIfVideo(node: ComfyNode): void {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;

    const nativeImg = getNativePreviewImage(node);
    if (nativeImg && !st.nativeAnimated && !isCropNode(node)) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }

    const src = detectSourceUpstream(node);
    const upstreamProcedural = findUpstreamProceduralNode(node);
    if ((!src || (src.kind !== "video" && !src.animated)) && !st.nativeAnimated && !hasProceduralAnimation(node) && !upstreamProcedural) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }

    let tick = 0;
    let lastLoopTick: number | null = null;
    const proceduralFrameCount = getProceduralFrameCount(node) ?? (upstreamProcedural ? getProceduralFrameCount(upstreamProcedural) : null);
    const hasProcedural = proceduralFrameCount != null;
    const startedAt = performance.now();
    const loop = (): void => {
      // Feed the global FPS monitor so getRenderCanvasSize() can downscale
      // automatically when the system is stressed (LOD adaptive).
      noteFrame(performance.now());
      if (hasProcedural) {
        // Re-read fps on every tick so widget changes take effect immediately.
        const currentFps = getProceduralPlaybackFps(node) ?? (upstreamProcedural ? getProceduralPlaybackFps(upstreamProcedural) : null) ?? 12;
        const rawTick = Math.floor(((performance.now() - startedAt) * currentFps) / 1000);
        tick = proceduralFrameCount != null && proceduralFrameCount > 0 ? (rawTick % proceduralFrameCount) : rawTick;
      } else {
        tick++;
      }
      if (tick !== lastLoopTick) {
        lastLoopTick = tick;
        renderNode(node, tick);
      }
      st.rafId = requestAnimationFrame(loop);
    };
    stopRAF(st);
    st.rafId = requestAnimationFrame(loop);
  }

  function refreshDependents(changedNode: ComfyNode): void {
    const deps = findDependents(changedNode, (n) => IMAGEOPS_CLASSES.has(n.comfyClass));
    for (const n of deps) {
      ensureState(n).nativeDirty = true;
      startLoopIfVideo(n);
    }
  }

  function hookNode(node: ComfyNode): void {
    // Non-ImageOps nodes: only hook onExecuted to refresh downstream ImageOps nodes.
    // Avoid creating heavy state objects or wrapping widgets on every node in the graph.
    if (!IMAGEOPS_CLASSES.has(node.comfyClass)) {
      if ((node as any).__imageops_hooked_ext) return;
      (node as any).__imageops_hooked_ext = true;
      const origOnExecuted0 = node.onExecuted;
      node.onExecuted = function (this: any, message: any) {
        let r: any;
        try { r = origOnExecuted0?.apply(this, arguments as any); } catch (e) { console.warn("[ImageOps] upstream onExecuted threw", e); }
        try { refreshDependents(node); } catch (e) { console.warn("[ImageOps] refreshDependents threw", e); }
        return r;
      };
      return;
    }

    const st = ensureState(node);
    if (st.hooked) return;
    st.hooked = true;

    // Cleanup RAF and timers when the node is removed from the graph.
    const origOnRemoved = (node as any).onRemoved;
    (node as any).onRemoved = function (this: any) {
      let r: any;
      try { r = origOnRemoved?.apply(this, arguments as any); } catch (e) { console.warn("[ImageOps] origOnRemoved threw", e); }
      try { stopRAF(st); } catch {}
      if (st.debounceTimer != null) {
        try { clearTimeout(st.debounceTimer); } catch {}
        st.debounceTimer = null;
      }
      try { (st as any)._navWheelCleanup?.(); } catch {}
      try { (st as any)._drawWheelCleanup?.(); } catch {}
      // Trigger AbortController-based cleanups, if any interaction module attached one.
      try { (st as any)._abortController?.abort(); } catch {}
      // Release video element and ImageBitmap GPU memory immediately.
      try { disposeMediaState(node); } catch (e) { console.warn("[ImageOps] disposeMediaState threw", e); }
      return r;
    };

    if (isCropNode(node)) {
      hideCropGeometryWidgets(node);
      syncCropWidgets(node);
    }
    if (isDrawNode(node)) {
      hideDrawWidgets(node);
      syncDrawWidgets(node);
    }
    if (isColorCorrectNode(node)) {
      hideColorCorrectWidgets(node);
      syncColorCorrectWidgets(node);
    }
    if (isCompNode(node)) {
      hideCompWidgets(node);
      ensureCompState(node);
      updateCompControls(node);
    }
    if (isPreviewNode(node)) {
      hidePreviewWidgets(node);
      syncPreviewWidgets(node);
    }

    if (IMAGEOPS_CLASSES.has(node.comfyClass)) {
      node.previewMediaType = "image";
      ensurePreviewWidget(node, progress, canvasSize);
      attachPreviewNavigation(node, canvasSize);
      if (isPreviewNode(node)) {
        attachPreviewInteractionsExt(node, nodeCtx);
      }
      if (isDrawNode(node)) {
        attachDrawInteractionsExt(node, drawCtx);
      }
      if (isColorCorrectNode(node)) {
        attachColorCorrectInteractionsExt(node, nodeCtx);
      }
      if (isCropNode(node)) {
        attachCropInteractionsExt(node, cropCtx);
      }
      if (isCompNode(node)) {
        attachCompInteractionsExt(node, compCtx);
      }
      if (isPadOutNode(node)) {
        attachPadOutInteractionsExt(node, nodeCtx);
      }
      if (isCornerPinNode(node)) {
        attachCornerPinInteractionsExt(node, nodeCtx);
      }
      startLoopIfVideo(node);
    }

    for (const w of (node.widgets ?? [])) {
      if (typeof w.callback !== 'function' && typeof w.callback !== 'undefined') continue;
      const orig = w.callback;
      w.callback = function (this: any) {
        const r = orig?.apply(this, arguments as any);
        if (isCropNode(node)) {
          syncCropWidgets(node, w.name);
        }
        if (isDrawNode(node)) {
          syncDrawWidgets(node, w.name);
        }
        if (isColorCorrectNode(node)) {
          syncColorCorrectWidgets(node);
        }
        if (isCompNode(node)) {
          ensureCompState(node);
          updateCompControls(node);
        }
        if (isPreviewNode(node)) {
          syncPreviewWidgets(node);
        }
        st.nativeDirty = true;
        schedule(node, () => {
          if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
          refreshDependents(node);
        }, cfg.debounceMs);
        return r;
      };
    }

    const chainCb = (prop: "onConnectionsChange" | "onConfigure"): void => {
      const orig = node[prop];
      (node as any)[prop] = function (this: any) {
        const r = orig?.apply(this, arguments as any);
        if (isCropNode(node) && prop === "onConfigure") {
          hideCropGeometryWidgets(node);
          syncCropWidgets(node);
          st.cropInteractiveHooked = false;
          attachCropInteractionsExt(node, cropCtx);
        }
        if (isDrawNode(node) && prop === "onConfigure") {
          hideDrawWidgets(node);
          st.drawInteractiveHooked = false;
          attachDrawInteractionsExt(node, drawCtx);
        }
        if (isColorCorrectNode(node) && prop === "onConfigure") {
          hideColorCorrectWidgets(node);
          st.colorInteractiveHooked = false;
          attachColorCorrectInteractionsExt(node, nodeCtx);
          syncColorCorrectWidgets(node);
        }
        if (isDrawNode(node)) {
          syncDrawWidgets(node);
        }
        if (isCompNode(node) && prop === "onConfigure") {
          hideCompWidgets(node);
          ensureCompState(node);
          st.compInteractiveHooked = false;
          attachCompInteractionsExt(node, compCtx);
          updateCompControls(node);
        }
        if (isCornerPinNode(node) && prop === "onConfigure") {
          st.cornerPinInteractiveHooked = false;
          attachCornerPinInteractionsExt(node, nodeCtx);
        }
        if (isPadOutNode(node) && prop === "onConfigure") {
          st.padOutInteractiveHooked = false;
          attachPadOutInteractionsExt(node, nodeCtx);
        }
        if (isPreviewNode(node) && prop === "onConfigure") {
          hidePreviewWidgets(node);
          attachPreviewInteractionsExt(node, nodeCtx);
          syncPreviewWidgets(node);
        }
        if (prop === "onConfigure" && IMAGEOPS_CLASSES.has(node.comfyClass)) {
          const minH = getNodePreviewMinHeight(node);
          // Defer so any post-configure size restoration by ComfyUI happens first.
          setTimeout(() => {
            try {
              const cs = (node as any).computeSize?.() ?? [360, minH];
              const root = ensureState(node).canvas?.parentElement as HTMLElement | null;
              (node as any).setSize?.(getNodePreviewTargetSize(node, root, Math.max(cs[0], 360)));
              (node.graph as any)?.setDirtyCanvas(true, true);
            } catch {}
          }, 100);
        }
        st.nativeDirty = true;
        if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
        return r;
      };
    };
    chainCb("onConnectionsChange");
    chainCb("onConfigure");

    const origExecuted = node.onExecuted;
    node.onExecuted = function (this: any, message: any) {
      const r = origExecuted?.apply(this, arguments as any);
      st.nativeAnimated = !!message?.animated?.[0];
      st.nativeDirty = false;
      st.lastKey = null;
      st.lastRenderTick = null;
      schedule(node, () => {
        if (IMAGEOPS_CLASSES.has(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
      return r;
    };
  }

  app.registerExtension({
    name: EXT_NAME,
    async beforeRegisterNodeDef(nodeType: ComfyNodeConstructor, _nodeData: any) {
      const origOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function (this: ComfyNode) {
        try { origOnNodeCreated?.apply(this, arguments as any); } catch (e) { console.warn("[ImageOps] origOnNodeCreated threw", e); }
        try { hookNode(this); } catch (e) { console.warn("[ImageOps] hookNode failed for", this?.comfyClass, e); }
      };
    },
    // Node 2.0 fallback: called per-instance after the node is fully constructed.
    nodeCreated(node: ComfyNode) {
      try { hookNode(node); } catch (e) { console.warn("[ImageOps] hookNode (nodeCreated) failed for", node?.comfyClass, e); }
    },
  } as any);
}
