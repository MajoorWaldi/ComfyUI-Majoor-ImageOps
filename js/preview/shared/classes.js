import { IMAGEOPS_CLASS_ALIASES, IMAGEOPS_NODE_METADATA } from "./imageops-metadata.js";
const IMAGEOPS_CLASSES = new Set(IMAGEOPS_NODE_METADATA.map((entry) => entry.className));
const IMAGEOPS_CUSTOM_UI_CLASSES = new Set(
  IMAGEOPS_NODE_METADATA.filter((entry) => entry.ui === "custom").map((entry) => entry.className)
);
const IMAGEOPS_NATIVE_UI_CLASSES = new Set(
  IMAGEOPS_NODE_METADATA.filter((entry) => entry.ui === "native").map((entry) => entry.className)
);
function normalizeClassName(value) {
  return String(value ?? "").trim().toLowerCase();
}
function resolveImageOpsClassName(value) {
  const raw = String(value ?? "").trim();
  return IMAGEOPS_CLASS_ALIASES.get(normalizeClassName(raw)) ?? raw;
}
function isImageOpsClass(value) {
  return IMAGEOPS_CLASSES.has(resolveImageOpsClassName(value));
}
function isImageOpsCustomUiClass(value) {
  return IMAGEOPS_CUSTOM_UI_CLASSES.has(resolveImageOpsClassName(value));
}
function isImageOpsNativeUiClass(value) {
  return IMAGEOPS_NATIVE_UI_CLASSES.has(resolveImageOpsClassName(value));
}
export {
  IMAGEOPS_CLASSES,
  IMAGEOPS_CUSTOM_UI_CLASSES,
  IMAGEOPS_NATIVE_UI_CLASSES,
  isImageOpsClass,
  isImageOpsCustomUiClass,
  isImageOpsNativeUiClass,
  resolveImageOpsClassName
};
