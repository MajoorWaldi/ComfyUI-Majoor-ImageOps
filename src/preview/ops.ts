/** Public compatibility facade for preview operations. */
import { renderCompPreview, renderDrawNodePreview, ops as runtimeOps } from "./ops/implementation.js";
import { colorOps } from "./ops/color.js";
import { geometryOps } from "./ops/geometry.js";
import { blendOps } from "./ops/blend.js";
import { maskOps } from "./ops/masks.js";
import { proceduralOps } from "./ops/procedural.js";
import { videoOps } from "./ops/video.js";

export { renderCompPreview, renderDrawNodePreview };
export { colorOps } from "./ops/color.js";
export { geometryOps } from "./ops/geometry.js";
export { blendOps } from "./ops/blend.js";
export { maskOps } from "./ops/masks.js";
export { proceduralOps } from "./ops/procedural.js";
export { videoOps } from "./ops/video.js";

// Preserve every historical operation while making category ownership explicit.
export const ops = {
  ...runtimeOps,
  ...colorOps,
  ...geometryOps,
  ...blendOps,
  ...maskOps,
  ...proceduralOps,
  ...videoOps,
};
