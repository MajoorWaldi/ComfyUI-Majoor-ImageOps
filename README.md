# 🎨 ComfyUI‑Majoor‑ImageOps

**Advanced image processing nodes for ComfyUI** with a centralized live preview module (no queue required), batch-first behavior, and comprehensive interop adapters.

---

## ✨ Features

- **📦 Batch-First Architecture**: `IMAGE` inputs/outputs are treated as batches (frames friendly) - perfect for video and animation workflows
- **🛡️ Fail-Soft Interop**: Unsupported upstream nodes don't break the graph or preview - graceful degradation
- **👁️ Live Preview Widget**: Real-time preview on ImageOps nodes without queuing (single frontend module)
- **🎛️ Preview Pro UI** (only on `ImageOpsPreview`): 
  - 📊 Histogram analysis
  - 🌊 Waveform (luma/RGB)
  - 🎯 Vectorscope
  - 🦓 Zebra/False-color overlays
  - ↔️ A/B freeze + wipe comparison
- **🔀 Optional Bypass**: All processing nodes expose `bypass` (boolean) - when enabled, the node returns input unchanged and live preview skips applying the operation

---

## 📥 Installation

1. **Clone/Place** this folder in `ComfyUI/custom_nodes/ComfyUI-Majoor-ImageOps`
2. **Restart** ComfyUI
3. **Hard refresh** the browser: `Ctrl+F5` (or `Cmd+Shift+R` on macOS)

---

## 🧩 Nodes (`image/imageops`)

### 🔧 Processing Nodes

| Node | Internal ID | Description |
|------|-------------|-------------|
| **ImageOps Color Correct** | `ImageOpsColorAjust` | Professional color correction with temperature, hue, brightness, contrast, saturation, and gamma controls |
| **ImageOps Blur** | `ImageOpsBlur` | Gaussian blur with radius/sigma control and mask support |
| **ImageOps Channels** | `ImageOpsChannel` | Extract and manipulate individual RGB/Alpha channels |
| **ImageOps Mask Convert** | `ImageOpsMaskConvert` | Convert images and masks with selectable matte extraction, levels, and antialiasing |
| **ImageOps Resize/Crop** | `ImageOpsCrop` | Interactive crop and resize with aspect ratio presets |
| **ImageOps Distort** | `ImageOpsDistort` | iDistort-style displacement warp driven by source channels, external maps, masks, or internal procedural noise |
| **ImageOps Transform** | `ImageOpsTransform` | Translate, rotate, scale with filter options (nearest/bilinear/bicubic) |
| **ImageOps Corner Pin** | `ImageOpsCornerPin` | Perspective corner pinning with batched homography warp, bicubic filtering, supersampling, and alpha-safe edges |
| **ImageOps Pad Out** | `ImageOpsPadOut` | Add per-side borders with constant, edge-extended, reflected, or blurry fill and optional target aspect ratios |
| **ImageOps Invert** | `ImageOpsInvert` | Invert colors and/or alpha channel (separate alpha control) |
| **ImageOps Spherize** | `ImageOpsSpherize` | Spherical and fisheye lens projections with five modes, strength control, and circle-mask output |
| **ImageOps Clamp** | `ImageOpsClamp` | Clamp pixel values to min/max range |
| **ImageOps Merge** | `ImageOpsMerge` | Linear-light two-input compositing with production blend modes and foreground fit controls |
| **ImageOps Noise** | `ImageOpsNoise` | GPU-backed procedural noise source with Perlin, value, seamless tiling, 3D Z animation, seed stepping, frame length/FPS controls, and color ramp output |
| **ImageOps Paint** | `ImageOpsDraw` | Digital painting with brush/eraser tools, cropped overlay payloads, layer JSON support, and pen dynamics |
| **ImageOps Comp** | `ImageOpsComp` | Multi-layer compositor with blend modes, positioning, and opacity per layer |

### 📤 Output Nodes

| Node | Description |
|------|-------------|
| **ImageOps Preview** | `ImageOpsPreview` | Preview bridge node with multiple display modes (images, strip, animated WebP/GIF) |

---

## 🎛️ Node Details

