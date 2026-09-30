// Stand-in for ComfyUI's browser-served scripts/app.js, which doesn't exist as a
// file in this backend-only checkout (the real frontend package serves it). Only
// the shape used by src/preview/shared/canvas.ts (optional-chained access) is
// needed for tests that don't exercise live canvas-dirtying behavior.
export const app = {};
