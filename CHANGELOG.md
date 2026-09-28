# Changelog

All notable changes to ComfyUI-Majoor-ImageOps are documented here.

## [Unreleased]

### Added
- **`ImageOpsRoto`**: Nuke-style vector roto node with bezier, ellipse, rectangle and freehand tools, add/subtract/intersect, feather/expand, keyframe animation, undo/redo and a live-preview editor. Backed by the new `nodes/core/roto.py`.
- **Lens / compositing effect nodes**: `ImageOpsVignette`, `ImageOpsChromaticAberration`, `ImageOpsBloom` (HDR-safe), `ImageOpsLensArtifacts` (dirt/smudge texture plus procedural dust).
- **`ImageOpsDefocus`**: depth-driven defocus/bokeh with shaped aperture kernels (circle, hexagon, octagon, custom) and highlight bloom.
- **A/B compare on `ImageOpsPreview`**: optional second input to compare against the main image.
- **`ImageOpsFrameRange`**: trim, hold and repeat (loop / bounce / reverse) a frame range, backed by the new `nodes/core/timeline.py`.
- **Documentation**: specification of the live compositing correction patches (`docs/`).

### Changed
- Live preview renders at higher resolution (idle 1024 px, playback 640 px, interaction 448 px) with high-quality image smoothing.

### Fixed
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