### 🎨 ImageOps Color Correct
Professional color grading with reference-based correction.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `temperature` (-100 to 100): Color temperature adjustment
- `hue` (-180 to 180): Hue rotation in degrees
- `brightness` (-100 to 100): Brightness adjustment
- `contrast` (-100 to 100): Contrast adjustment
- `saturation` (-100 to 100): Saturation adjustment
- `gamma` (0.2 to 2.2): Gamma correction
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🌫️ ImageOps Blur
Gaussian blur with optional mask support.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `radius` (0 to 128): Blur support radius in pixels; when set to `0`, support is derived from `sigma`
- `sigma` (0.01 to 64.0): Gaussian sigma value controlling blur spread
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🔴 ImageOps Channels
Extract and isolate individual color channels.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `channel`: Red, Green, Blue, or Alpha
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🎚️ ImageOps Mask Convert
Convert images to masks and masks to previewable images.

**Inputs:**
- `image` (IMAGE/VIDEO, optional): Source media when `reverse` is enabled
- `mask` (MASK, optional): Source mask when `reverse` is disabled

**Parameters:**
- `reverse`: image -> mask when enabled, mask -> image when disabled
- `mask_source`: auto, luma, max_rgb, saturation, red, green, blue, or alpha
- `black_point` / `white_point`: Remap the extracted matte to harden or soften the mask
- `antialias_radius`: Small blur radius before levels to smooth jagged matte edges

**Outputs:** `IMAGE`, `MASK`

---

### ✂️ ImageOps Resize/Crop
Interactive crop and resize with aspect ratio control.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `aspect_ratio`: Preset ratios (1:1, 3:4, 4:3, 16:9, 9:16, custom)
- `width` (1 to 8192): Output width
- `height` (1 to 8192): Output height
- `sync_dimensions`: Link width/height changes
- `crop_center_x` (0.0 to 1.0): Horizontal crop position
- `crop_center_y` (0.0 to 1.0): Vertical crop position
- `crop_scale` (0.05 to 1.0): Crop zoom level
- Crop outputs include `imageops_crop_bbox` metadata in source-image coordinates for UI overlays/extensions
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🌀 ImageOps Distort
Channel-driven displacement warp inspired by iDistort-style workflows.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media to deform
- `displacement` (IMAGE/VIDEO, optional): External displacement plate when `map_source` is `displacement_channel`
- `mask` (MASK, optional): Used as the distortion map in `mask` mode, otherwise acts as an effect mask

**Parameters:**
- `map_source`: source_channel, displacement_channel, mask, or noise
- `x_channel`, `y_channel`: Choose independent channels for horizontal and vertical deformation
- `strength_x`, `strength_y`: Warp amplitude in pixels
- `centered_map`: Treat mid-gray as neutral displacement
- `invert_map`: Invert the driving map before warping
- `filter`: nearest, bilinear, bicubic
- `edge_mode`: border, reflection, zeros
- Internal noise controls: basis, fractal mode, scale, octaves, lacunarity, gain, seed, and offsets
- `invert_mask`: Invert the effect mask when the mask input is acting as an effect mask

**Outputs:** `IMAGE`, `MASK`

---

### 🔄 ImageOps Transform
Geometric transformations with quality filters.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `translate_x` (-4096 to 4096): Horizontal offset
- `translate_y` (-4096 to 4096): Vertical offset
- `rotate_deg` (-180 to 180): Rotation angle (clockwise positive)
- `scale` (0.01 to 8.0): Scale factor
- `filter`: Nearest, Bilinear, or Bicubic
- `expand`: Compatibility option; the GPU affine path keeps the output size fixed
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 📐 ImageOps Corner Pin
Perspective corner pinning for screen replacement, planar warps, and compositing.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media

**Parameters:**
- `tl_x`, `tl_y`: Top-left destination corner in normalized image coordinates
- `tr_x`, `tr_y`: Top-right destination corner in normalized image coordinates
- `bl_x`, `bl_y`: Bottom-left destination corner in normalized image coordinates
- `br_x`, `br_y`: Bottom-right destination corner in normalized image coordinates
- `filter`: Nearest, Bilinear, or Bicubic
- `supersample`: 1x to 4x multisampling before downsampling
- `edge_mode`: border, reflection, or zeros
- `invert_mask`: Invert the warped transparency mask
- `bypass`: Skip processing

The warp uses batched PyTorch homographies with `grid_sample`; RGBA input is premultiplied before warping so transparent edges stay clean.

**Outputs:** `IMAGE`, `MASK`

---

### 🧱 ImageOps Pad Out
Add borders around an image without scaling the source.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media

