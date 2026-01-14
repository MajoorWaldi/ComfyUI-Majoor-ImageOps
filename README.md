# ComfyUI‑Majoor‑ImageOps
Image processing nodes for ComfyUI with a centralized live preview module (no queue), batch-first behavior, and interop adapters.

## Features
- Batch-first: `IMAGE` inputs/outputs are treated as batches (frames friendly)
- Fail-soft interop: unsupported upstream nodes don’t break the graph/preview
- Live preview widget on ImageOps nodes (single frontend module)
- Preview Pro UI (only on `ImageOpsPreview`): histogram, waveform (luma/RGB), vectorscope, zebra/false-color, A/B freeze + wipe
- Optional `bypass` on processing nodes (backend + preview respects it)

## Install
1. Place this folder in `ComfyUI/custom_nodes/ComfyUI-Majoor-ImageOps`
2. Restart ComfyUI
3. Hard refresh the browser: `Ctrl+F5`

## Nodes (`image/imageops`)
- `ImageOpsColorAjust` — combined ColorCorrect + Hue/Sat/Value
- `ImageOpsBlur`
- `ImageOpsTransform`
- `ImageOpsInvert`
- `ImageOpsClamp`
- `ImageOpsMerge` (2 inputs)
- `ImageOpsPreview` (Output)

### `bypass`
All processing nodes expose `bypass` (boolean). When enabled, the node returns its input unchanged and the live preview skips applying the op.

### `ImageOpsPreview` modes
- `images`: individual frames
- `strip`: a single horizontal strip image (quick batch inspection)
- `animated_webp` / `animated_gif`: animated preview for sequences

## Live Preview (frontend)
Files:
- `js/preview/host.js` — widget injection + video loop + Preview Pro UI (scopes/overlays/A‑B) only for `ImageOpsPreview`
- `js/preview/renderer.js` — recursive render + caching (recursion limit 64)
- `js/preview/registry.js` — adapter selection (core/WAS/VHS/generic/ImageOps)
- `js/preview/ops.js` — preview ops implementation (single source for preview behavior)

Interop notes:
- Core: basic invert/sharpen/blend adapters (best effort)
- WAS/VHS: heuristics for common nodes and sources (fail-soft)

## Configuration
- Preview canvas size: `localStorage["imageops.preview.canvasSize"]` (int, default `512`)
- Transform large-allocation warning: env `IMAGEOPS_LARGE_IMAGE_WARN_MB` (int, default `2048`)

## Notes
- If ComfyUI logs `[DEPRECATION WARNING]`, another extension is using legacy frontend APIs.
- Some packs expose video via custom types; best results when upstream provides frames as `IMAGE` batches.

