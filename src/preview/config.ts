// Preview configuration (v1)
import type { PreviewConfig } from "../types.js";
import { PREVIEW_DEFAULTS, PREVIEW_SETTING_IDS, PREVIEW_STORAGE_KEYS } from "./shared/preview-defaults.js";

function clampInt(v: unknown, minV: number, maxV: number, fallback: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(minV, Math.min(maxV, n));
}

let _cachedConfig: PreviewConfig | null = null;
let readSetting: (id: string) => unknown = () => undefined;

export function setPreviewSettingReader(reader: (id: string) => unknown): void {
  readSetting = reader;
  invalidatePreviewConfig();
}

function configuredValue(key: keyof typeof PREVIEW_STORAGE_KEYS): unknown {
  const fromSetting = readSetting(PREVIEW_SETTING_IDS[key]);
  // localStorage values saved before the settings existed apply until the setting is changed.
  if (fromSetting === undefined || fromSetting === PREVIEW_DEFAULTS[key]) {
    return localStorage.getItem(PREVIEW_STORAGE_KEYS[key]) ?? fromSetting;
  }
  return fromSetting;
}

function buildPreviewConfig(): PreviewConfig {
  const canvasSize = clampInt(
    configuredValue("canvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    PREVIEW_DEFAULTS.maxCanvasSize,
    PREVIEW_DEFAULTS.canvasSize,
  );
  const playbackCanvasSize = clampInt(
    configuredValue("playbackCanvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    canvasSize,
    Math.min(canvasSize, PREVIEW_DEFAULTS.playbackCanvasSize),
  );
  const interactionCanvasSize = clampInt(
    configuredValue("interactionCanvasSize"),
    PREVIEW_DEFAULTS.minCanvasSize,
    playbackCanvasSize,
    Math.min(playbackCanvasSize, PREVIEW_DEFAULTS.interactionCanvasSize),
  );
  return {
    canvasSize,
    playbackCanvasSize,
    interactionCanvasSize,
    debounceMs: clampInt(configuredValue("debounceMs"), 0, 2000, PREVIEW_DEFAULTS.debounceMs),
    maxGraphNodes: clampInt(configuredValue("maxGraphNodes"), 1, 10000, PREVIEW_DEFAULTS.maxGraphNodes),
  };
}

export function getPreviewConfig(): PreviewConfig {
  return (_cachedConfig ??= buildPreviewConfig());
}

export function invalidatePreviewConfig(): void {
  _cachedConfig = null;
}