**Parameters:**
- `pad_left`, `pad_top`, `pad_right`, `pad_bottom`: Per-side padding in pixels
- `target_format`: custom, 1:1, 16:9, 9:16, 4:3, or 3:4
- `fill_mode`: constant, edge_extend, reflect, or blurry
- `fill_color`: Solid color for constant padding
- `blur_radius`: Background blur radius for blurry padding
- `invert_mask`: Invert the padding mask
- `bypass`: Skip processing

The `target_format` option adds only the extra padding needed to reach the selected ratio, so manual side padding can still decenter the source.

**Outputs:** `IMAGE`, `MASK`, `IMAGEOPS_PADOUT_STITCHER`

---

### ImageOps PadOut Stitch
Restore the original image into the protected PadOut region after an outpainting or image-edit node.

Recommended flow: connect `PadOut.image` and `PadOut.mask` to the outpainting node, then connect `PadOut.stitcher` and the outpainting result to PadOut Stitch.

**Inputs:**
- `outpainted` (IMAGE/VIDEO): Result returned by the image edit / outpainting node
- `stitcher` (IMAGEOPS_PADOUT_STITCHER, optional): Stitcher output from ImageOps PadOut
- `original` (IMAGE/VIDEO, optional): Fallback source media before PadOut
- `padout_mask` (MASK, optional): Fallback mask output from ImageOps PadOut

**Parameters:**
- `original_region`: Fallback mode when no stitcher is connected; `black_is_original` for PadOut's default mask, or `white_is_original` if PadOut's mask was inverted
- `feather_radius`: Optional softened edge where the original is restored
- `invert_mask`: Invert the returned outpaint-area mask
- `bypass`: Return the outpainted image unchanged

**Outputs:** `IMAGE`, `MASK`

---

### 🎭 ImageOps Invert
Invert colors and/or the alpha channel independently.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `invert_alpha`: Also invert the alpha channel (only applies to RGBA images with 4 channels)
- `invert_mask`: Invert the output mask
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🔮 ImageOps Spherize
Spherical, fisheye, and equirectangular lens-projection distortions.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Mask to multiply against the circle boundary

**Parameters:**
- `mode`: `spherize` (barrel/pincushion), `fisheye` (equidistant projection), `defisheye` (flatten fisheye), `latlong` (equirectangular → rectilinear), `unlatlong` (rectilinear → equirectangular)
- `strength` (0.0 to 2.0): Effect intensity; 1.0 = full projection, values > 1 push beyond the normal range
- `invert`: Swap the forward and inverse mapping directions (e.g. barrel ↔ pincushion, latlong ↔ unlatlong)
- `filter`: `bilinear`, `bicubic`, or `nearest` — resampling quality
- `edge_mode`: `border`, `reflection`, or `zeros` — behavior at the image boundary
- `size_mode`: `from_input` (use input dimensions) or `custom` (resize to `width` × `height` before applying)
- `width` / `height`: Target dimensions when `size_mode` is `custom`
- `bypass`: Skip processing

The output mask is a unit-circle alpha (1 inside the sphere, 0 outside), multiplied by the optional input mask.

**Outputs:** `IMAGE`, `MASK`

---

### 📏 ImageOps Clamp
Clamp pixel values to specified range.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `min_v` (-1.0 to 1.0): Minimum value
- `max_v` (0.0 to 2.0): Maximum value
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🔀 ImageOps Merge
Blend two images with linear-light or sRGB blend modes.

**Inputs:**
- `A` (IMAGE/VIDEO): Background layer
- `B` (IMAGE/VIDEO): Foreground layer
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `mode`: over, add, subtract, multiply, screen, overlay, soft_light, difference, max, min, lighten, darken, color_dodge, color_burn, exclusion, vivid_light, pin_light, hard_mix
- `mix` (0.0 to 1.0): Blend opacity
- `foreground_fit`: stretch, contain, cover, or none for adapting foreground B to background A
- `blend_space`: linear or srgb; linear performs RGB blend math in gamma 1.0 then converts back to sRGB
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🌫️ ImageOps Noise
Procedural texture generator for masks and grayscale or color noise plates.

