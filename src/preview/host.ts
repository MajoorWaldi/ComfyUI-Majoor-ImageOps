// @ts-ignore
import { app } from "../../../scripts/app.js";
// @ts-ignore
import { api } from "../../../scripts/api.js";
import type {
    ComfyNode,
    ComfyNodeConstructor,
    CompInteractionContext,
    CropInteractionContext,
    DrawInteractionContext,
    DrawRenderSession,
    NodeInteractionContext,
} from "../types.js";
import { getCompSlots } from "./comp.js";
import { getPreviewConfig } from "./config.js";
import { initOpsConstants } from "./constants.js";
import { detectSourceUpstream, findDependents, getInputOriginSlot, getUpstreamNode, getUpstreamNodes, isGraphTooLarge } from "./core/graph.js";
import { getInputIndexByName, getNativePreviewImage, getUpstreamVideoFps } from "./core/media.js";
import { buildRenderer } from "./core/renderer.js";
import { schedule, stopRAF } from "./core/scheduler.js";
import { attachInteractions as attachJoinInteractionsExt, syncJoinControls } from "./interactions/append.js";
import { attachInteractions as attachColorCorrectInteractionsExt } from "./interactions/color-correct.js";
import { attachInteractions as attachCompInteractionsExt } from "./interactions/comp.js";
import { attachInteractions as attachConstantInteractionsExt } from "./interactions/constant.js";
import { attachInteractions as attachCornerPinInteractionsExt } from "./interactions/corner-pin.js";
import { attachInteractions as attachCropInteractionsExt } from "./interactions/crop.js";
import { attachInteractions as attachDrawInteractionsExt } from "./interactions/draw.js";
import { attachInteractions as attachGrainInteractionsExt } from "./interactions/grain.js";
import { attachInteractions as attachPadOutInteractionsExt } from "./interactions/pad-out.js";
import { attachInteractions as attachPreviewInteractionsExt } from "./interactions/preview.js";
import { attachInteractions as attachRampInteractionsExt } from "./interactions/ramp.js";
import { attachInteractions as attachTextInteractionsExt } from "./interactions/text.js";
import { ensureJoinInputs, getJoinPreviewFrameCount, getJoinSlots, getPreviewNodeFrameCount, hideJoinWidgets, isNode as isJoinNode } from "./nodes/append.js";
import { hideColorCorrectWidgets, isNode as isColorCorrectNode, syncColorCorrectWidgets } from "./nodes/color-correct.js";
import {
    compCanvasToOutputPoint,
    ensureCompState,
    getCompHit,
    getCompInfoText,
    hideCompWidgets,
    isNode as isCompNode,
    setDarkColorInputState,
    syncCompWidgets,
    syncDarkColorInputUI,
    updateCompControls,
    updateSelectedCompLayer,
    writeCompLayerCorners,
} from "./nodes/comp.js";
import { getConstantInfoText, hideConstantWidgets, isNode as isConstantNode, syncConstantWidgets } from "./nodes/constant.js";
import { getCornerPinInfoText, isNode as isCornerPinNode } from "./nodes/corner-pin.js";
import { getCropInfoText, hideCropGeometryWidgets, isNode as isCropNode, setCropOutputDimensions, syncCropWidgets } from "./nodes/crop.js";
import {
    cloneCanvas,
    deriveMaskCanvasFromCanvas,
    drawPointerDynamics,
    ensureDrawCanvasSize,
    ensureDrawInteractionReady,
    paintDrawSegment,
    popDrawUndoSnapshot,
    pushDrawUndoSnapshot,
    renderDrawNode,
    renderMaskCanvasFromNode,
    renderMaskInputForComp,
    restoreCanvas,
    setDrawBrushSize,
    setDrawTool
} from "./nodes/draw-renderer.js";
import { hideDrawWidgets, isNode as isDrawNode, syncDrawWidgets, updateDrawOverlayWidget } from "./nodes/draw.js";
import { attachFrameSelectorControls, getFrameSelectorOutputCount, getUpstreamFps as getFrameSelectorUpstreamFps, hideFrameSelectorWidgets, isNode as isFrameSelectorNode, syncFrameSelectorWidgets } from "./nodes/frame-range.js";
import { getGrainInfoText, hideGrainWidgets, isNode as isGrainNode, syncGrainWidgets } from "./nodes/grain.js";
import { attachKeyerControls, hideKeyerWidgets, isNode as isKeyerNode, syncKeyerWidgets } from "./nodes/keyer.js";
import { applyPadOutTargetFormat, attachPadOutControls, getPadOutInfoText, hidePadOutWidgets, hydratePadOutTargetFormat, isNode as isPadOutNode, syncPadOutControls } from "./nodes/pad-out.js";
import { hidePreviewWidgets, isNode as isPreviewNode, syncPreviewWidgets } from "./nodes/preview.js";
import { getRampInfoText, hideRampWidgets, isNode as isRampNode, syncRampWidgets } from "./nodes/ramp.js";
import { getTextInfoText, hideTextWidgets, isNode as isTextNode, syncTextWidgets } from "./nodes/text.js";
import { hideTransformWidgets, isNode as isTransformNode } from "./nodes/transform.js";
import { resolveNodeStreamPreview } from "./nodestream.js";
import { renderCompPreview } from "./ops.js";
import { attachProgressBus } from "./progress.js";
import { buildAdapterRegistry } from "./registry.js";
import { getProceduralFrameCount, getProceduralPlaybackFps, hasProceduralAnimation } from "./shared/animation.js";
import { blit, tryRenderNativePreview } from "./shared/bounds.js";
import { markCanvasDirty } from "./shared/canvas.js";
import { isImageOpsClass } from "./shared/classes.js";
import { noteFrame } from "./shared/fps-monitor.js";
import { attachPreviewNavigation } from "./shared/navigation.js";
import { ensurePreviewWidget } from "./shared/preview-widget.js";
import { buildPreviewRenderKey, ensureState, getRenderCanvasSize, markPreviewInteraction, setInfo } from "./shared/state.js";
import { deduplicateColorWidgets, findWidget, resetNodeWidgetsToDefaults, setWidgetStringValue, widgetNumber, widgetString } from "./shared/widgets.js";
import { disposeMediaState, resolveNodeIntrinsicMediaSize } from "./source.js";

