# Changelog

All notable changes to ComfyUI-Majoor-ImageOps are documented here.

## [Unreleased]

### Added
- **`ImageOpsRoto`**: Nuke-style vector roto node with bezier, ellipse, rectangle and freehand tools, add/subtract/intersect, feather/expand, keyframe animation, undo/redo and a live-preview editor. Backed by the new `nodes/core/roto.py`.
- **Lens / compositing effect nodes**: `ImageOpsVignette`, `ImageOpsChromaticAberration`, `ImageOpsBloom` (HDR-safe).
- **`ImageOpsDefocus`**: depth-driven defocus/bokeh with shaped aperture kernels (circle, hexagon, octagon, custom) and highlight bloom.
- **A/B compare on `ImageOpsPreview`**: optional second input to compare against the main image.
- **`ImageOpsFrameRange`**: trim, hold and repeat (loop / bounce / reverse) a frame range, backed by the new `nodes/core/timeline.py`.
- **Documentation**: specification of the live compositing correction patches (`docs/`).
- `ImageOpsColorAjust` takes an optional core `CURVE` input (master curve), mirrored in the live preview and checked against ComfyUI's curve samples.
- `ImageOpsCrop` outputs a core `BOUNDING_BOX` (`bounding_box`, appended after `bbox`); `ImageOpsCropStitch` accepts one.
- `ImageOpsComp` outputs its layers as a core `LAYERS` document on ComfyUI 0.31+.
- All nodes set `essentials_category` (Image Tools, or Video Tools for Append and Frame Range).
- **Example workflow regenerated**: `example/All Nodes MIO.json` holds all nodes wired to inputs and runs end to end in ComfyUI. `scripts/generate_example_workflow.py` builds it from the node schemas, and an integration test fails when it goes stale.
- ImageOps settings (preview sizes, refresh delay, graph limit) and an "ImageOps: Refresh all live previews" command.

### Changed
- Progress goes through `ComfyAPISync().execution.set_progress`, which reads the executing node from the graph run, so the nodes no longer declare the hidden `unique_id` input.
- **Requires ComfyUI 0.19.0 or newer** (was 0.12.0): the schema now uses `has_intermediate_output`, and the older floor failed to load `ImageOpsPadOut`, `ImageOpsFrameRange` and `ImageOpsAppend`.
- Extension loading is V3 only. The package no longer exposes `NODE_CLASS_MAPPINGS`, which made ComfyUI skip `comfy_entrypoint`.
- `ImageOpsPadOut`, `ImageOpsFrameRange` and `ImageOpsAppend` set `has_intermediate_output`, so their backend-computed values reach the preview again on cached runs and page refreshes.
- Color Correct, Vignette, Clamp, Invert, Chromatic Aberration, Bloom, Grain, Camera Shake, Transform, Spherize and Corner Pin process on ComfyUI's torch device when the frames fit in free memory. `IMAGEOPS_COMPUTE_DEVICE=cpu` disables it.
- `ImageOpsMerge` offers `subtract`, `divide`, `hard_light`, `linear_burn`, `linear_light`, `vivid_light`, `pin_light`, `hard_mix`, `grain_extract` and `grain_merge`; `ImageOpsComp` offers `hard_light`. Blend math lives in `nodes/core/blend.py` only, with golden vectors shared with the preview.
- `/imageops/viewmedia` transcodes with PyAV instead of an external ffmpeg process, caches results, limits concurrent transcodes and serves files with range support.
- Live preview renders at higher resolution (idle 1024 px, playback 640 px, interaction 448 px) with high-quality image smoothing.

### Fixed
- `ImageOpsCrop` lost its saved output size after a workflow reload: `syncCropWidgets` recomputed `height` from `width` and a preset aspect ratio on every resync (including the one `onConfigure` runs on load), overwriting the restored value whenever `sync_dimensions` was on. It now only refreshes internal aspect-ratio bookkeeping on a resync and leaves the widget values alone.
- `ImageOpsComp` raised `NameError: to_display_range` for any layer with a rotation, and image previews saved by `ImageOpsPreview` hit the same error. `to_display_range` is defined again (clamps to 0-1 for 8-bit previews only).
- `/imageops/viewmedia` and node replacements were never registered because ComfyUI skipped `comfy_entrypoint`; animated previews now load. `server.py` is now `routes.py` so it no longer shadows ComfyUI's `server` module.
- Masked Transform and Camera Shake with `mirror` or `expand` fill sampled the matte with different padding than the color, producing RGB values in the thousands at the edges.
- CI: `nodes/core/timeline.py` was never committed, which broke the import of `nodes` (and every integration test).
- CI: removed `tests/__init__.py`, which the unit-test isolation check rejects.

## [0.1.7] and earlier

### Added
- **Professional compositing engines**: `ImageOpsMerge` (linear-light blend modes), `ImageOpsComp` (multi-layer compositor), `ImageOpsKeyer` (chroma/luma key with despill), `ImageOpsCornerPin`, `ImageOpsDistort`, `ImageOpsSpherize`, `ImageOpsPadOut`, `ImageOpsCropStitch`.
- **Generators**: `ImageOpsNoise` (Perlin/value, seamless tiling, 3D animation), `ImageOpsConstant`, `ImageOpsRamp`, `ImageOpsGrain`, `ImageOpsCameraShake`, `ImageOpsText`, `ImageOpsDraw`.
- **Native `VIDEO` support** and `ImageOpsAppend` for concatenating clips.
- **HDR handling**: `input_space` option (`srgb` / `linear`) on color correction.
- **Live preview** embedded in the nodes (no queue), with histogram, waveform, vectorscope and zebra/false-color overlays on `ImageOpsPreview`.
- `bypass` option on every processing node.
- Core processing nodes: Color Correct (with shadows/midtones/highlights wheels), Blur, Channels, Mask Convert, Resize/Crop, Transform, Invert, Clamp.

### Fixed
- Preview/backend WYSIWYG mismatches and dead code cleanup across the pack.