**Parameters:**
- `width` / `height`: Output resolution (64 to 8192)
- `frame_length`: Number of frames to generate (1 to 256)
- `fps`: Preview playback speed
- `seed`: Deterministic noise seed
- `basis`: `perlin`, `value`, or `white`
- `fractal_mode`: `none`, `fbm`, `turbulence`, or `ridged`
- `scale`: Primary feature size
- `octaves` (1 to 12), `gain` (0.0 to 1.0): Fractal shaping controls
- `offset_z`: Static Z offset into the 3D noise field
- `animation_speed`: Z offset added per frame — higher = faster animation, 0 = still image
- `seamless`: Tileable X/Y noise for repeating textures
- `contrast`, `invert`: Output tonal shaping
- `low_color`, `high_color`: Color ramp applied to the grayscale output

**Outputs:** `IMAGE`, `MASK`

---

### 🖌️ ImageOps Paint
Digital painting and drawing tool.

**Inputs:**
- `image` (IMAGE/VIDEO, optional): Base media (creates blank canvas if not provided)

**Parameters:**
- `width` (64 to 4096): Canvas width
- `height` (64 to 4096): Canvas height
- `sync_dimensions`: Link width/height changes
- `bg_color`: Background color (hex)
- `tool`: Brush or Eraser
- `brush_color`: Brush color (hex)
- `brush_opacity` (0.0 to 1.0): Brush transparency
- `brush_size` (1 to 256): Brush diameter
- `brush_pressure_size`: Pen pressure modulates brush diameter
- `brush_pressure_opacity`: Pen pressure modulates brush opacity
- `brush_tilt_size`: Pen tilt can widen the brush footprint
- `overlay_format`: WebP or PNG payload encoding
- `overlay_data`: Encoded overlay payload; the preview stores cropped visible bounds to reduce transfer size
- `overlay_layers`: Optional JSON layer list for composing multiple overlay payloads
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

The node still accepts older full-frame Base64 PNG `overlay_data` values. New preview payloads are cropped to the visible painted bounds and can use WebP when the browser supports it; `overlay_layers` accepts `{"layers":[{"data":"...","opacity":1,"enabled":true}]}` for non-destructive multi-layer overlays.

**Outputs:** `IMAGE`, `MASK`

---

### 🎬 ImageOps Comp
Multi-layer compositor with professional controls.

**Inputs:**
- `image_1`, `image_2`, ... (IMAGE/VIDEO): Layer inputs
- `mask_1`, `mask_2`, ... (MASK): Per-layer masks
- Dynamic slot system with auto-expansion

**Parameters:**
- `bypass`: Skip processing
- `use_first_layer_size`: Use first layer as canvas size
- `auto_layering`: Use the largest connected layer dimensions as canvas size
- `width` (1 to 8192): Custom canvas width
- `height` (1 to 8192): Custom canvas height
- `background_color`: Canvas background (hex)
- `layers_json`: Layer configuration (auto-managed by UI)
- `invert_mask`: Invert output mask

**Interactive UI Features:**
- ➕ Add layer button
- 🔄 Reset layer button
- 🎨 Blend mode selector per layer
- 🎚️ Opacity slider per layer
- 🖱️ Drag-to-position layers on preview

**Outputs:** `IMAGE`, `MASK`

---

### 👁️ ImageOps Preview
Preview output node with advanced visualization modes.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Mask to preview

**Parameters:**
- `preview_target`: auto, image, or mask
- `mode`: 
  - `images`: Individual frames
  - `strip`: Horizontal strip for batch inspection
  - `animated_webp`: Animated WebP preview
  - `animated_gif`: Animated GIF preview

**Outputs:** `IMAGE`, `MASK`

---

## 🔧 Bypass Mode

All processing nodes expose a **`bypass`** parameter (boolean). When enabled:
- ✅ Node returns input unchanged
- ✅ Live preview skips applying the operation
- ✅ Useful for A/B comparison and workflow debugging

---

## 🖥️ Live Preview (Frontend)

### Architecture

| File | Purpose |
|------|---------|
| `js/preview/host.js` | Widget injection, video loop, Preview Pro UI (scopes/overlays/A‑B) |
| `js/preview/renderer.js` | Recursive render with caching (recursion limit: 64) |
| `js/preview/registry.js` | Adapter selection (core/WAS/VHS/generic/ImageOps) |
| `js/preview/ops.js` | Preview ops implementation (single source for preview behavior) |

### Preview Pro UI Features (ImageOpsPreview only)

- 📊 **Histogram**: Luminance distribution
- 🌊 **Waveform**: Luma or RGB waveform monitor
- 🎯 **Vectorscope**: Color vector analysis
- 🦓 **Zebra/False Color**: Exposure visualization
- ↔️ **A/B Compare**: Freeze and wipe comparison

