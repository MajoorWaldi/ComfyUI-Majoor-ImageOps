const IMAGEOPS_CLASSES = /* @__PURE__ */ new Set([
  "ImageOpsColorAjust",
  "ImageOpsBlur",
  "ImageOpsCameraShake",
  "ImageOpsChannel",
  "ImageOpsCornerPin",
  "ImageOpsComp",
  "ImageOpsConstant",
  "ImageOpsCrop",
  "ImageOpsDistort",
  "ImageOpsDraw",
  "ImageOpsFrameRange",
  "ImageOpsGrain",
  "ImageOpsTransform",
  "ImageOpsInvert",
  "ImageOpsAppend",
  "ImageOpsKeyer",
  "ImageOpsClamp",
  "ImageOpsMerge",
  "ImageOpsMaskConvert",
  "ImageOpsNoise",
  "ImageOpsPadOut",
  "ImageOpsPreview",
  "ImageOpsRamp",
  "ImageOpsSpherize",
  "ImageOpsText"
]);
const IMAGEOPS_CUSTOM_UI_CLASSES = /* @__PURE__ */ new Set([
  "ImageOpsColorAjust",
  "ImageOpsComp",
  "ImageOpsConstant",
  "ImageOpsCrop",
  "ImageOpsDraw",
  "ImageOpsFrameRange",
  "ImageOpsGrain",
  "ImageOpsAppend",
  "ImageOpsKeyer",
  "ImageOpsPadOut",
  "ImageOpsPreview",
  "ImageOpsRamp",
  "ImageOpsText"
]);
const IMAGEOPS_NATIVE_UI_CLASSES = /* @__PURE__ */ new Set([
  "ImageOpsBlur",
  "ImageOpsCameraShake",
  "ImageOpsChannel",
  "ImageOpsClamp",
  "ImageOpsCornerPin",
  "ImageOpsDistort",
  "ImageOpsInvert",
  "ImageOpsMaskConvert",
  "ImageOpsMerge",
  "ImageOpsNoise",
  "ImageOpsSpherize",
  "ImageOpsTransform"
]);
const IMAGEOPS_CLASS_ALIASES = /* @__PURE__ */ new Map([
  ["checker", "ImageOpsConstant"],
  ["checkerboard", "ImageOpsConstant"],
  ["radial", "ImageOpsRamp"]
]);
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
