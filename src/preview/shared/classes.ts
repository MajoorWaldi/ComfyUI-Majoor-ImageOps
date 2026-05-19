export const IMAGEOPS_CLASSES = new Set([
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
  "ImageOpsText",
]);

export const IMAGEOPS_CUSTOM_UI_CLASSES = new Set([
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
  "ImageOpsText",
]);

export const IMAGEOPS_NATIVE_UI_CLASSES = new Set([
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
  "ImageOpsTransform",
]);

const IMAGEOPS_CLASS_ALIASES = new Map<string, string>([
  ["checker", "ImageOpsConstant"],
  ["checkerboard", "ImageOpsConstant"],
  ["radial", "ImageOpsRamp"],
]);

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
