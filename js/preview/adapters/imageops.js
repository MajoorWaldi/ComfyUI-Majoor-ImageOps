import { ops } from "../ops.js";
import { getCompSlots } from "../comp.js";
import { clampDrawDimension, makeSolidBackgroundCanvas } from "../draw.js";
import { getFrameSelectorOutputCount, getFrameSelectorSourceFrame, getUpstreamFrameCount, syncFrameSelectorWidgets } from "../nodes/frame-range.js";
import { getJoinConnectedInputFrameCounts, getJoinSlots, readJoinTrims } from "../nodes/append.js";
import { getUpstreamNode } from "../graph.js";
import { isImageOpsClass, resolveImageOpsClassName } from "../shared/classes.js";
import { getVhsVideoInfo } from "../shared/video.js";
function getConnectedCompInputIndexes(node) {
  const indexes = [];
  for (const slot of getCompSlots(node)) {
    if ((node.inputs?.[slot.inputIndex]?.link ?? null) == null) continue;
    indexes.push(slot.inputIndex);
    if (slot.maskInputIndex != null && (node.inputs?.[slot.maskInputIndex]?.link ?? null) != null) {
      indexes.push(slot.maskInputIndex);
    }
  }
  return indexes;
}
function normalizeFrameIndex(tick, frameCount) {
  const roundedTick = Math.max(0, Math.round(tick));
  if (!Number.isFinite(frameCount) || frameCount <= 0) return roundedTick;
  return (roundedTick % frameCount + frameCount) % frameCount;
}
function getWidgetNumber(node, name, fallback) {
  const value = (node?.widgets ?? []).find((widget) => widget?.name === name)?.value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function collectBranchVideos(node, seen = /* @__PURE__ */ new Set()) {
  if (!node || seen.has(node.id)) return [];
  seen.add(node.id);
  const videos = [];
  const videoEl = node.__imageops_media?.videoEl;
  if (videoEl) videos.push({ node, videoEl });
  for (let inputIndex = 0; inputIndex < (node.inputs ?? []).length; inputIndex++) {
    if ((node.inputs?.[inputIndex]?.link ?? null) == null) continue;
    videos.push(...collectBranchVideos(getUpstreamNode(node, inputIndex), seen));
  }
  return videos;
}
async function seekAppendBranchFrame(node, sourceFrame, fallbackFrameCount) {
  if (String(node?.comfyClass ?? "") === "ImageOpsFrameRange") return;
  const videos = collectBranchVideos(node);
  for (const { node: videoNode, videoEl } of videos) {
    if (!Number.isFinite(videoEl.duration) || videoEl.duration <= 0) continue;
    const info = getVhsVideoInfo(videoNode);
    const forceRate = getWidgetNumber(videoNode, "force_rate", 0);
    const durationRate = fallbackFrameCount > 0 ? fallbackFrameCount / videoEl.duration : 0;
    const fps = forceRate > 0 ? forceRate : info?.fps && info.fps > 0 ? info.fps : durationRate > 0 ? durationRate : 24;
    const targetTime = Math.max(0, Math.min(videoEl.duration - 1 / fps, Math.max(0, sourceFrame) / fps));
    await seekFrozenVideoFrame(videoEl, targetTime, 0.5 / fps);
  }
}
async function seekFrozenVideoFrame(videoEl, targetTime, tolerance) {
  try {
    videoEl.pause();
  } catch {
  }
  if (!Number.isFinite(targetTime)) return;
  if (Math.abs(videoEl.currentTime - targetTime) <= tolerance) return;
  await new Promise((resolve) => {
    let done = false;
    let timer = null;
    const finish = () => {
      if (done) return;
      done = true;
      videoEl.removeEventListener("seeked", finish);
      videoEl.removeEventListener("timeupdate", onTimeUpdate);
      videoEl.removeEventListener("error", finish);
      if (timer != null) window.clearTimeout(timer);
      resolve();
    };
    const onTimeUpdate = () => {
      if (Math.abs(videoEl.currentTime - targetTime) <= tolerance) finish();
    };
    videoEl.addEventListener("seeked", finish, { once: true });
    videoEl.addEventListener("error", finish, { once: true });
    videoEl.addEventListener("timeupdate", onTimeUpdate);
    timer = window.setTimeout(finish, 40);
    try {
      videoEl.currentTime = targetTime;
    } catch {
      finish();
    }
  });
}
function imageOpsAdapter() {
  return {
    match(node) {
      return isImageOpsClass(node?.comfyClass);
    },
    inputs: (node) => {
      const cls = resolveImageOpsClassName(node?.comfyClass);
      const bypass = !!(node?.widgets ?? []).find((w) => w?.name === "bypass")?.value;
      const maskConnected = (node.inputs ?? []).some((input, index) => String(input?.name ?? "").toLowerCase() === "mask" && (node.inputs?.[index]?.link ?? null) != null);
      if (cls === "ImageOpsNoise" || cls === "ImageOpsConstant" || cls === "ImageOpsRamp") return 0;
      if (cls === "ImageOpsFrameRange") return 1;
      if (cls === "ImageOpsMaskConvert") {
        const reverse = !!(node?.widgets ?? []).find((widget) => widget?.name === "reverse")?.value;
        const imageConnected = (node.inputs?.[0]?.link ?? null) != null;
        const maskConnected2 = (node.inputs?.[1]?.link ?? null) != null;
        return reverse ? Number(imageConnected) : Number(maskConnected2);
      }
      if (cls === "ImageOpsDistort") {
        const displacementConnected = (node.inputs?.[1]?.link ?? null) != null;
        const effectMaskConnected = (node.inputs?.[2]?.link ?? null) != null;
        return 1 + Number(displacementConnected) + Number(effectMaskConnected);
      }
      if (cls === "ImageOpsMerge") return bypass ? 1 : maskConnected ? 3 : 2;
      if (cls === "ImageOpsCropStitch") {
        const cropMaskConnected = (node.inputs ?? []).some((input) => String(input?.name ?? "").toLowerCase() === "crop_mask" && (input?.link ?? null) != null);
        return 2 + Number(cropMaskConnected);
      }
      if (cls === "ImageOpsAppend") return getJoinSlots(node).filter((slot) => (node.inputs ?? []).some((input) => input?.name === `image_${slot}` && (input.link ?? null) != null)).length;
      if (cls === "ImageOpsComp") return getConnectedCompInputIndexes(node).length;
      if (cls === "ImageOpsDraw") return (node.inputs?.[0]?.link ?? null) != null ? 1 : 0;
      if (cls === "ImageOpsPreview") {
        const imageConnected = (node.inputs?.[0]?.link ?? null) != null;
        const maskConnected2 = (node.inputs?.[1]?.link ?? null) != null;
        return Number(imageConnected) + Number(maskConnected2);
      }
      return maskConnected ? 2 : 1;
    },
    inputIndexes: (node) => {
      const cls = resolveImageOpsClassName(node?.comfyClass);
      if (cls === "ImageOpsMaskConvert") {
        const reverse = !!(node?.widgets ?? []).find((widget) => widget?.name === "reverse")?.value;
        if (reverse) return (node.inputs?.[0]?.link ?? null) != null ? [0] : [];
        return (node.inputs?.[1]?.link ?? null) != null ? [1] : [];
      }
      if (cls === "ImageOpsComp") {
        return getConnectedCompInputIndexes(node);
      }
      if (cls === "ImageOpsDistort") {
        const indexes = [0];
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        if ((node.inputs?.[2]?.link ?? null) != null) indexes.push(2);
        return indexes;
      }
      if (cls === "ImageOpsPreview") {
        const indexes = [];
        if ((node.inputs?.[0]?.link ?? null) != null) indexes.push(0);
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        return indexes;
      }
      if (cls === "ImageOpsCropStitch") {
        const indexes = [];
        if ((node.inputs?.[0]?.link ?? null) != null) indexes.push(0);
        if ((node.inputs?.[1]?.link ?? null) != null) indexes.push(1);
        const cropMaskIndex = (node.inputs ?? []).findIndex((input) => String(input?.name ?? "").toLowerCase() === "crop_mask");
        if (cropMaskIndex >= 0 && (node.inputs?.[cropMaskIndex]?.link ?? null) != null) indexes.push(cropMaskIndex);
        return indexes;
      }
      if (cls === "ImageOpsAppend") {
        return getJoinSlots(node).map((slot) => (node.inputs ?? []).findIndex((input) => input?.name === `image_${slot}` && (input.link ?? null) != null)).filter((index) => index >= 0);
      }
      return [];
    },
    async apply({ node, ctx, canvasSize, inputs, inputInfos, outputSlot, tick, renderInputAt }) {
      const cls = resolveImageOpsClassName(node?.comfyClass);
      const bypass = !!(node?.widgets ?? []).find((w) => w?.name === "bypass")?.value;
      if (cls === "ImageOpsMaskConvert") {
        return ops.imageOpsMask(ctx, canvasSize, node, cls, inputs, tick ?? 0) ?? inputs[0];
      }
      if (cls === "ImageOpsDraw" && outputSlot === 2) {
        const outs = node.outputs;
        if (Array.isArray(outs) && outs.length >= 3) {
          return await ops.drawMask(ctx, canvasSize, node, inputs);
        }
        return inputs[0] ?? null;
      }
      if (cls === "ImageOpsDraw" && outputSlot === 1) {
        const width = clampDrawDimension(Number((node?.widgets ?? []).find((widget) => widget?.name === "width")?.value ?? 1024), 1024);
        const height = clampDrawDimension(Number((node?.widgets ?? []).find((widget) => widget?.name === "height")?.value ?? 1024), 1024);
        const bgColor = String((node?.widgets ?? []).find((widget) => widget?.name === "bg_color")?.value ?? "#000000");
        return inputs[0] ?? makeSolidBackgroundCanvas(width, height, bgColor);
      }
      if (outputSlot === 1 && cls !== "ImageOpsPreview" && cls !== "ImageOpsDraw" && cls !== "ImageOpsFrameRange") {
        return ops.imageOpsMask(ctx, canvasSize, node, cls, inputs, tick ?? 0) ?? inputs[0];
      }
      if (bypass && cls !== "ImageOpsDraw" && cls !== "ImageOpsAppend") return;
      if (cls === "ImageOpsColorAjust") {
        return ops.colorAjust(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCameraShake") {
        return ops.cameraShake(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsChannel") {
        return ops.channel(ctx, canvasSize, node, outputSlot, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCrop") {
        return ops.crop(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCropStitch") {
        return ops.cropStitch(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsPadOut") {
        return ops.padOut(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsCornerPin") {
        return ops.cornerPin(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsBlur") {
        return ops.blur(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsTransform") {
        return ops.transform(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsInvert") {
        return ops.invert(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsClamp") {
        return ops.clamp(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsGrain") {
        return ops.grain(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsText") {
        return ops.text(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsKeyer") {
        return ops.keyer(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsMerge") {
        return ops.merge(ctx, canvasSize, node, inputs, void 0, tick ?? 0);
      } else if (cls === "ImageOpsAppend") {
        if (inputs.length === 0) return void 0;
        const infos = inputInfos ?? inputs.map((canvas, index) => ({ canvas, inputIndex: index, originSlot: null, upstreamNode: null }));
        const frameCounts = new Map(getJoinConnectedInputFrameCounts(node).map((entry) => [entry.inputIndex, Math.max(1, entry.frameCount)]));
        const trimStarts = new Map(readJoinTrims(node).map((trim) => [trim.slot, Math.max(0, Math.round(trim.start))]));
        const getSourceFrame = (info, localTick2) => {
          const slot = String(node.inputs?.[info.inputIndex]?.name ?? "");
          return Math.max(0, Math.round((trimStarts.get(slot) ?? 0) + localTick2));
        };
        if (bypass) {
          const first = infos[0] ?? null;
          if (!first) return inputs[0];
          const firstCount = Math.max(1, frameCounts.get(first.inputIndex) ?? 1);
          const localTick2 = normalizeFrameIndex(tick ?? 0, firstCount);
          const sourceFrame2 = getSourceFrame(first, localTick2);
          await seekAppendBranchFrame(first.upstreamNode ?? null, sourceFrame2, firstCount);
          return await renderInputAt?.(first, sourceFrame2) ?? first.canvas;
        }
        const totalFrames = infos.reduce((sum, info) => sum + Math.max(1, frameCounts.get(info.inputIndex) ?? 1), 0);
        let remaining = normalizeFrameIndex(tick ?? 0, totalFrames);
        let selected = infos[0] ?? null;
        let localTick = remaining;
        for (const info of infos) {
          const segmentFrames = Math.max(1, frameCounts.get(info.inputIndex) ?? 1);
          if (remaining < segmentFrames) {
            selected = info;
            localTick = remaining;
            break;
          }
          remaining -= segmentFrames;
        }
        if (!selected) return inputs[0];
        const selectedCount = Math.max(1, frameCounts.get(selected.inputIndex) ?? 1);
        const sourceFrame = getSourceFrame(selected, localTick);
        await seekAppendBranchFrame(selected.upstreamNode ?? null, sourceFrame, selectedCount);
        return await renderInputAt?.(selected, sourceFrame) ?? selected.canvas;
      } else if (cls === "ImageOpsComp") {
        return ops.comp(ctx, canvasSize, node, inputs);
      } else if (cls === "ImageOpsDistort") {
        return ops.distort(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsSpherize") {
        return ops.spherize(ctx, canvasSize, node, inputs, tick ?? 0);
      } else if (cls === "ImageOpsNoise") {
        return ops.noise(ctx, canvasSize, node, tick ?? 0);
      } else if (cls === "ImageOpsConstant") {
        return ops.constant(ctx, canvasSize, node);
      } else if (cls === "ImageOpsRamp") {
        return ops.ramp(ctx, canvasSize, node);
      } else if (cls === "ImageOpsDraw") {
        return await ops.draw(ctx, canvasSize, node, inputs);
      } else if (cls === "ImageOpsFrameRange") {
        const st = node.__imageops_state;
        if (st) {
          const upstreamCount = getUpstreamFrameCount(node);
          if (upstreamCount > 0 && upstreamCount !== st.frameSelectorSourceCount) {
            st.frameSelectorSourceCount = upstreamCount;
            syncFrameSelectorWidgets(node);
          }
        }
        const sourceCount = st?.frameSelectorSourceCount ?? 0;
        const upstreamNode = getUpstreamNode(node, 0);
        if (sourceCount > 0 && upstreamNode) {
          const sourceFrame = getFrameSelectorSourceFrame(node, tick ?? 0, sourceCount);
          const outputCount = getFrameSelectorOutputCount(node, sourceCount);
          const frameHold = !!(node.widgets ?? []).find((w) => w?.name === "frame_hold")?.value;
          const repeat = !!(node.widgets ?? []).find((w) => w?.name === "repeat")?.value;
          const repeatMode = String((node.widgets ?? []).find((w) => w?.name === "repeat_mode")?.value ?? "loop").trim().toLowerCase();
          const freezePlayback = repeat && repeatMode === "freeze" || frameHold && (!repeat || repeatMode === "input_duration" || repeatMode === "custom_count");
          const playhead = st?.frameSelectorPlayhead;
          if (playhead) {
            const max = Math.max(1, sourceCount - 1);
            playhead.style.left = `${Math.max(0, Math.min(max, sourceFrame)) / max * 100}%`;
            playhead.style.opacity = outputCount > 1 ? "1" : "0.88";
          }
          const upImgs = upstreamNode.imgs;
          if (Array.isArray(upImgs) && upImgs.length > 0) {
            const frameIdx = Math.max(0, Math.min(upImgs.length - 1, sourceFrame));
            const img = upImgs[frameIdx];
            if (img && img.complete && img.naturalWidth > 0) {
              ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
              ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
              return ctx.canvas;
            }
          }
          const videoEl = upstreamNode.__imageops_media?.videoEl;
          if (videoEl && Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
            const videoInfo = getVhsVideoInfo(upstreamNode);
            const forceRate = Number((upstreamNode.widgets ?? []).find((w) => w?.name === "force_rate")?.value ?? 0);
            const fps = forceRate > 0 ? forceRate : videoInfo?.fps && videoInfo.fps > 0 ? videoInfo.fps : 24;
            const targetTime = Math.max(0, Math.min(videoEl.duration - 1 / fps, sourceFrame / fps));
            const tolerance = 0.5 / fps;
            if (freezePlayback) {
              await seekFrozenVideoFrame(videoEl, targetTime, tolerance);
            } else if (Math.abs(videoEl.currentTime - targetTime) > tolerance) {
              videoEl.currentTime = targetTime;
            }
            if (videoEl.readyState >= 2) {
              ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
              ctx.drawImage(videoEl, 0, 0, ctx.canvas.width, ctx.canvas.height);
              return ctx.canvas;
            }
          }
        }
        return inputs[0];
      } else if (cls === "ImageOpsPreview") {
        const previewTarget = String((node?.widgets ?? []).find((widget) => widget?.name === "preview_target")?.value ?? "auto").toLowerCase();
        if (outputSlot === 1) return inputs[1] ?? inputs[0];
        if (outputSlot === 0) return inputs[0] ?? inputs[1];
        if (previewTarget === "mask") return inputs[1] ?? inputs[0];
        if (previewTarget === "image") return inputs[0] ?? inputs[1];
        return inputs[0] ?? inputs[1];
      } else {
      }
    }
  };
}
export {
  imageOpsAdapter
};