### Interop Support

| Source | Adapters |
|--------|----------|
| **Core** | Basic invert/sharpen/blend (best effort) |
| **WAS** | Heuristics for common nodes |
| **VHS** | Video frame sources |
| **Generic** | Fallback adapter |

> ⚠️ **Fail-Soft**: Unsupported nodes don't break the graph - they simply bypass preview processing.

---

## ⚙️ Configuration

### Preview Canvas Size
```javascript
localStorage["imageops.preview.canvasSize"] = 512; // Default: 512px
```

### Large Image Warning Threshold
```bash
# Environment variable (in MB)
IMAGEOPS_LARGE_IMAGE_WARN_MB=2048  # Default: 2048 MB
```

---

## 📝 Notes & Troubleshooting

### ⚠️ Deprecation Warnings
If ComfyUI logs `[DEPRECATION WARNING]`, another extension is using legacy frontend APIs. This doesn't affect ImageOps functionality.

### 🎥 Video/Frame Sources
Some packs expose video via custom types. Best results when upstream provides frames as `IMAGE` batches.

### 🔌 Input Types
- **IMAGE**: Standard ComfyUI image batches `[B, H, W, C]`
- **VIDEO**: Frame sources from video nodes (VHS, etc.)
- **MASK**: Single-channel masks `[B, H, W]`

### 🎨 Blend Modes Reference

| Mode | Description |
|------|-------------|
| `over` | Standard alpha compositing |
| `add` | Additive blending (brightens) |
| `subtract` | Subtractive blending (darkens) |
| `multiply` | Multiply colors (darkens) |
| `screen` | Screen blend (brightens) |
| `difference` | Absolute difference |
| `max` | Maximum of each channel |
| `min` | Minimum of each channel |

### 🎛️ Compositor Blend Modes

| Mode | Canvas Operation |
|------|------------------|
| `over` | source-over |
| `add` | lighter |
| `multiply` | multiply |
| `screen` | screen |
| `overlay` | overlay |
| `soft_light` | soft-light |
| `difference` | difference |
| `lighten` | lighten |
| `darken` | darken |
| `color_dodge` | color-dodge |
| `color_burn` | color-burn |
| `exclusion` | exclusion |

---

## 🏗️ Technical Details

### Batch Processing
All nodes process batches natively:
- Single images: `[1, H, W, C]`
- Image sequences: `[B, H, W, C]`
- Video frames: `[B, H, W, C]`

### Mask Handling
- Masks are automatically prepared and matched to reference dimensions
- `invert_mask` affects both processing and output mask
- Alpha channel extracted as mask when available

### Color Space
- All processing in linear float32 `[0.0, 1.0]`
- Luma weights: `[0.2126, 0.7152, 0.0722]` (Rec. 709)
- Gamma safe range: `0.2` to `5.0`

### Performance
- Live preview uses optimized canvas rendering
- Recursive render cache limit: 64 nodes
- Large image warning threshold: 2048 MB (configurable)

---

## 📄 License

*Check the repository for license information.*

---

## 🙏 Credits

**Author**: Majoor  
**Category**: `image/imageops`  
**Version**: 0.1.2

---

## 📋 Changelog

### Recent changes
- **ImageOps Spherize** — new node with five projection modes (spherize, fisheye, defisheye, latlong, unlatlong), bicubic/bilinear/nearest filter, edge modes, custom output size, and circle-mask output
- **ImageOps Corner Pin** — bicubic interpolation option added
- **ImageOps Color Correct** — enhanced color correction capabilities
- **ImageOps Preview** — improved noise node performance and zoom/pan interactions
- **ImageOps Invert** — `invert_alpha` is now a proper UI checkbox (previously in the signature but not exposed); RGBA images can invert color and alpha independently
- **ImageOps Noise** — incremental CPU transfer during frame generation reduces peak VRAM usage on large batches; deprecated legacy parameters (`seed_step`, `compute_device`, `offset_x/y`, `frame_offset_x/y/z`, `lacunarity`) removed from UI (still accepted in saved workflows for backwards compatibility)

---

<div align="center">

**Made with ❤️ for the ComfyUI community**

[Report Issues](https://github.com/yourusername/ComfyUI-Majoor-ImageOps/issues) • [Request Features](https://github.com/yourusername/ComfyUI-Majoor-ImageOps/issues)

</div>
