import type { ComfyNode } from "../../types.js";

export function widgetHasAnimatedValues(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > 1) return true;
  return value.length === 1 ? widgetHasAnimatedValues(value[0]) : false;
}

export function widgetAnimatedLength(value: unknown): number {
  if (!Array.isArray(value)) return 1;
  if (value.length > 1) return value.length;
  return value.length === 1 ? widgetAnimatedLength(value[0]) : 1;
}

export function getProceduralFrameCount(node: ComfyNode): number | null {
  const cls = String(node?.comfyClass ?? "");
  const animatedLength = Math.max(1, ...(node.widgets ?? []).map((entry) => widgetAnimatedLength(entry?.value)));
  if (cls !== "ImageOpsNoise" && cls !== "ImageOpsGrain" && cls !== "ImageOpsCameraShake") {
    return animatedLength > 1 ? animatedLength : null;
  }

  const widget = (name: string) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name: string, fallback: number = 0): number => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value as string);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const batchSize = Math.max(1, Math.round(numeric("batch_size", 1)));
  const frameLength = Math.max(0, Math.round(numeric("frame_length", 0)));
  const frameCount = frameLength > 0 ? frameLength : batchSize;

  if (cls === "ImageOpsGrain" || cls === "ImageOpsCameraShake") {
    return Math.max(frameCount, animatedLength);
  }

  // animation_speed != 0 means infinite animation — return a bounded cycle so the tick is never clamped
  // to 0 yet remains small enough that animation seeds wrap predictably and modulo math stays cheap.
  // 3600 frames ≈ 5 minutes at 12 fps, far longer than any practical preview session.
  const animSpeed = numeric("animation_speed", 0);
  if (animSpeed !== 0) return 3600;

  return Math.max(frameCount, animatedLength);
}

export function hasProceduralAnimation(node: ComfyNode): boolean {
  const cls = String(node?.comfyClass ?? "");
  const animatedWidgets = (node.widgets ?? []).some((entry) => widgetHasAnimatedValues(entry?.value));
  if (cls !== "ImageOpsNoise" && cls !== "ImageOpsGrain" && cls !== "ImageOpsCameraShake") return animatedWidgets && (getProceduralFrameCount(node) ?? 1) > 1;

  const widget = (name: string) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const numeric = (name: string, fallback: number = 0): number => {
    const value = widget(name)?.value;
    if (Array.isArray(value) && value.length > 1) return 1;
    const parsed = parseFloat(value as string);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const frameCount = getProceduralFrameCount(node) ?? 1;
  if (frameCount <= 1) return false;
  if (cls === "ImageOpsGrain") {
    const animated = String(widget("animated")?.value ?? "true").toLowerCase();
    return animated !== "false" && animated !== "0";
  }
  if (cls === "ImageOpsCameraShake") return true;
  if (numeric("animation_speed", 0) !== 0) return true;
  if (numeric("seed_step", 0) !== 0) return true;
  if (numeric("frame_offset_x", 0) !== 0) return true;
  if (numeric("frame_offset_y", 0) !== 0) return true;
  if (numeric("frame_offset_z", 0) !== 0) return true;

  return animatedWidgets;
}

export function getProceduralPlaybackFps(node: ComfyNode): number | null {
  const cls = String(node?.comfyClass ?? "");
  if (cls !== "ImageOpsNoise" && cls !== "ImageOpsGrain" && cls !== "ImageOpsCameraShake") return null;
  const widget = (name: string) => node.widgets?.find((entry) => entry?.name === name) ?? null;
  const value = parseFloat(widget("fps")?.value as string);
  return Number.isFinite(value) ? Math.max(1, value) : 12;
}
