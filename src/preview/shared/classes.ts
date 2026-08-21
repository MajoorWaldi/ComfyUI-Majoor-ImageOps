import { IMAGEOPS_CLASS_ALIASES, IMAGEOPS_NODE_METADATA } from "./imageops-metadata.js";

export const IMAGEOPS_CLASSES = new Set(IMAGEOPS_NODE_METADATA.map((entry) => entry.className));
export const IMAGEOPS_CUSTOM_UI_CLASSES = new Set(
  IMAGEOPS_NODE_METADATA.filter((entry) => entry.ui === "custom").map((entry) => entry.className),
);
export const IMAGEOPS_NATIVE_UI_CLASSES = new Set(
  IMAGEOPS_NODE_METADATA.filter((entry) => entry.ui === "native").map((entry) => entry.className),
);

function normalizeClassName(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function resolveImageOpsClassName(value: unknown): string {
  const raw = String(value ?? "").trim();
  return IMAGEOPS_CLASS_ALIASES.get(normalizeClassName(raw)) ?? raw;
}

export function isImageOpsClass(value: unknown): boolean {
  return IMAGEOPS_CLASSES.has(resolveImageOpsClassName(value));
}

export function isImageOpsCustomUiClass(value: unknown): boolean {
  return IMAGEOPS_CUSTOM_UI_CLASSES.has(resolveImageOpsClassName(value));
}

export function isImageOpsNativeUiClass(value: unknown): boolean {
  return IMAGEOPS_NATIVE_UI_CLASSES.has(resolveImageOpsClassName(value));
}
