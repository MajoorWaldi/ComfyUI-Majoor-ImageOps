export type ImageOpsUiMode = "custom" | "native";

export type ImageOpsNodeMeta = {
  className: string;
  ui: ImageOpsUiMode;
  minPreviewHeight?: number;
};

export const IMAGEOPS_NODE_METADATA: readonly ImageOpsNodeMeta[] = [
  {
    "className": "ImageOpsColorAjust",
    "ui": "custom",
    "minPreviewHeight": 490
  },
  {
    "className": "ImageOpsBlur",
    "ui": "native"
  },
  {
    "className": "ImageOpsCameraShake",
    "ui": "native"
  },
  {
    "className": "ImageOpsChannel",
    "ui": "native"
  },
  {
    "className": "ImageOpsCornerPin",
    "ui": "native"
  },
  {
    "className": "ImageOpsComp",
    "ui": "custom",
    "minPreviewHeight": 400
  },
  {
    "className": "ImageOpsConstant",
    "ui": "custom",
    "minPreviewHeight": 390
  },
  {
    "className": "ImageOpsCrop",
    "ui": "custom"
  },
  {
    "className": "ImageOpsDistort",
    "ui": "native"
  },
  {
    "className": "ImageOpsDraw",
    "ui": "custom",
    "minPreviewHeight": 220
  },
  {
    "className": "ImageOpsFrameRange",
    "ui": "custom",
    "minPreviewHeight": 390
  },
  {
    "className": "ImageOpsGrain",
    "ui": "custom",
    "minPreviewHeight": 390
  },
  {
    "className": "ImageOpsTransform",
    "ui": "native"
  },
  {
    "className": "ImageOpsInvert",
    "ui": "native"
  },
  {
    "className": "ImageOpsAppend",
    "ui": "custom",
    "minPreviewHeight": 430
  },
  {
    "className": "ImageOpsKeyer",
    "ui": "custom",
    "minPreviewHeight": 420
  },
  {
    "className": "ImageOpsClamp",
    "ui": "native"
  },
  {
    "className": "ImageOpsMerge",
    "ui": "native"
  },
  {
    "className": "ImageOpsMaskConvert",
    "ui": "native"
  },
  {
    "className": "ImageOpsNoise",
    "ui": "native"
  },
  {
    "className": "ImageOpsPadOut",
    "ui": "custom",
    "minPreviewHeight": 430
  },
  {
    "className": "ImageOpsPreview",
    "ui": "custom",
    "minPreviewHeight": 360
  },
  {
    "className": "ImageOpsRamp",
    "ui": "custom",
    "minPreviewHeight": 430
  },
  {
    "className": "ImageOpsSpherize",
    "ui": "native"
  },
  {
    "className": "ImageOpsText",
    "ui": "custom",
    "minPreviewHeight": 470
  }
] as const;

export const IMAGEOPS_DEFAULT_PREVIEW_MIN_HEIGHT = 320;
export const IMAGEOPS_DEFAULT_NODE_WIDTH = 360;
export const IMAGEOPS_CLASS_ALIASES = new Map<string, string>([
  [
    "checker",
    "ImageOpsConstant"
  ],
  [
    "checkerboard",
    "ImageOpsConstant"
  ],
  [
    "radial",
    "ImageOpsRamp"
  ]
]);
