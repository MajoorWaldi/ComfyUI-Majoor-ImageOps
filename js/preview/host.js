import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { buildRenderer } from "./renderer.js";
import { buildAdapterRegistry } from "./registry.js";
import { detectSourceUpstream, getInputOriginSlot, getUpstreamNode, getUpstreamNodes, isGraphTooLarge, findDependents } from "./graph.js";
import { resolveNodeStreamPreview } from "./nodestream.js";
import { disposeMediaState, resolveNodeIntrinsicMediaSize } from "./source.js";
import { attachProgressBus } from "./progress.js";
import { getPreviewConfig } from "./config.js";
import { initOpsConstants } from "./constants.js";
import { getCompSlots } from "./comp.js";
import { renderCompPreview } from "./ops.js";
import { findWidget, hideCompactUiWidgets, resetNodeWidgetsToDefaults, setWidgetStringValue, widgetNumber, widgetString } from "./shared/widgets.js";
import { getProceduralFrameCount, hasProceduralAnimation, getProceduralPlaybackFps } from "./shared/animation.js";
import { getInputIndexByName, getNativePreviewImage } from "./shared/media.js";
import { isImageOpsClass, isImageOpsNativeUiClass } from "./shared/classes.js";
import { isNode as isPreviewNode, hidePreviewWidgets, syncPreviewWidgets } from "./nodes/preview.js";
import { isNode as isConstantNode, getConstantInfoText, hideConstantWidgets, syncConstantWidgets } from "./nodes/constant.js";
import { isNode as isGrainNode, getGrainInfoText, hideGrainWidgets, syncGrainWidgets } from "./nodes/grain.js";
import { isNode as isRampNode, getRampInfoText, hideRampWidgets, syncRampWidgets } from "./nodes/ramp.js";
import { isNode as isTextNode, getTextInfoText, hideTextWidgets, syncTextWidgets } from "./nodes/text.js";
import { isNode as isFrameSelectorNode, attachFrameSelectorControls, getFrameSelectorOutputCount, getUpstreamFps as getFrameSelectorUpstreamFps, hideFrameSelectorWidgets, syncFrameSelectorWidgets } from "./nodes/frame-range.js";
import { isNode as isKeyerNode, attachKeyerControls, hideKeyerWidgets, syncKeyerWidgets } from "./nodes/keyer.js";
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
  getCompInfoText
} from "./nodes/comp.js";
import { isNode as isCornerPinNode, getCornerPinInfoText } from "./nodes/corner-pin.js";
import { applyPadOutTargetFormat, attachPadOutControls, getPadOutInfoText, hidePadOutWidgets, hydratePadOutTargetFormat, isNode as isPadOutNode, syncPadOutControls } from "./nodes/pad-out.js";
import { isNode as isJoinNode, ensureJoinInputs, hideJoinWidgets, getJoinPreviewFrameCount, getJoinSlots, getPreviewNodeFrameCount } from "./nodes/append.js";
import { ensureState, setInfo, schedule, stopRAF, markPreviewInteraction, getRenderCanvasSize, buildPreviewRenderKey } from "./shared/state.js";
import { markCanvasDirty } from "./shared/canvas.js";
import { noteFrame } from "./shared/fps-monitor.js";
import { ensurePreviewWidget, getNodePreviewMinHeight, getNodePreviewTargetSize, syncCompactNativeWidgetControls } from "./shared/preview-widget.js";
import { blit, tryRenderNativePreview } from "./shared/bounds.js";
import { attachPreviewNavigation } from "./shared/navigation.js";
import {
  renderDrawNode,
  setDrawTool,
  ensureDrawInteractionReady,
  renderMaskCanvasFromNode,
  renderMaskInputForComp,
  deriveMaskCanvasFromCanvas,
  cloneCanvas,
  restoreCanvas,
  pushDrawUndoSnapshot,
  popDrawUndoSnapshot,
  paintDrawSegment,
  ensureDrawCanvasSize,
  drawPointerDynamics,
  setDrawBrushSize
} from "./nodes/draw-renderer.js";
import { attachInteractions as attachColorCorrectInteractionsExt } from "./interactions/color-correct.js";
import { attachInteractions as attachConstantInteractionsExt } from "./interactions/constant.js";
import { attachInteractions as attachGrainInteractionsExt } from "./interactions/grain.js";
import { attachInteractions as attachRampInteractionsExt } from "./interactions/ramp.js";
import { attachInteractions as attachTextInteractionsExt } from "./interactions/text.js";
import { attachInteractions as attachCornerPinInteractionsExt } from "./interactions/corner-pin.js";
import { attachInteractions as attachPadOutInteractionsExt } from "./interactions/pad-out.js";
import { attachInteractions as attachPreviewInteractionsExt } from "./interactions/preview.js";
import { attachInteractions as attachCropInteractionsExt } from "./interactions/crop.js";
import { attachInteractions as attachDrawInteractionsExt } from "./interactions/draw.js";
import { attachInteractions as attachCompInteractionsExt } from "./interactions/comp.js";
import { attachInteractions as attachJoinInteractionsExt, syncJoinControls } from "./interactions/append.js";
console.info("[ImageOps] LivePreview v6 loaded");
const EXT_NAME = "ImageOps.LivePreview.v6";
function getNodeInputDefault(nodeData, inputName) {
  const entry = nodeData?.input?.required?.[inputName] ?? nodeData?.input?.optional?.[inputName];
  if (!Array.isArray(entry)) return void 0;
  const options = entry[1];
  return options && typeof options === "object" ? options.default : void 0;
}
function hydrateKeyerDefaults(node, nodeData) {
  if (!isKeyerNode(node)) return;
  const keyColorWidget = findWidget(node, "key_color");
  if (!keyColorWidget) return;
  const defaultKeyColor = getNodeInputDefault(nodeData, "key_color");
  if (typeof defaultKeyColor !== "string" || !defaultKeyColor) return;
  if (String(keyColorWidget.value ?? "").toLowerCase() === "#000000" && defaultKeyColor.toLowerCase() !== "#000000") {
    setWidgetStringValue(keyColorWidget, defaultKeyColor);
  }
}
function registerImageOpsLivePreview() {
  initOpsConstants();
  const cfg = getPreviewConfig();
  const canvasSize = cfg.canvasSize;
  const registry = buildAdapterRegistry();
  const renderer = buildRenderer({ api, registry, canvasSize });
  const progress = attachProgressBus(api);
  const session = { renderer, progress, canvasSize };
  const nodeCtx = {
    schedule,
    markCanvasDirty,
    startLoopIfVideo(node) {
      startLoopIfVideo(node);
    },
    refreshDependents(node) {
      refreshDependents(node);
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
    }
  };
  const cropCtx = {
    ...nodeCtx,
    setCropOutputDimensions
  };
  function bindDefaultResetButton(node) {
    const st = ensureState(node);
    const button = st.nodeResetButton;
    if (!button || st.nodeResetHooked) return;
    st.nodeResetHooked = true;
    button.addEventListener("click", (event) => {
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
        st.padOutRatioHydrated = false;
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
      if (isImageOpsNativeUiClass(node.comfyClass)) {
        syncCompactNativeWidgetControls(node);
      }
      if (isCompNode(node)) {
        syncCompactNativeWidgetControls(node);
      }
      if (isCornerPinNode(node) || isPadOutNode(node) || isRampNode(node)) {
        if (st.canvas) st.canvas.style.cursor = "default";
      }
      nodeCtx.refreshNode(node);
    });
  }
  const drawCtx = {
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
    setDarkColorInputState
  };
  const compCtx = {
    ...nodeCtx,
    markPreviewInteraction,
    ensureCompState,
    updateCompControls,
    updateSelectedCompLayer,
    compCanvasToOutputPoint,
    getCompHit,
    writeCompLayerCorners
  };
  async function ensurePreviewImageReady(image) {
    if (!(image instanceof HTMLImageElement)) return null;
    if ((!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) && image.decode) {
      try {
        await image.decode();
      } catch {
      }
    }
    if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) return null;
    return image;
  }
  async function buildPreviewStripCanvas(frames, renderCanvasSize) {
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
    const avgAspect = frames.reduce((sum, frame) => sum + frame.width / Math.max(1, frame.height), 0) / Math.max(1, frames.length);
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
  async function collectPreviewStripFramesFromImages(images) {
    const frames = [];
    for (const image of images) {
      const decoded = await ensurePreviewImageReady(image);
      if (!decoded) continue;
      frames.push({
        source: decoded,
        width: decoded.naturalWidth,
        height: decoded.naturalHeight
      });
    }
    return frames;
  }
  function frameSelectorOutputCount(node) {
    return Math.max(0, getFrameSelectorOutputCount(node));
  }
  async function collectPreviewStripFramesFromRenderer(upstreamNode, outputSlot, renderCanvasSize) {
    if (!upstreamNode || String(upstreamNode.comfyClass ?? "") !== "ImageOpsFrameRange") {
      return { frames: [], frameCount: 0 };
    }
    const totalFrames = frameSelectorOutputCount(upstreamNode);
    if (totalFrames <= 0) return { frames: [], frameCount: 0 };
    const thumbCanvasSize = Math.max(128, Math.min(256, renderCanvasSize));
    const sampleCount = Math.max(1, totalFrames);
    const frames = [];
    for (let index = 0; index < sampleCount; index++) {
      const sampleTick = sampleCount === 1 ? 0 : Math.round(index * Math.max(0, totalFrames - 1) / Math.max(1, sampleCount - 1));
      const rendered = await renderer.render(upstreamNode, sampleTick, outputSlot, thumbCanvasSize);
      const canvas = rendered.canvas;
      if (!canvas || canvas.width <= 0 || canvas.height <= 0) continue;
      frames.push({
        source: canvas,
        width: canvas.width,
        height: canvas.height
      });
    }
    return { frames, frameCount: totalFrames };
  }
  function isFrameSelectorFrozen(node) {
    if (!node || String(node.comfyClass ?? "") !== "ImageOpsFrameRange") return false;
    return !!(node.widgets ?? []).find((widget) => widget?.name === "frame_hold")?.value;
  }
  function findFrozenFrameSelectorUpstream(node) {
    const seen = /* @__PURE__ */ new Set();
    const queue = [...getUpstreamNodes(node)];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (isFrameSelectorFrozen(cur)) return cur;
      queue.push(...getUpstreamNodes(cur));
    }
    return null;
  }
  async function resolvePreviewStripCanvas(node, upstreamNode, renderCanvasSize) {
    const ownImages = (node.imgs ?? []).filter((image) => image instanceof HTMLImageElement);
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
    const upstreamImages = (upstreamNode?.imgs ?? []).filter((image) => image instanceof HTMLImageElement);
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
  async function renderPreviewBridgeNode(node, tick) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const renderCanvasSize = getRenderCanvasSize(st);
    const imageIndex = getInputIndexByName(node, "image");
    const maskIndex = getInputIndexByName(node, "mask");
    const previewTarget = widgetString(node, "preview_target", "auto").toLowerCase();
    const mode = widgetString(node, "mode", "images").toLowerCase();
    let imageCanvas = null;
    let maskCanvas = null;
    let imageFromNodeStream = false;
    let maskFromNodeStream = false;
    let imageUpstreamNode = null;
    let maskUpstreamNode = null;
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
    const chosen = previewTarget === "mask" ? maskCanvas ?? imageCanvas : previewTarget === "image" ? imageCanvas ?? maskCanvas : imageCanvas ?? maskCanvas;
    const chosenTarget = previewTarget === "mask" || !imageCanvas && maskCanvas ? "mask" : "image";
    if (mode === "strip") {
      const stripSourceNode = chosenTarget === "mask" ? maskUpstreamNode : imageUpstreamNode;
      const strip = await resolvePreviewStripCanvas(node, stripSourceNode, renderCanvasSize);
      if (strip?.canvas) {
        blit(node, st, strip.canvas, renderCanvasSize, strip.canvas.width, strip.canvas.height);
        syncPreviewWidgets(node);
        setInfo(
          st,
          strip.source === "native" ? "Preview bridge (batch)" : `Preview bridge (batch, ${strip.frameCount}f)`
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
    if (previewTarget === "mask" || !imageCanvas && maskCanvas) {
      setInfo(st, maskFromNodeStream ? "Preview bridge (mask, nodestream)" : "Preview bridge (mask)");
    } else if (chosenSource?.kind === "video") {
      setInfo(st, imageFromNodeStream ? "Preview bridge (video, nodestream)" : "Preview bridge (video)");
    } else if (imageCanvas) {
      setInfo(st, imageFromNodeStream ? "Preview bridge (image, nodestream)" : "Preview bridge (image)");
    } else {
      setInfo(st, "Preview bridge");
    }
  }
  function getPrimaryOverlaySourceNode(node) {
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
    const adapterInputIndexes = adapter ? typeof adapter.inputIndexes === "function" ? adapter.inputIndexes(node) : adapter.inputIndexes ?? [] : [];
    const resolvedIndexes = adapterInputIndexes.length > 0 ? adapterInputIndexes : (node.inputs ?? []).map((input, index) => (input?.link ?? null) != null ? index : -1).filter((index) => index >= 0);
    for (const inputIndex of resolvedIndexes) {
      const upstream = getUpstreamNode(node, inputIndex);
      if (upstream) return upstream;
    }
    return null;
  }
  function getPreviewFrameIndex(node, tick) {
    const frameIndex = Math.max(0, Math.round(tick || 0));
    const overlayFrameCount = isJoinNode(node) ? getJoinPreviewFrameCount(node) : getPreviewNodeFrameCount(getPrimaryOverlaySourceNode(node) ?? node);
    return overlayFrameCount > 0 ? frameIndex % overlayFrameCount : frameIndex;
  }
  function renderNode(node, tick = 0) {
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
    const finishRender = () => {
      st.renderInFlight = false;
      const queuedTick = st.queuedRenderTick;
      st.queuedRenderTick = null;
      if (queuedTick != null) {
        renderNode(node, queuedTick);
      }
    };
    const commitRender = () => {
      st.lastKey = renderKey;
      st.lastRenderTick = tick;
      st.nativeDirty = false;
    };
    const failRender = (message, error) => {
      setInfo(st, message);
      console.warn("[ImageOps] render error", error);
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
      renderer.render(upstream, tick, getInputOriginSlot(node, 0), renderCanvasSize).then((result) => {
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
      }).catch((err) => {
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
      const connected = [];
      Promise.all(slots.map(async (slot) => {
        const upstream = getUpstreamNode(node, slot.inputIndex);
        if (!upstream) return null;
        const result = await renderer.render(upstream, tick, getInputOriginSlot(node, slot.inputIndex), renderCanvasSize);
        if (!result?.canvas) return null;
        const sourceSize = resolveNodeIntrinsicMediaSize(upstream, result.canvas);
        let mask = null;
        if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
          mask = await renderMaskInputForComp(node, slot.maskInputIndex, tick, session);
        }
        return { slot: slot.slot, layerNumber: slot.layerNumber, inputIndex: slot.inputIndex, image: result.canvas, mask, sourceWidth: sourceSize.width, sourceHeight: sourceSize.height };
      })).then((resolved) => {
        const ordered = resolved.filter((entry) => !!entry);
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
    renderer.render(node, tick, null, renderCanvasSize).then((result) => {
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
    }).catch((err) => {
      failRender("Live preview error (check console)", err);
    });
  }
  function findUpstreamProceduralNode(node) {
    const seen = /* @__PURE__ */ new Set();
    const queue = [...getUpstreamNodes(node)];
    while (queue.length) {
      const cur = queue.shift();
      if (!cur || seen.has(cur.id)) continue;
      seen.add(cur.id);
      if (hasProceduralAnimation(cur)) return cur;
      queue.push(...getUpstreamNodes(cur));
    }
    return null;
  }
  function startLoopIfVideo(node) {
    const st = ensurePreviewWidget(node, progress, canvasSize);
    if (!st) return;
    const frozenFrameSelector = isFrameSelectorFrozen(node) ? node : findFrozenFrameSelectorUpstream(node);
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
    if (!joinHasMultipleInputs && (!src || src.kind !== "video" && !src.animated) && !st.nativeAnimated && !hasProceduralAnimation(node) && !upstreamProcedural) {
      stopRAF(st);
      schedule(node, () => renderNode(node, 0), 10);
      return;
    }
    let tick = 0;
    let lastLoopTick = null;
    const proceduralFrameCount = getProceduralFrameCount(node) ?? (upstreamProcedural ? getProceduralFrameCount(upstreamProcedural) : null);
    const hasProcedural = proceduralFrameCount != null;
    const startedAt = performance.now();
    const loop = () => {
      noteFrame(performance.now());
      if (hasProcedural) {
        const currentFps = getProceduralPlaybackFps(node) ?? (upstreamProcedural ? getProceduralPlaybackFps(upstreamProcedural) : null) ?? 12;
        const rawTick = Math.floor((performance.now() - startedAt) * currentFps / 1e3);
        tick = proceduralFrameCount != null && proceduralFrameCount > 0 ? rawTick % proceduralFrameCount : rawTick;
      } else if (isFrameSelectorNode(node)) {
        const videoFps = getFrameSelectorUpstreamFps(node);
        const effectiveFps = videoFps > 0 ? videoFps : 24;
        tick = Math.floor((performance.now() - startedAt) * effectiveFps / 1e3);
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
  function refreshDependents(changedNode) {
    const deps = findDependents(changedNode, (n) => isImageOpsClass(n.comfyClass));
    if (changedNode.__imageops_media?.staticRenderCache) {
      changedNode.__imageops_media.staticRenderCache.clear();
    }
    for (const n of deps) {
      const nst = ensureState(n);
      nst.nativeDirty = true;
      if (n.__imageops_media?.staticRenderCache) {
        n.__imageops_media.staticRenderCache.clear();
      }
      if (isJoinNode(n)) {
        syncJoinControls(n, nodeCtx);
      }
      if (!nst.rafId) {
        startLoopIfVideo(n);
      } else {
        schedule(n, () => renderNode(n, 0), 0);
      }
    }
  }
  function refreshDependentsSoon(changedNode) {
    refreshDependents(changedNode);
    for (const delayMs of [50, 250]) {
      setTimeout(() => {
        try {
          refreshDependents(changedNode);
        } catch (e) {
          console.warn("[ImageOps] delayed refreshDependents threw", e);
        }
      }, delayMs);
    }
  }
  function hookNode(node) {
    if (!isImageOpsClass(node.comfyClass)) {
      if (node.__imageops_hooked_ext) return;
      node.__imageops_hooked_ext = true;
      const origOnExecuted0 = node.onExecuted;
      node.onExecuted = function(message) {
        let r;
        try {
          r = origOnExecuted0?.apply(this, arguments);
        } catch (e) {
          console.warn("[ImageOps] upstream onExecuted threw", e);
        }
        try {
          refreshDependentsSoon(node);
        } catch (e) {
          console.warn("[ImageOps] refreshDependents threw", e);
        }
        return r;
      };
      for (const w of node.widgets ?? []) {
        if (w.callback != null && typeof w.callback !== "function") continue;
        const orig = w.callback;
        w.callback = function() {
          const r = orig?.apply(this, arguments);
          try {
            refreshDependentsSoon(node);
          } catch (e) {
            console.warn("[ImageOps] widget refreshDependents threw", e);
          }
          return r;
        };
        const element = w.element;
        if (element && !w.__imageops_dom_refresh_hooked) {
          w.__imageops_dom_refresh_hooked = true;
          element.addEventListener?.("change", () => {
            try {
              refreshDependentsSoon(node);
            } catch (e) {
              console.warn("[ImageOps] widget change refreshDependents threw", e);
            }
          });
        }
      }
      return;
    }
    const st = ensureState(node);
    if (st.hooked) return;
    st.hooked = true;
    st._abortController = new AbortController();
    const origOnRemoved = node.onRemoved;
    node.onRemoved = function() {
      let r;
      try {
        r = origOnRemoved?.apply(this, arguments);
      } catch (e) {
        console.warn("[ImageOps] origOnRemoved threw", e);
      }
      try {
        stopRAF(st);
      } catch {
      }
      if (st.debounceTimer != null) {
        try {
          clearTimeout(st.debounceTimer);
        } catch {
        }
        st.debounceTimer = null;
      }
      try {
        st._navWheelCleanup?.();
      } catch {
      }
      try {
        st._drawWheelCleanup?.();
      } catch {
      }
      try {
        st._layoutObserverCleanup?.();
      } catch {
      }
      try {
        st._displayObserverCleanup?.();
      } catch {
      }
      try {
        st._abortController?.abort();
      } catch {
      }
      try {
        disposeMediaState(node);
      } catch (e) {
        console.warn("[ImageOps] disposeMediaState threw", e);
      }
      return r;
    };
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
    const syncLateWidgetMirrors = () => {
      try {
        if (isConstantNode(node)) syncConstantWidgets(node);
        if (isTextNode(node)) syncTextWidgets(node);
        if (isRampNode(node)) syncRampWidgets(node);
        if (isDrawNode(node)) syncDrawWidgets(node);
        if (isKeyerNode(node)) syncKeyerWidgets(node);
        if (isImageOpsNativeUiClass(node.comfyClass) || isCompNode(node)) {
          hideCompactUiWidgets(node);
          syncCompactNativeWidgetControls(node);
        }
      } catch (e) {
        console.warn("[ImageOps] late widget sync failed for", node?.comfyClass, e);
      }
    };
    setTimeout(syncLateWidgetMirrors, 0);
    setTimeout(syncLateWidgetMirrors, 100);
    if (isImageOpsClass(node.comfyClass)) {
      node.previewMediaType = "image";
      ensurePreviewWidget(node, progress, canvasSize, () => nodeCtx.refreshNode(node));
      if (isImageOpsNativeUiClass(node.comfyClass) || isCompNode(node)) {
        hideCompactUiWidgets(node);
        syncCompactNativeWidgetControls(node);
      }
      node;
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
    for (const w of node.widgets ?? []) {
      if (typeof w.callback !== "function" && typeof w.callback !== "undefined") continue;
      const orig = w.callback;
      w.callback = function() {
        const r = orig?.apply(this, arguments);
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
          syncRampWidgets(node);
        }
        if (isFrameSelectorNode(node)) {
          syncFrameSelectorWidgets(node);
        }
        if (isKeyerNode(node)) {
          syncKeyerWidgets(node);
        }
        if (isPadOutNode(node)) {
          if (w.name === "target_format") {
            st.padOutRatioHydrated = false;
            hydratePadOutTargetFormat(node);
          } else if (w.name === "snap_to_multiple") {
            const targetFormat = widgetString(node, "target_format", "custom");
            if (targetFormat !== "custom") applyPadOutTargetFormat(node, targetFormat);
          }
          syncPadOutControls(node);
        }
        if (isImageOpsNativeUiClass(node.comfyClass) || isCompNode(node)) {
          syncCompactNativeWidgetControls(node);
        }
        const loopRunning = !!st.rafId;
        schedule(node, () => {
          if (isImageOpsClass(node.comfyClass)) startLoopIfVideo(node);
          refreshDependents(node);
        }, loopRunning ? cfg.debounceMs : 0);
        return r;
      };
    }
    const chainCb = (prop) => {
      const orig = node[prop];
      node[prop] = function() {
        if (prop === "onConfigure") {
          try {
            st._abortController?.abort();
          } catch {
          }
          st._abortController = new AbortController();
        }
        const r = orig?.apply(this, arguments);
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
        if (isTextNode(node) && (prop === "onConnectionsChange" || prop === "onConfigure")) {
          const textInputs = node?.inputs ?? [];
          const textSlotIdx = textInputs.findIndex((inp) => inp?.name === "text");
          if (textSlotIdx >= 0) {
            const textLink = textInputs[textSlotIdx]?.link;
            if (textLink != null) {
              const textLinkData = node?.graph?.links?.[textLink];
              if (textLinkData) {
                const upstreamNode = node?.graph?.getNodeById?.(textLinkData.origin_id);
                const upstreamWidget = (upstreamNode?.widgets ?? []).find((w) => typeof w?.value === "string");
                if (upstreamWidget) {
                  if (!Array.isArray(upstreamWidget.__imageopsTextRefreshNodes)) {
                    upstreamWidget.__imageopsTextRefreshNodes = [];
                    const _origUpCb = typeof upstreamWidget.callback === "function" ? upstreamWidget.callback : null;
                    upstreamWidget.callback = function() {
                      const r2 = _origUpCb?.apply(this, arguments);
                      for (const dn of upstreamWidget.__imageopsTextRefreshNodes) {
                        try {
                          nodeCtx.refreshNode(dn);
                        } catch {
                        }
                      }
                      return r2;
                    };
                  }
                  const refreshList = upstreamWidget.__imageopsTextRefreshNodes;
                  if (!refreshList.includes(node)) refreshList.push(node);
                }
              }
            }
          }
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
          st.compInteractiveHooked = false;
          st.compKeyboardHooked = false;
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
          st.padOutRatioHydrated = false;
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
          hideFrameSelectorWidgets(node);
          syncFrameSelectorWidgets(node);
        }
        if ((isImageOpsNativeUiClass(node.comfyClass) || isCompNode(node)) && prop === "onConfigure") {
          hideCompactUiWidgets(node);
          syncCompactNativeWidgetControls(node);
        }
        if (prop === "onConfigure" && isImageOpsClass(node.comfyClass)) {
          const minH = getNodePreviewMinHeight(node);
          setTimeout(() => {
            try {
              if (!isFrameSelectorNode(node)) {
                const cs = node.computeSize?.() ?? [360, minH];
                const root = ensureState(node).canvas?.parentElement;
                node.setSize?.(getNodePreviewTargetSize(node, root, Math.max(cs[0], 360)));
                node.graph?.setDirtyCanvas(true, true);
              }
            } catch {
            }
          }, 100);
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
    node.onExecuted = function(message) {
      const r = origExecuted?.apply(this, arguments);
      st.nativeAnimated = !!message?.animated?.[0];
      if (isPadOutNode(node)) {
        const src = message?.imageops_padout_source?.[0] ?? message?.imageops_padout_source ?? null;
        if (src && typeof src === "object") {
          st.padOutBackendSourceW = Math.max(0, Math.round(Number(src.source_w) || 0));
          st.padOutBackendSourceH = Math.max(0, Math.round(Number(src.source_h) || 0));
          st.padOutBackendPadL = Math.max(0, Math.round(Number(src.pad_left) || 0));
          st.padOutBackendPadT = Math.max(0, Math.round(Number(src.pad_top) || 0));
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
        const count = message?.imageops_join_frame_count?.[0];
        if (typeof count === "number" && count > 0) {
          st.joinFrameCount = Math.round(count);
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
    async beforeRegisterNodeDef(nodeType, nodeData) {
      const nodeName = nodeData?.name ?? nodeData?.id ?? nodeData?.class_type ?? nodeData?.comfyClass ?? "";
      if (!isImageOpsClass(nodeName)) return;
      const origOnNodeCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function() {
        try {
          origOnNodeCreated?.apply(this, arguments);
        } catch (e) {
          console.warn("[ImageOps] origOnNodeCreated threw", e);
        }
        try {
          hydrateKeyerDefaults(this, nodeData);
        } catch (e) {
          console.warn("[ImageOps] hydrateKeyerDefaults failed for", this?.comfyClass, e);
        }
        try {
          hookNode(this);
        } catch (e) {
          console.warn("[ImageOps] hookNode failed for", this?.comfyClass, e);
        }
      };
    },
    // Node 2.0 fallback: called per-instance after the node is fully constructed.
    nodeCreated(node) {
      try {
        const ctor = node?.constructor;
        hydrateKeyerDefaults(node, ctor?.nodeData);
      } catch (e) {
        console.warn("[ImageOps] hydrateKeyerDefaults (nodeCreated) failed for", node?.comfyClass, e);
      }
      try {
        hookNode(node);
      } catch (e) {
        console.warn("[ImageOps] hookNode (nodeCreated) failed for", node?.comfyClass, e);
      }
    }
  });
}
export {
  registerImageOpsLivePreview
};