console.info("[ImageOps] LivePreview v6 loaded");

const EXT_NAME = "ImageOps.LivePreview.v6";
let extensionRegistered = false;

function getNodeInputDefault(nodeData: any, inputName: string): unknown {
  const entry = nodeData?.input?.required?.[inputName] ?? nodeData?.input?.optional?.[inputName];
  if (!Array.isArray(entry)) return undefined;
  const options = entry[1];
  return options && typeof options === "object" ? options.default : undefined;
}

function hydrateKeyerDefaults(node: ComfyNode, nodeData: any): void {
  if (!isKeyerNode(node)) return;
  const keyColorWidget = findWidget(node, "key_color");
  if (!keyColorWidget) return;

  const defaultKeyColor = getNodeInputDefault(nodeData, "key_color");
  if (typeof defaultKeyColor !== "string" || !defaultKeyColor) return;

  // ComfyUI's hidden COLOR widget initializes to black even when the backend
  // schema default is different. Hydrate the backend default before the custom
  // preview sync reads the hidden widget.
  if (String(keyColorWidget.value ?? "").toLowerCase() === "#000000" && defaultKeyColor.toLowerCase() !== "#000000") {
    setWidgetStringValue(keyColorWidget, defaultKeyColor);
  }
}

export function registerImageOpsLivePreview(): void {
  if (extensionRegistered) return;
  extensionRegistered = true;

  if (typeof document !== "undefined" && !document.getElementById("comfyui-imageops-styles")) {
    const style = document.createElement("style");
    style.id = "comfyui-imageops-styles";
    style.textContent = `
      /* Scrollbars in custom UI panel */
      .comfy-menu::-webkit-scrollbar,
      .comfy-panel::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      .comfy-menu::-webkit-scrollbar-thumb,
      .comfy-panel::-webkit-scrollbar-thumb {
        background: #444;
        border-radius: 3px;
      }
      .comfy-menu::-webkit-scrollbar-track,
      .comfy-panel::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.1);
      }

      /* Fields & Inputs */
      .comfy-input {
        font-family: var(--comfy-font-sans, Inter, sans-serif);
        font-size: 11px !important;
        border-radius: 4px !important;
        border: 1px solid #3f3f3f !important;
        background: #1c1c1c !important;
        color: #fff !important;
        padding: 4px 6px !important;
        box-sizing: border-box !important;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .comfy-input:focus {
        border-color: #555 !important;
        outline: none !important;
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.05);
      }

      /* Buttons */
      .comfy-btn {
        font-family: var(--comfy-font-sans, Inter, sans-serif);
        font-size: 11px !important;
        border-radius: 4px !important;
        border: 1px solid #3f3f3f !important;
        background: #2b2b2b !important;
        color: #ccc !important;
        padding: 4px 8px !important;
        cursor: pointer !important;
        line-height: 1.2 !important;
        transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
        user-select: none;
      }
      .comfy-btn:hover {
        background: #3e3e3e !important;
        color: #fff !important;
        border-color: #555 !important;
      }
      .comfy-btn:active {
        background: #1c1c1c !important;
        color: #aaa !important;
      }
      .comfy-btn.active {
        background: #444 !important;
        color: #fff !important;
        border-color: #666 !important;
        font-weight: 500;
      }

      /* Range/Slider Input */
      .comfy-slider {
        -webkit-appearance: none;
        appearance: none;
        width: 100%;
        height: 6px;
        background: #151515 !important;
        border: 1px solid #2e2e2e !important;
        border-radius: 3px !important;
        outline: none !important;
        margin: 6px 0 !important;
        cursor: ew-resize !important;
        transition: border-color 0.15s ease;
      }
      .comfy-slider:hover {
        border-color: #3f3f3f !important;
      }

      /* WebKit Slider Thumb (Chrome, Safari, Edge) */
      .comfy-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ccc;
        border: 1px solid #444;
        cursor: ew-resize;
        transition: background-color 0.15s ease, transform 0.1s ease;
      }
      .comfy-slider::-webkit-slider-thumb:hover {
        background: #fff;
        transform: scale(1.15);
      }
      .comfy-slider::-webkit-slider-thumb:active {
        background: #aaa;
      }

      /* Firefox Slider Thumb */
      .comfy-slider::-moz-range-thumb {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: #ccc;
        border: 1px solid #444;
        cursor: ew-resize;
        transition: background-color 0.15s ease, transform 0.1s ease;
      }
      .comfy-slider::-moz-range-thumb:hover {
        background: #fff;
        transform: scale(1.15);
      }

      /* Details Panel (Collapsible Panel) */
      .comfy-details {
        margin-top: 8px !important;
        background: rgba(255, 255, 255, 0.02) !important;
        border: 1px solid #333333 !important;
        border-radius: 4px !important;
        padding: 4px 8px 8px !important;
        font-family: var(--comfy-font-sans, Inter, sans-serif);
      }
      .comfy-details summary {
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        opacity: 0.85;
        padding: 6px 0;
        user-select: none;
        color: #fff;
      }
      .comfy-details summary:hover {
        opacity: 1;
      }

      /* Custom Dropdown Context Menu */
      .comfy-menu {
        background: #1c1c1f !important;
        border: 1px solid #3e3e3e !important;
        border-radius: 4px !important;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6) !important;
        box-sizing: border-box;
      }
      .comfy-menu button {
        border-radius: 3px !important;
        font-family: var(--comfy-font-sans, Inter, sans-serif);
        transition: background-color 0.1s ease;
      }
      .comfy-menu button:hover {
        background: #3e3e42 !important;
      }
    `;
    document.head.appendChild(style);
  }

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
      refreshPreviewOnly(node, delayMs = 0) {
        const st = ensureState(node);
        st.nativeDirty = true;
        markPreviewInteraction(node);
        markCanvasDirty();
        schedule(node, () => renderNode(node, 0), delayMs);
      },
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

  function bindDefaultResetButton(node: ComfyNode): void {
    const st = ensureState(node) as any;
    const button = st.nodeResetButton as HTMLButtonElement | null | undefined;
    if (!button || st.nodeResetHooked) return;
    st.nodeResetHooked = true;

    button.addEventListener("click", (event: MouseEvent) => {
      event.preventDefault();
      resetNodeWidgetsToDefaults(node);

      if (isPreviewNode(node)) {
        syncPreviewWidgets(node);
      }
      if (isConstantNode(node)) {
        syncConstantWidgets(node);
      }
      if (isGrainNode(node)) {
        syncGrainWidgets(node);
      }
      if (isTextNode(node)) {
        syncTextWidgets(node);
      }
      if (isRampNode(node)) {
        st.rampDrag = null;
        syncRampWidgets(node);
      }
      if (isFrameSelectorNode(node)) {
        st.frameSelectorSourceCount = 0;
        syncFrameSelectorWidgets(node);
      }
      if (isKeyerNode(node)) {
        st.keyerPicking = false;
        syncKeyerWidgets(node);
      }
      if (isPadOutNode(node)) {
        (st as any).padOutRatioHydrated = false;
        hydratePadOutTargetFormat(node);
        syncPadOutControls(node);
      }
      if (isDrawNode(node)) {
        st.drawStroke = null;
        st.drawHover = null;
        st.drawCanvas = null;
        st.drawBaseCanvas = null;
        st.drawUndoStack = [];
        st.drawOverlayKey = null;
        syncDrawWidgets(node);
      }
      if (isCornerPinNode(node) || isPadOutNode(node) || isRampNode(node)) {
        if (st.canvas) st.canvas.style.cursor = "default";
      }

      nodeCtx.refreshNode(node);
    });
  }

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

  async function ensurePreviewImageReady(image: HTMLImageElement | null | undefined): Promise<HTMLImageElement | null> {
    if (!(image instanceof HTMLImageElement)) return null;
    if ((!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) && image.decode) {
      try {
        await image.decode();
      } catch {
        // Ignore decode failures and fall back to runtime dimensions below.
      }
    }
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    return image;
  }

  async function buildPreviewStripCanvas(frames: readonly { source: CanvasImageSource; width: number; height: number }[], renderCanvasSize: number): Promise<HTMLCanvasElement | null> {
    if (!frames.length) return null;
    if (frames.length === 1) {
      const single = document.createElement("canvas");
      single.width = Math.max(1, Math.round(frames[0].width));
      single.height = Math.max(1, Math.round(frames[0].height));
      const singleCtx = single.getContext("2d", { willReadFrequently: true });
      if (!singleCtx) return null;
      singleCtx.drawImage(frames[0].source, 0, 0, single.width, single.height);
      return single;
    }

    const gap = Math.max(4, Math.round(renderCanvasSize * 0.012));
    const maxColumns = 4;
    const columns = Math.max(2, Math.min(maxColumns, Math.ceil(Math.sqrt(frames.length))));
    const rows = Math.max(1, Math.ceil(frames.length / columns));
    const avgAspect = frames.reduce((sum, frame) => sum + (frame.width / Math.max(1, frame.height)), 0) / Math.max(1, frames.length);
    const clampedAspect = Math.max(0.9, Math.min(1.8, avgAspect));
    const cellHeight = Math.max(80, Math.min(164, Math.round(renderCanvasSize * 0.24)));
    const cellWidth = Math.max(96, Math.round(cellHeight * clampedAspect));
    const totalWidth = columns * cellWidth + (columns - 1) * gap;
    const totalHeight = rows * cellHeight + (rows - 1) * gap;

    const strip = document.createElement("canvas");
    strip.width = totalWidth;
    strip.height = totalHeight;
    const stripCtx = strip.getContext("2d", { willReadFrequently: true });
    if (!stripCtx) return null;
    stripCtx.fillStyle = "#000";
    stripCtx.fillRect(0, 0, strip.width, strip.height);
    stripCtx.imageSmoothingEnabled = true;

    for (let index = 0; index < frames.length; index++) {
      const frame = frames[index];
      const col = index % columns;
      const row = Math.floor(index / columns);
      const cellX = col * (cellWidth + gap);
      const cellY = row * (cellHeight + gap);
      const scale = Math.min(cellWidth / Math.max(1, frame.width), cellHeight / Math.max(1, frame.height));
      const drawWidth = Math.max(1, Math.round(frame.width * scale));
      const drawHeight = Math.max(1, Math.round(frame.height * scale));
      const drawX = cellX + Math.floor((cellWidth - drawWidth) / 2);
      const drawY = cellY + Math.floor((cellHeight - drawHeight) / 2);

      stripCtx.fillStyle = "rgba(255,255,255,0.035)";
      stripCtx.fillRect(cellX, cellY, cellWidth, cellHeight);
      stripCtx.strokeStyle = "rgba(255,255,255,0.10)";
      stripCtx.lineWidth = 1;
      stripCtx.strokeRect(cellX + 0.5, cellY + 0.5, cellWidth - 1, cellHeight - 1);
      stripCtx.drawImage(frame.source, drawX, drawY, drawWidth, drawHeight);
    }
    return strip;
  }

  async function collectPreviewStripFramesFromImages(images: readonly HTMLImageElement[]): Promise<{ source: CanvasImageSource; width: number; height: number }[]> {
    const frames: { source: CanvasImageSource; width: number; height: number }[] = [];
    for (const image of images) {
      const decoded = await ensurePreviewImageReady(image);
      if (!decoded) continue;
      frames.push({
        source: decoded,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight,
      });
    }
    return frames;
  }

  function frameSelectorOutputCount(node: ComfyNode): number {
    return Math.max(0, getFrameSelectorOutputCount(node));
  }

  async function collectPreviewStripFramesFromRenderer(upstreamNode: ComfyNode | null, outputSlot: number | null, renderCanvasSize: number): Promise<{ frames: { source: CanvasImageSource; width: number; height: number }[]; frameCount: number }> {
    if (!upstreamNode || String(upstreamNode.comfyClass ?? "") !== "ImageOpsFrameRange") {
      return { frames: [], frameCount: 0 };
    }
    const totalFrames = frameSelectorOutputCount(upstreamNode);
    if (totalFrames <= 0) return { frames: [], frameCount: 0 };

    const thumbCanvasSize = Math.max(128, Math.min(256, renderCanvasSize));
  const sampleCount = Math.max(1, totalFrames);
    const frames: { source: CanvasImageSource; width: number; height: number }[] = [];

    for (let index = 0; index < sampleCount; index++) {
      const sampleTick = sampleCount === 1 ? 0 : Math.round((index * Math.max(0, totalFrames - 1)) / Math.max(1, sampleCount - 1));
      const rendered = await renderer.render(upstreamNode, sampleTick, outputSlot, thumbCanvasSize);
      const canvas = rendered.canvas;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) continue;
      frames.push({
        source: canvas,
        width: canvas.width,
        height: canvas.height,
      });
    }

    return { frames, frameCount: totalFrames };
  }

  function isFrameSelectorFrozen(node: ComfyNode | null): boolean {
    if (!node || String(node.comfyClass ?? "") !== "ImageOpsFrameRange") return false;
    const frameHold = !!(node.widgets ?? []).find((widget) => widget?.name === "frame_hold")?.value;
    const repeat = !!(node.widgets ?? []).find((widget) => widget?.name === "repeat")?.value;
    const repeatMode = String((node.widgets ?? []).find((widget) => widget?.name === "repeat_mode")?.value ?? "").toLowerCase();
    return frameHold || (repeat && repeatMode === "freeze");
  }

  function findFrozenFrameSelectorUpstream(node: ComfyNode): ComfyNode | null {
    const seen = new Set<number>();
    const queue: ComfyNode[] = [...getUpstreamNodes(node)];
    while (queue.length) {
      const cur = queue.shift()!;
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (isFrameSelectorFrozen(cur)) return cur;
      queue.push(...getUpstreamNodes(cur));
    }
    return null;
  }

  async function resolvePreviewStripCanvas(node: ComfyNode, upstreamNode: ComfyNode | null, renderCanvasSize: number): Promise<{ canvas: HTMLCanvasElement; source: "native" | "upstream"; frameCount: number } | null> {
    const ownImages = (node.imgs ?? []).filter((image): image is HTMLImageElement => image instanceof HTMLImageElement);
    if (ownImages.length === 1) {
      const readyOwn = await ensurePreviewImageReady(ownImages[0]);
      if (readyOwn) {
        const strip = document.createElement("canvas");
        strip.width = Math.max(1, readyOwn.naturalWidth);
        strip.height = Math.max(1, readyOwn.naturalHeight);
        const stripCtx = strip.getContext("2d", { willReadFrequently: true });
        if (stripCtx) {
          stripCtx.drawImage(readyOwn, 0, 0, strip.width, strip.height);
          return { canvas: strip, source: "native", frameCount: 1 };
        }
      }
    }

    const upstreamImages = (upstreamNode?.imgs ?? []).filter((image): image is HTMLImageElement => image instanceof HTMLImageElement);
    const upstreamFrames = await collectPreviewStripFramesFromImages(upstreamImages);
    if (upstreamFrames.length > 0) {
      const strip = await buildPreviewStripCanvas(upstreamFrames, renderCanvasSize);
      if (strip) return { canvas: strip, source: "upstream", frameCount: upstreamImages.length };
    }

    const renderedStrip = await collectPreviewStripFramesFromRenderer(upstreamNode, 0, renderCanvasSize);
    if (renderedStrip.frames.length > 0) {
      const strip = await buildPreviewStripCanvas(renderedStrip.frames, renderCanvasSize);
      if (strip) return { canvas: strip, source: "upstream", frameCount: renderedStrip.frameCount };
    }

    return null;
  }

  async function renderPreviewBridgeNode(node: ComfyNode, tick: number): Promise<void> {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const renderCanvasSize = getRenderCanvasSize(st);

    const imageIndex = getInputIndexByName(node, "image");
    const maskIndex = getInputIndexByName(node, "mask");
    const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();
    const mode = widgetString(node, "mode", "images").toLowerCase();

    let imageCanvas: HTMLCanvasElement | null = null;
    let maskCanvas: HTMLCanvasElement | null = null;
    let imageFromNodeStream = false;
    let maskFromNodeStream = false;
    let imageUpstreamNode: ComfyNode | null = null;
    let maskUpstreamNode: ComfyNode | null = null;

    if (imageIndex >= 0) {
      const imageUpstream = getUpstreamNode(node, imageIndex);
      imageUpstreamNode = imageUpstream;
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
      maskUpstreamNode = maskUpstream;
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
    const chosenTarget = previewTarget === "mask" || (!imageCanvas && maskCanvas) ? "mask" : "image";

    if (mode === "strip") {
      const stripSourceNode = chosenTarget === "mask" ? maskUpstreamNode : imageUpstreamNode;
      const strip = await resolvePreviewStripCanvas(node, stripSourceNode, renderCanvasSize);
      if (strip?.canvas) {
        blit(node, st, strip.canvas, renderCanvasSize, strip.canvas.width, strip.canvas.height);
        syncPreviewWidgets(node);
        setInfo(
          st,
          strip.source === "native"
            ? "Preview bridge (batch)"
            : `Preview bridge (batch, ${strip.frameCount}f)`,
        );
        return;
      }
    }

    if (!chosen) {
      setInfo(st, "Preview bridge: connect image or mask");
      return;
    }

    const chosenUpstream = chosenTarget === "mask" ? maskUpstreamNode : imageUpstreamNode;
    const chosenSource = chosenUpstream ? detectSourceUpstream(chosenUpstream) : null;
    const chosenSize = chosenUpstream ? resolveNodeIntrinsicMediaSize(chosenUpstream, chosen) : { width: chosen.width || 1, height: chosen.height || 1 };
    blit(node, st, chosen, renderCanvasSize, chosenSize.width, chosenSize.height);
    syncPreviewWidgets(node);
    if (previewTarget === "mask" || (!imageCanvas && maskCanvas)) {
      setInfo(st, maskFromNodeStream ? "Preview bridge (mask, nodestream)" : "Preview bridge (mask)");
    } else if (chosenSource?.kind === "video") {
      setInfo(st, imageFromNodeStream ? "Preview bridge (video, nodestream)" : "Preview bridge (video)");
    } else if (imageCanvas) {
      setInfo(st, imageFromNodeStream ? "Preview bridge (image, nodestream)" : "Preview bridge (image)");
    } else {
      setInfo(st, "Preview bridge");
    }
  }

  function getPrimaryOverlaySourceNode(node: ComfyNode): ComfyNode | null {
    if (isJoinNode(node)) return node;

    if (isPreviewNode(node)) {
      const previewTarget = String((node?.widgets ?? []).find((widget) => widget?.name === "preview_target")?.value ?? "auto").toLowerCase();
      const imageIndex = getInputIndexByName(node, "image");
      const maskIndex = getInputIndexByName(node, "mask");
      const imageUpstream = imageIndex >= 0 ? getUpstreamNode(node, imageIndex) : null;
      const maskUpstream = maskIndex >= 0 ? getUpstreamNode(node, maskIndex) : null;
      if (previewTarget === "mask") return maskUpstream ?? imageUpstream;
      if (previewTarget === "image") return imageUpstream ?? maskUpstream;
      return imageUpstream ?? maskUpstream;
    }

    const adapter = registry.pick(node);
    const adapterInputIndexes = adapter
      ? ((typeof adapter.inputIndexes === "function")
        ? adapter.inputIndexes(node)
        : (adapter.inputIndexes ?? []))
      : [];
    const resolvedIndexes = adapterInputIndexes.length > 0
      ? adapterInputIndexes
      : (node.inputs ?? [])
        .map((input, index) => ((input?.link ?? null) != null ? index : -1))
        .filter((index) => index >= 0);

    for (const inputIndex of resolvedIndexes) {
      const upstream = getUpstreamNode(node, inputIndex);
      if (upstream) return upstream;
    }

    return null;
  }

  function getPreviewFrameIndex(node: ComfyNode, tick: number): number {
    const frameIndex = Math.max(0, Math.round(tick || 0));
    const overlayFrameCount = isJoinNode(node)
      ? getJoinPreviewFrameCount(node)
      : getPreviewNodeFrameCount(getPrimaryOverlaySourceNode(node) ?? node);
    return overlayFrameCount > 0 ? frameIndex % overlayFrameCount : frameIndex;
  }

  function renderNode(node: ComfyNode, tick: number = 0): void {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    st.previewFrameIndex = getPreviewFrameIndex(node, tick);
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
      // retry the same state - prevents a spin-on-error loop.
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
        const sourceSize = resolveNodeIntrinsicMediaSize(upstream, result.canvas);
        blit(node, st, result.canvas, renderCanvasSize, sourceSize.width, sourceSize.height);
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
      const connected: Array<{ slot: string; layerNumber: number; inputIndex: number; image: HTMLCanvasElement; mask: HTMLCanvasElement | null; sourceWidth: number; sourceHeight: number }> = [];
      Promise.all(slots.map(async (slot) => {
        const upstream = getUpstreamNode(node, slot.inputIndex);
        if (!upstream) return null;
        const result = await renderer.render(upstream, tick, getInputOriginSlot(node, slot.inputIndex), renderCanvasSize);
        if (!result?.canvas) return null;
        const sourceSize = resolveNodeIntrinsicMediaSize(upstream, result.canvas);
        let mask: HTMLCanvasElement | null = null;
        if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
          mask = await renderMaskInputForComp(node, slot.maskInputIndex, tick, session);
        }
        return { slot: slot.slot, layerNumber: slot.layerNumber, inputIndex: slot.inputIndex, image: result.canvas, mask, sourceWidth: sourceSize.width, sourceHeight: sourceSize.height };
      })).then((resolved) => {
        const ordered = resolved.filter((entry): entry is { slot: string; layerNumber: number; inputIndex: number; image: HTMLCanvasElement; mask: HTMLCanvasElement | null; sourceWidth: number; sourceHeight: number } => !!entry);
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
      let sourceWidth = result.canvas.width || 1;
      let sourceHeight = result.canvas.height || 1;
      const primaryUpstream = getUpstreamNode(node, 0);
      if (primaryUpstream && (isCornerPinNode(node) || isPadOutNode(node))) {
        const upstreamSize = resolveNodeIntrinsicMediaSize(primaryUpstream, result.canvas);
        if (isPadOutNode(node)) {
          const padLeft = Math.max(0, Math.round(widgetNumber(node, "pad_left", 0)));
          const padTop = Math.max(0, Math.round(widgetNumber(node, "pad_top", 0)));
          const padRight = Math.max(0, Math.round(widgetNumber(node, "pad_right", 0)));
          const padBottom = Math.max(0, Math.round(widgetNumber(node, "pad_bottom", 0)));
          sourceWidth = upstreamSize.width + padLeft + padRight;
          sourceHeight = upstreamSize.height + padTop + padBottom;
        } else {
          sourceWidth = upstreamSize.width;
          sourceHeight = upstreamSize.height;
        }
      }
      blit(node, st, result.canvas, renderCanvasSize, sourceWidth, sourceHeight);
      if (isCornerPinNode(node)) {
        setInfo(st, getCornerPinInfoText(node, sourceWidth, sourceHeight));
      } else if (isTextNode(node)) {
        setInfo(st, getTextInfoText(node));
      } else if (isRampNode(node)) {
        setInfo(st, getRampInfoText(node));
      } else if (isGrainNode(node)) {
        setInfo(st, getGrainInfoText(node));
      } else if (isConstantNode(node)) {
        setInfo(st, getConstantInfoText(node));
      } else if (isPadOutNode(node)) {
        setInfo(st, getPadOutInfoText(node, sourceWidth, sourceHeight));
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

    const frozenFrameSelector = isFrameSelectorFrozen(node)
      ? node
      : findFrozenFrameSelectorUpstream(node);
    if (frozenFrameSelector) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }

    const nativeImg = getNativePreviewImage(node);
    if (nativeImg && !st.nativeAnimated && !isCropNode(node)) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }

    const src = detectSourceUpstream(node);
    const upstreamProcedural = findUpstreamProceduralNode(node);
    const joinHasMultipleInputs = isJoinNode(node) && getJoinSlots(node).filter((slot) => (node.inputs ?? []).some((input) => input?.name === `image_${slot}` && (input.link ?? null) != null)).length > 1;
    if (!joinHasMultipleInputs && (!src || (src.kind !== "video" && !src.animated)) && !st.nativeAnimated && !hasProceduralAnimation(node) && !upstreamProcedural) {
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
      } else if (isFrameSelectorNode(node)) {
        // FrameRange uses tick as a frame index and must advance at the source video FPS,
        // not at the RAF rate (60fps), otherwise playback runs at 60/videoFps times speed.
        // Re-read fps each tick so force_rate widget changes apply immediately.
        const videoFps = getFrameSelectorUpstreamFps(node);
        const effectiveFps = videoFps > 0 ? videoFps : 24;
        tick = Math.floor(((performance.now() - startedAt) * effectiveFps) / 1000);
      } else if (isJoinNode(node)) {
        const connectedSlots = getJoinSlots(node).filter((slot) => (node.inputs ?? []).some((input) => input?.name === `image_${slot}` && (input.link ?? null) != null));
        const firstSlot = connectedSlots[0] ?? 1;
        const firstInputIndex = (node.inputs ?? []).findIndex((input) => input?.name === `image_${firstSlot}`);
        const videoFps = firstInputIndex >= 0 ? getUpstreamVideoFps(node, firstInputIndex) : 0;
        const effectiveFps = videoFps > 0 ? videoFps : 24;
        tick = Math.floor(((performance.now() - startedAt) * effectiveFps) / 1000);
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
    const deps = findDependents(changedNode, (n) => isImageOpsClass(n.comfyClass));
    // Also clear the cache of changedNode itself (upstream source may have changed widget value)
    if ((changedNode as any).__imageops_media?.staticRenderCache) {
      (changedNode as any).__imageops_media.staticRenderCache.clear();
    }
    for (const n of deps) {
      const nst = ensureState(n);
      nst.nativeDirty = true;
      // Clear the persistent render cache so the renderer re-fetches from the new upstream image
      if ((n as any).__imageops_media?.staticRenderCache) {
        (n as any).__imageops_media.staticRenderCache.clear();
      }
      if (isJoinNode(n)) {
        syncJoinControls(n, nodeCtx);
      }
      if (!nst.rafId) {
        // RAF loop not running: start it (also handles image-to-video source type change).
        // startLoopIfVideo schedules a render internally.
        startLoopIfVideo(n);
      } else {
        // RAF loop already running: do NOT restart (restarting resets tick and breaks
        // animation sync for procedural nodes like Noise/Grain/CameraShake).
        // The running loop picks up upstream changes on the next frame automatically.
        // A tick-0 render is still needed to flush the cleared static cache.
        schedule(n, () => renderNode(n, 0), 0);
      }
    }
  }

  function hookNode(node: ComfyNode): void {

    // Node 2.0 instances may not expose the legacy comfyClass field. Keep the
    // rest of the preview host on one stable class-name contract.
    const nodeAny = node as any;
    if (!nodeAny.comfyClass) {
      nodeAny.comfyClass = nodeAny.type
        ?? nodeAny.constructor?.nodeData?.name
        ?? nodeAny.constructor?.nodeData?.id
        ?? nodeAny.constructor?.comfyClass
        ?? "";
    }

    const st = ensureState(node);
    if (st.hooked) return;
    st.hooked = true;
    st._abortController = new AbortController();

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
      try { (st as any)._layoutObserverCleanup?.(); } catch {}
      try { (st as any)._displayObserverCleanup?.(); } catch {}
      // Trigger AbortController-based cleanups, if any interaction module attached one.
      try { (st as any)._abortController?.abort(); } catch {}
      // Release video element and ImageBitmap GPU memory immediately.
      try { disposeMediaState(node); } catch (e) { console.warn("[ImageOps] disposeMediaState threw", e); }
      return r;
    };

    deduplicateColorWidgets(node);

    if (isCropNode(node)) {
      hideCropGeometryWidgets(node);
      syncCropWidgets(node);
    }
    if (isConstantNode(node)) {
      hideConstantWidgets(node);
      syncConstantWidgets(node);
    }
    if (isGrainNode(node)) {
      hideGrainWidgets(node);
      syncGrainWidgets(node);
    }
    if (isTextNode(node)) {
      hideTextWidgets(node);
      syncTextWidgets(node);
    }
    if (isRampNode(node)) {
      hideRampWidgets(node);
      syncRampWidgets(node);
    }
    if (isDrawNode(node)) {
      hideDrawWidgets(node);
      syncDrawWidgets(node);
    }
    if (isTransformNode(node)) {
      hideTransformWidgets(node);
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
    if (isJoinNode(node)) {
      ensureJoinInputs(node, 2);
      hideJoinWidgets(node);
      syncJoinControls(node, nodeCtx);
    }
    if (isPreviewNode(node)) {
      hidePreviewWidgets(node);
      syncPreviewWidgets(node);
    }
    if (isFrameSelectorNode(node)) {
      syncFrameSelectorWidgets(node);
    }
    if (isKeyerNode(node)) {
      hideKeyerWidgets(node);
      syncKeyerWidgets(node);
    }
    if (isPadOutNode(node)) {
      hidePadOutWidgets(node);
    }

    const syncLateWidgetMirrors = (): void => {
      try {
        if (isConstantNode(node)) syncConstantWidgets(node);
        if (isTextNode(node)) syncTextWidgets(node);
        if (isRampNode(node)) syncRampWidgets(node);
        if (isDrawNode(node)) syncDrawWidgets(node);
        if (isKeyerNode(node)) syncKeyerWidgets(node);
      } catch (e) {
        console.warn("[ImageOps] late widget sync failed for", node?.comfyClass, e);
      }
    };
    setTimeout(syncLateWidgetMirrors, 0);
    setTimeout(syncLateWidgetMirrors, 100);

    if (isImageOpsClass(node.comfyClass)) {
      node.previewMediaType = "image";
      ensurePreviewWidget(node, progress, canvasSize, () => nodeCtx.refreshNode(node));
      bindDefaultResetButton(node);
      attachPreviewNavigation(node, canvasSize);
      if (isPreviewNode(node)) {
        attachPreviewInteractionsExt(node, nodeCtx);
      }
      if (isConstantNode(node)) {
        attachConstantInteractionsExt(node, nodeCtx);
      }
      if (isGrainNode(node)) {
        attachGrainInteractionsExt(node, nodeCtx);
      }
      if (isTextNode(node)) {
        attachTextInteractionsExt(node, nodeCtx);
      }
      if (isRampNode(node)) {
        attachRampInteractionsExt(node, nodeCtx);
      }
      if (isFrameSelectorNode(node)) {
        attachFrameSelectorControls(node, nodeCtx);
      }
      if (isKeyerNode(node)) {
        attachKeyerControls(node, nodeCtx);
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
      if (isJoinNode(node)) {
        attachJoinInteractionsExt(node, nodeCtx);
      }
      if (isPadOutNode(node)) {
        attachPadOutControls(node, nodeCtx);
        hydratePadOutTargetFormat(node);
        syncPadOutControls(node);
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
          syncCompWidgets(node, w.name);
          updateCompControls(node);
        }
        if (isPreviewNode(node)) {
          syncPreviewWidgets(node);
        }
        if (isConstantNode(node)) {
          syncConstantWidgets(node, w.name);
        }
        if (isGrainNode(node)) {
          syncGrainWidgets(node);
        }
        if (isTextNode(node)) {
          syncTextWidgets(node);
        }
        if (isRampNode(node)) {
          syncRampWidgets(node);
        }
        if (isFrameSelectorNode(node)) {
          syncFrameSelectorWidgets(node);
        }
        if (isKeyerNode(node)) {
          syncKeyerWidgets(node);
        }
        if (isPadOutNode(node)) {
          if (w.name === "aspect_ratio") {
            (st as any).padOutRatioHydrated = false;
            hydratePadOutTargetFormat(node);
          } else if (w.name === "snap_to_multiple") {
            const targetFormat = widgetString(node, "aspect_ratio", "custom");
            if (targetFormat !== "custom") applyPadOutTargetFormat(node, targetFormat);
          }
          syncPadOutControls(node);
        }
        // Use 0ms delay when RAF loop is stopped (frozen FrameRange, static nodes) for
        // instant visual feedback. Use full debounce when the loop is already running -
        // it will pick up widget changes on the next tick automatically.
        const loopRunning = !!st.rafId;
        schedule(node, () => {
          if (isImageOpsClass(node.comfyClass)) startLoopIfVideo(node);
          refreshDependents(node);
        }, loopRunning ? cfg.debounceMs : 0);
        return r;
      };
    }

    const chainCb = (prop: "onConnectionsChange" | "onConfigure"): void => {
      const orig = node[prop];
      (node as any)[prop] = function (this: any) {
        if (prop === "onConfigure") {
          try { st._abortController?.abort(); } catch {}
          st._abortController = new AbortController();
          st.previewNavigationHooked = false;
          (st as any).previewNavigationCanvas = null;
        }
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
        if (isConstantNode(node) && prop === "onConfigure") {
          hideConstantWidgets(node);
          attachConstantInteractionsExt(node, nodeCtx);
          syncConstantWidgets(node);
        }
        if (isGrainNode(node) && prop === "onConfigure") {
          hideGrainWidgets(node);
          attachGrainInteractionsExt(node, nodeCtx);
          syncGrainWidgets(node);
        }
        if (isTextNode(node) && prop === "onConfigure") {
          hideTextWidgets(node);
          attachTextInteractionsExt(node, nodeCtx);
          syncTextWidgets(node);
        }
        if (isRampNode(node) && prop === "onConfigure") {
          hideRampWidgets(node);
          st.rampGeometry = null;
          st.rampDrag = null;
          st.rampInteractiveHooked = false;
          attachRampInteractionsExt(node, nodeCtx);
          syncRampWidgets(node);
        }
        if (isKeyerNode(node) && prop === "onConfigure") {
          hideKeyerWidgets(node);
          syncKeyerWidgets(node);
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
          syncCompWidgets(node);
          st.compInteractiveHooked = false;
          (st as any).compKeyboardHooked = false;
          attachCompInteractionsExt(node, compCtx);
          updateCompControls(node);
        }
        if (isJoinNode(node)) {
          if (prop === "onConfigure") {
            ensureJoinInputs(node, 2);
            hideJoinWidgets(node);
            attachJoinInteractionsExt(node, nodeCtx);
          }
          syncJoinControls(node, nodeCtx);
        }
        if (isCornerPinNode(node) && prop === "onConfigure") {
          st.cornerPinInteractiveHooked = false;
          attachCornerPinInteractionsExt(node, nodeCtx);
        }
        if (isPadOutNode(node) && prop === "onConfigure") {
          hidePadOutWidgets(node);
          attachPadOutControls(node, nodeCtx);
          (st as any).padOutRatioHydrated = false;
          hydratePadOutTargetFormat(node);
          syncPadOutControls(node);
          st.padOutInteractiveHooked = false;
          attachPadOutInteractionsExt(node, nodeCtx);
        }
        if (isPreviewNode(node) && prop === "onConfigure") {
          hidePreviewWidgets(node);
          attachPreviewInteractionsExt(node, nodeCtx);
          syncPreviewWidgets(node);
        }
        if (isFrameSelectorNode(node) && prop === "onConfigure") {
          // Re-hide widgets that onConfigure may restore - do NOT reset frameSelectorHooked
          // or re-call attachFrameSelectorControls (that would double the event listeners).
          hideFrameSelectorWidgets(node);
          syncFrameSelectorWidgets(node);
        }
        if (prop === "onConfigure" && isImageOpsClass(node.comfyClass)) {
          attachPreviewNavigation(node, canvasSize);
        }
        st.nativeDirty = true;
        if (isImageOpsClass(node.comfyClass)) startLoopIfVideo(node);
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
      if (isPadOutNode(node)) {
        const src = message?.imageops_padout_source?.[0] ?? message?.imageops_padout_source ?? null;
        if (src && typeof src === "object") {
          st.padOutBackendSourceW = Math.max(0, Math.round(Number(src.source_w) || 0));
          st.padOutBackendSourceH = Math.max(0, Math.round(Number(src.source_h) || 0));
          st.padOutBackendPadL    = Math.max(0, Math.round(Number(src.pad_left) || 0));
          st.padOutBackendPadT    = Math.max(0, Math.round(Number(src.pad_top)  || 0));
        }
      }
      if (isFrameSelectorNode(node)) {
        const count = message?.imageops_frame_range_source_count?.[0];
        if (typeof count === "number" && count > 0) {
          st.frameSelectorSourceCount = Math.round(count);
          syncFrameSelectorWidgets(node);
        }
      }
      if (isJoinNode(node)) {
        const count = message?.imageops_append_frame_count?.[0] ?? message?.imageops_join_frame_count?.[0];
        if (typeof count === "number" && count > 0) {
          (st as any).joinFrameCount = Math.round(count);
        }
        const clipCounts = message?.imageops_append_clip_counts?.[0];
        if (Array.isArray(clipCounts)) {
          (st as any).joinBackendClipCounts = clipCounts;
        }
        if ((typeof count === "number" && count > 0) || Array.isArray(clipCounts)) {
          syncJoinControls(node, nodeCtx);
        }
      }
      st.nativeDirty = false;
      st.lastKey = null;
      st.lastRenderTick = null;
      schedule(node, () => {
        if (isImageOpsClass(node.comfyClass)) startLoopIfVideo(node);
        refreshDependents(node);
      }, 0);
      return r;
    };
  }

  app.registerExtension({
    name: EXT_NAME,
    async beforeRegisterNodeDef(nodeType: ComfyNodeConstructor, nodeData: any) {
      const nodeName = nodeData?.name ?? nodeData?.id ?? nodeData?.class_type ?? nodeData?.comfyClass ?? "";
      if (!isImageOpsClass(nodeName)) return;
      const origOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function (this: ComfyNode) {
        try { origOnNodeCreated?.apply(this, arguments as any); } catch (e) { console.warn("[ImageOps] origOnNodeCreated threw", e); }
        try { hydrateKeyerDefaults(this, nodeData); } catch (e) { console.warn("[ImageOps] hydrateKeyerDefaults failed for", this?.comfyClass, e); }
        try { hookNode(this); } catch (e) { console.warn("[ImageOps] hookNode failed for", this?.comfyClass, e); }
      };
    },
    // Node 2.0 fallback: called per-instance after the node is fully constructed.
    nodeCreated(node: ComfyNode) {
      try {
        const ctor = node?.constructor as { nodeData?: any } | undefined;
        hydrateKeyerDefaults(node, ctor?.nodeData);
      } catch (e) {
        console.warn("[ImageOps] hydrateKeyerDefaults (nodeCreated) failed for", node?.comfyClass, e);
      }
      try { hookNode(node); } catch (e) { console.warn("[ImageOps] hookNode (nodeCreated) failed for", node?.comfyClass, e); }
    },
  } as any);
}

// ComfyUI discovers every JavaScript file below WEB_DIRECTORY. Register from
// this module directly so extension ordering cannot make the dynamic entrypoint
// arrive after node definitions have already been created.
registerImageOpsLivePreview();
