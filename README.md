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
| **ImageOps Resize/Crop** | `ImageOpsCrop` | Interactive crop and resize with aspect ratio presets |
| **ImageOps Distort** | `ImageOpsDistort` | iDistort-style displacement warp driven by source channels, external maps, masks, or internal procedural noise |
| **ImageOps Transform** | `ImageOpsTransform` | Translate, rotate, scale with filter options (nearest/bilinear/bicubic) |
| **ImageOps Invert** | `ImageOpsInvert` | Invert colors and/or alpha channel |
| **ImageOps Clamp** | `ImageOpsClamp` | Clamp pixel values to min/max range |
| **ImageOps Merge** | `ImageOpsMerge` | Blend two images with multiple blend modes (over, add, subtract, multiply, screen, difference, max, min) |
| **ImageOps Noise** | `ImageOpsNoise` | Procedural noise source with Perlin, value, FBM, turbulence, ridged, seed stepping, and color ramp output |
| **ImageOps Draw** | `ImageOpsDraw` | Digital painting with brush/eraser tools, opacity, and color controls |
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
- `hue` (-90 to 90): Hue rotation in degrees
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
- `radius` (0 to 128): Blur radius in pixels
- `sigma` (0.01 to 64.0): Gaussian sigma value
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
- `expand`: Expand canvas to fit rotated content
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🎭 ImageOps Invert
Invert colors and/or alpha channel.

**Inputs:**
- `image` (IMAGE/VIDEO): Source media
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `invert_alpha`: Also invert alpha channel
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

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
Blend two images with various blend modes.

**Inputs:**
- `A` (IMAGE/VIDEO): Background layer
- `B` (IMAGE/VIDEO): Foreground layer
- `mask` (MASK, optional): Effect mask

**Parameters:**
- `mode`: over, add, subtract, multiply, screen, difference, max, min
- `mix` (0.0 to 1.0): Blend opacity
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

**Outputs:** `IMAGE`, `MASK`

---

### 🌫️ ImageOps Noise
Procedural texture generator for masks and grayscale or color noise plates.

**Parameters:**
- `basis`: perlin, value, or white
- `fractal_mode`: none, fbm, turbulence, or ridged
- `seed` / `seed_step`: deterministic variation across frames
- `scale`: primary feature size
- `octaves`, `lacunarity`, `gain`: fractal shaping controls
- `offset_x`, `offset_y`: pattern translation
- `frame_offset_x`, `frame_offset_y`: per-frame motion offset
- `contrast`, `invert`: output shaping
- `low_color`, `high_color`: color ramp for the generated image

**Outputs:** `IMAGE`, `MASK`

---

### 🖌️ ImageOps Draw
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
- `overlay_data`: Base64-encoded overlay image
- `invert_mask`: Invert mask effect
- `bypass`: Skip processing

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
**Version**: 6.x (LivePreview v6)

---

<div align="center">

**Made with ❤️ for the ComfyUI community**

[Report Issues](https://github.com/yourusername/ComfyUI-Majoor-ImageOps/issues) • [Request Features](https://github.com/yourusername/ComfyUI-Majoor-ImageOps/issues)

</div>
