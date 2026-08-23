# ComfyUI-Majoor-ImageOps — Professional Compositing Evolution Plan
## Implementation document for Codex 5.6 Sol

**Target:** evolve the 26 ImageOps nodes from a strong ComfyUI image-processing pack into a professional compositing toolkit with consistent VFX semantics, modern ComfyUI V3 integration, deterministic GPU behavior, HDR-safe processing, professional alpha/mask handling, temporal/video awareness, reusable engines, and workflow-safe migrations.

**Repository:** `ComfyUI-Majoor-ImageOps`  
**Audience:** Codex 5.6 Sol / automated coding agent  
**Target quality:** **>= 9/10 production engineering quality** after the stabilization roadmap is complete.  
**Scope:** architecture + shared engines + behavior + UI schema + backend implementation + tests + migration + performance.  
**Out of scope:** rewriting the entire project from scratch, adding a DAW/NLE, replacing ComfyUI public datatypes with proprietary sockets, or introducing large third-party runtime dependencies without a demonstrated need.

---

# 0. Agent operating contract

Codex MUST treat this document as an execution specification, not as a loose idea list.

## 0.1 Required working rules

- [ ] Read the current repository before editing.
- [ ] Read the current official ComfyUI V3 documentation and the installed `comfy_api` source before relying on API details.
- [ ] Preserve existing workflow compatibility unless an explicit `NodeReplace` migration is provided.
- [ ] Do not change all 26 nodes in one monolithic PR.
- [ ] Work in small, reviewable phases.
- [ ] Add tests before or with each semantic change.
- [ ] Do not silently change alpha semantics, coordinate conventions, batch policy, blend math, or output range.
- [ ] Do not clamp RGB to `[0, 1]` unless the node's mathematical contract explicitly requires it.
- [ ] Do not implement hidden cyclic batch repetition.
- [ ] Do not allocate full-resolution intermediates without passing through the shared memory budget.
- [ ] Do not use `torch.Tensor.item()` in frame loops unless unavoidable.
- [ ] Avoid CPU round-trips in processing nodes.
- [ ] Keep public ComfyUI sockets interoperable: `IMAGE`, `MASK`, `VIDEO`, `AUDIO`, numeric outputs, etc.
- [ ] Prefer shared engines over duplicating algorithms per node.
- [ ] Run unit tests, frontend tests, schema tests, and ComfyUI integration tests before marking a phase complete.
- [ ] Preserve the existing live-preview frontend unless a migration is intentionally included.
- [ ] Every new user-facing behavior must have a tooltip and a deterministic default.

## 0.2 Official sources that MUST be checked

Current documentation verified on **2026-08-22**:

- ComfyUI V3 migration:
  - `https://docs.comfy.org/custom-nodes/v3_migration`
- Lazy evaluation:
  - `https://docs.comfy.org/custom-nodes/backend/lazy_evaluation`
- Node replacement:
  - `https://docs.comfy.org/custom-nodes/backend/node-replacement`
- LoadVideo:
  - `https://docs.comfy.org/built-in-nodes/LoadVideo`
- GetVideoComponents:
  - `https://docs.comfy.org/built-in-nodes/GetVideoComponents`
- CreateVideo:
  - `https://docs.comfy.org/built-in-nodes/CreateVideo`

Important current API facts:

```python
from comfy_api.latest import ComfyExtension, ComfyAPI, io, ui
```

V3 nodes use:

```python
class MyNode(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        ...

    @classmethod
    def execute(cls, ...) -> io.NodeOutput:
        return io.NodeOutput(...)
```

The official docs explicitly state that `comfy_api.latest` follows the latest numbered API that may still be under development. The project therefore MUST keep ComfyUI version compatibility explicit and tested.

---

# 1. Target architecture

The project should stop behaving like 26 independent filters.

It should become:

```text
ComfyUI public sockets
IMAGE / MASK / VIDEO / AUDIO / FLOAT / INT
                     │
                     ▼
          ImageOps normalization layer
                     │
          ┌──────────┴──────────┐
          │                     │
     SurfaceContext        TimelineContext
          │                     │
          ├──────────┬──────────┤
          │          │          │
       Color      Geometry    Procedural
          │          │          │
       Grade      Transform    Noise
       Merge      Warp         Grain
       Keyer      Crop         Ramp
                  CornerPin
          │          │          │
          └──────────┼──────────┘
                     │
              Shared engines
                     │
    alpha / mask / channels / bbox / batch
    sampling / memory / cache / animation
    video timing / audio policy / validation
                     │
                     ▼
                 Tensor
                     │
                     ▼
                io.NodeOutput
```

The fundamental rule:

> **A node describes an operation. Shared core modules define compositing semantics.**

---

# 2. Proposed core package

Create or evolve the core into:

```text
nodes/core/
├── __init__.py
├── surface.py
├── format.py
├── bbox.py
├── channels.py
├── alpha.py
├── color.py
├── blend.py
├── sampling.py
├── transform.py
├── warp.py
├── batch.py
├── parameters.py
├── masks.py
├── timeline.py
├── video.py
├── memory.py
├── roi.py
├── cache.py
├── validation.py
└── types.py
```

Do not create files merely for aesthetics. Create them when at least two nodes use the abstraction.

---

# 3. Core image contract

## 3.1 RGB / alpha / mask domain

Adopt this explicit contract:

```text
RGB:
    finite float tensor
    negative values allowed
    values > 1 allowed

ALPHA:
    finite float
    canonical processing range [0, 1]

MASK:
    finite float
    canonical processing range [0, 1]

DISPLAY/PREVIEW:
    display transform may clamp or tonemap
    never mutate processing tensor
```

## 3.2 Tensor layout

Public ComfyUI image:

```text
[B, H, W, C]
```

Mask:

```text
[B, H, W]
```

Internal kernels may temporarily use:

```text
[B, C, H, W]
```

but conversion must be centralized.

Suggested helpers:

```python
# nodes/core/surface.py

from __future__ import annotations
from dataclasses import dataclass
import torch

@dataclass(frozen=True)
class SurfaceInfo:
    batch: int
    height: int
    width: int
    channels: int
    dtype: torch.dtype
    device: torch.device

def inspect_image(image: torch.Tensor) -> SurfaceInfo:
    if image.ndim != 4:
        raise ValueError(f"IMAGE must be BHWC, got shape={tuple(image.shape)}")
    b, h, w, c = image.shape
    if c not in (1, 3, 4):
        raise ValueError(f"Unsupported channel count: {c}")
    return SurfaceInfo(
        batch=b,
        height=h,
        width=w,
        channels=c,
        dtype=image.dtype,
        device=image.device,
    )

def bhwc_to_bchw(image: torch.Tensor) -> torch.Tensor:
    return image.permute(0, 3, 1, 2).contiguous()

def bchw_to_bhwc(image: torch.Tensor) -> torch.Tensor:
    return image.permute(0, 2, 3, 1).contiguous()
```

## 3.3 Finite-value sanitation

Do not blindly clamp RGB.

```python
# nodes/core/validation.py

import torch

def sanitize_finite(
    x: torch.Tensor,
    *,
    nan: float = 0.0,
    posinf: float | None = None,
    neginf: float | None = None,
) -> torch.Tensor:
    if torch.isfinite(x).all():
        return x
    return torch.nan_to_num(
        x,
        nan=nan,
        posinf=posinf,
        neginf=neginf,
    )

def clamp_mask(mask: torch.Tensor) -> torch.Tensor:
    return sanitize_finite(mask).clamp_(0.0, 1.0)

def clamp_alpha(alpha: torch.Tensor) -> torch.Tensor:
    return sanitize_finite(alpha).clamp_(0.0, 1.0)
```

---

# 4. Professional alpha contract

Alpha behavior must be identical across nodes.

## 4.1 Premult / unpremult

```python
# nodes/core/alpha.py

from __future__ import annotations
import torch

_EPS = 1e-6

def split_rgba(image: torch.Tensor):
    if image.shape[-1] == 4:
        return image[..., :3], image[..., 3:4]
    return image[..., :3], None

def premultiply(rgb: torch.Tensor, alpha: torch.Tensor | None) -> torch.Tensor:
    if alpha is None:
        return rgb
    return rgb * alpha

def unpremultiply(
    rgb: torch.Tensor,
    alpha: torch.Tensor | None,
    eps: float = _EPS,
) -> torch.Tensor:
    if alpha is None:
        return rgb
    safe = torch.where(alpha.abs() > eps, alpha, torch.ones_like(alpha))
    result = rgb / safe
    return torch.where(alpha.abs() > eps, result, torch.zeros_like(result))

def replace_alpha(image: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    alpha = alpha.clamp(0.0, 1.0)
    if image.shape[-1] == 4:
        return torch.cat((image[..., :3], alpha), dim=-1)
    return torch.cat((image[..., :3], alpha), dim=-1)
```

## 4.2 Color operations on premultiplied images

A color correct should normally process straight RGB and then restore premultiplication if required.

Conceptual pattern:

```python
rgb, alpha = split_rgba(image)

straight = unpremultiply(rgb, alpha)
graded = grade_rgb(straight, params)
rgb_out = premultiply(graded, alpha)

out = torch.cat([rgb_out, alpha], dim=-1) if alpha is not None else rgb_out
```

The project must expose or document an `alpha_mode` policy where relevant:

```text
auto
straight
premultiplied
```

Default should minimize workflow surprises.

---

# 5. Universal mask + mix contract

All effect nodes with a mask MUST behave as:

```text
mask = 0 → original
mask = 1 → fully processed
mix = 0 → original
mix = 1 → mask-controlled processed result
```

Central implementation:

```python
# nodes/core/masks.py

from __future__ import annotations
import torch

def normalize_mask(
    mask: torch.Tensor | None,
    *,
    target_batch: int,
    height: int,
    width: int,
    invert: bool = False,
) -> torch.Tensor | None:
    if mask is None:
        return None

    # Batch alignment MUST use shared BatchPolicy.
    # Resize should use explicit interpolation policy.
    mask = mask.float().clamp(0.0, 1.0)

    if invert:
        mask = 1.0 - mask

    return mask

def apply_mask_mix(
    source: torch.Tensor,
    processed: torch.Tensor,
    mask: torch.Tensor | None,
    mix: float | torch.Tensor = 1.0,
) -> torch.Tensor:
    if mask is None:
        weight = mix
    else:
        if mask.ndim == 3:
            mask = mask.unsqueeze(-1)
        weight = mask * mix

    return source + (processed - source) * weight
```

Never reimplement this formula differently in each node.

---

# 6. Batch contract

No silent arbitrary cycling.

Allowed policies:

```text
strict
broadcast_singleton
hold_last
loop              # only when explicitly selected by user/node semantics
```

Suggested API:

```python
# nodes/core/batch.py

from enum import StrEnum
import torch

class BatchPolicy(StrEnum):
    STRICT = "strict"
    BROADCAST_SINGLETON = "broadcast_singleton"
    HOLD_LAST = "hold_last"
    LOOP = "loop"

def align_batch(
    tensor: torch.Tensor,
    target: int,
    *,
    policy: BatchPolicy,
    name: str,
) -> torch.Tensor:
    n = tensor.shape[0]

    if n == target:
        return tensor

    if n == 1 and policy in {
        BatchPolicy.BROADCAST_SINGLETON,
        BatchPolicy.HOLD_LAST,
        BatchPolicy.LOOP,
    }:
        return tensor.expand(target, *tensor.shape[1:])

    if policy == BatchPolicy.HOLD_LAST:
        idx = torch.arange(target, device=tensor.device).clamp_max(n - 1)
        return tensor.index_select(0, idx)

    if policy == BatchPolicy.LOOP:
        idx = torch.arange(target, device=tensor.device) % n
        return tensor.index_select(0, idx)

    raise ValueError(
        f"{name}: batch {n} cannot be aligned to {target} with policy={policy}"
    )
```

Delete legacy helpers that use `repeat(ceil(target/n))` unless the node explicitly requests loop semantics.

---

# 7. Per-frame parameter animation

Every animatable numeric parameter should support a single scalar or a per-frame sequence through one resolver.

```python
# nodes/core/parameters.py

from __future__ import annotations
from collections.abc import Sequence
import torch

def resolve_frame_parameter(
    value,
    frame_count: int,
    *,
    device: torch.device,
    dtype: torch.dtype = torch.float32,
    policy: str = "hold",
) -> torch.Tensor:
    if isinstance(value, torch.Tensor):
        x = value.to(device=device, dtype=dtype).flatten()
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        x = torch.as_tensor(value, device=device, dtype=dtype).flatten()
    else:
        return torch.full((frame_count,), float(value), device=device, dtype=dtype)

    if x.numel() == frame_count:
        return x

    if x.numel() == 1:
        return x.expand(frame_count)

    if policy == "hold":
        idx = torch.arange(frame_count, device=device).clamp_max(x.numel() - 1)
        return x.index_select(0, idx)

    if policy == "loop":
        idx = torch.arange(frame_count, device=device) % x.numel()
        return x.index_select(0, idx)

    raise ValueError(
        f"Cannot resolve parameter length={x.numel()} to {frame_count}"
    )
```

This becomes the basis of future curve-editor support.

---

# 8. Mixed per-frame bypass

Centralize bypass.

```python
def resolve_bypass_mask(bypass, frame_count: int, device) -> torch.Tensor:
    if isinstance(bypass, bool):
        return torch.full((frame_count,), bypass, dtype=torch.bool, device=device)

    values = torch.as_tensor(bypass, dtype=torch.bool, device=device).flatten()
    return align_batch(
        values,
        frame_count,
        policy=BatchPolicy.HOLD_LAST,
        name="bypass",
    )

def process_active_frames(source, bypass_mask, process_fn):
    if bypass_mask.all():
        return source

    if not bypass_mask.any():
        return process_fn(source)

    result = source.clone()
    active = ~bypass_mask
    result[active] = process_fn(source[active])
    return result
```

No node should interpret `[False, True, False]` as "process all frames".

---

# 9. Format + bounding box + ROI

Professional compositing distinguishes image format from useful pixel bounds.

## 9.1 BBox model

```python
# nodes/core/bbox.py

from dataclasses import dataclass

@dataclass(frozen=True)
class BBox:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return max(0, self.x1 - self.x0)

    @property
    def height(self) -> int:
        return max(0, self.y1 - self.y0)

    def expand(self, pixels: int) -> "BBox":
        return BBox(
            self.x0 - pixels,
            self.y0 - pixels,
            self.x1 + pixels,
            self.y1 + pixels,
        )

    def intersect(self, other: "BBox") -> "BBox":
        return BBox(
            max(self.x0, other.x0),
            max(self.y0, other.y0),
            min(self.x1, other.x1),
            min(self.y1, other.y1),
        )
```

## 9.2 Important constraint

ComfyUI `IMAGE` is still a dense tensor. ROI metadata must therefore be treated as an **internal optimization hint**, not as a replacement public image representation unless a separate internal object is used only inside ImageOps.

Do not make the pack incompatible with normal ComfyUI nodes.

## 9.3 ROI usage examples

Blur:

```text
output ROI = input bbox expanded by blur kernel radius
```

Transform:

```text
output ROI = transformed corners of input bbox
```

Merge:

```text
output ROI = union(A.bbox, B.bbox)
```

Crop:

```text
output ROI = crop rectangle
```

Comp:

```text
process only union of active layer bounds where practical
```

---

# 10. Sampling engine

All geometry nodes must use the same public filter vocabulary.

```python
class FilterMode:
    NEAREST = "nearest"
    BILINEAR = "bilinear"
    BICUBIC = "bicubic"
    LANCZOS = "lanczos"
    AREA = "area"
```

And edge modes:

```python
class EdgeMode:
    BLACK = "black"
    CLAMP = "clamp"
    MIRROR = "mirror"
    WRAP = "wrap"
    TRANSPARENT = "transparent"
```

Implement a single adapter that maps ImageOps names to PyTorch/grid-sampling behavior.

Do not let Transform, CornerPin, Distort, Spherize and Reformat each invent different names.

---

# 11. Transform matrix engine

Create one transform engine used by Transform, CameraShake, Comp layers, and optionally Text.

Use homogeneous coordinates.

```python
# nodes/core/transform.py

import torch
import math

def mat_translate(tx, ty, *, device, dtype):
    return torch.tensor([
        [1.0, 0.0, tx],
        [0.0, 1.0, ty],
        [0.0, 0.0, 1.0],
    ], device=device, dtype=dtype)

def mat_scale(sx, sy, *, device, dtype):
    return torch.tensor([
        [sx, 0.0, 0.0],
        [0.0, sy, 0.0],
        [0.0, 0.0, 1.0],
    ], device=device, dtype=dtype)

def mat_rotate(degrees, *, device, dtype):
    r = math.radians(float(degrees))
    c, s = math.cos(r), math.sin(r)
    return torch.tensor([
        [c, -s, 0.0],
        [s,  c, 0.0],
        [0.0, 0.0, 1.0],
    ], device=device, dtype=dtype)

def build_2d_transform(
    *,
    tx,
    ty,
    sx,
    sy,
    rotation,
    pivot_x,
    pivot_y,
    device,
    dtype,
):
    return (
        mat_translate(tx, ty, device=device, dtype=dtype)
        @ mat_translate(pivot_x, pivot_y, device=device, dtype=dtype)
        @ mat_rotate(rotation, device=device, dtype=dtype)
        @ mat_scale(sx, sy, device=device, dtype=dtype)
        @ mat_translate(-pivot_x, -pivot_y, device=device, dtype=dtype)
    )
```

The exact pixel ↔ normalized coordinate conversion must be centralized and tested with golden coordinate cases.

---

# 12. Memory budget

Every potentially large node must estimate its working set.

```python
check_budget(
    batch=B,
    height=H,
    width=W,
    channels=C,
    multiplier=working_set_multiplier,
    label="ImageOps Transform",
)
```

Suggested initial multipliers to benchmark, not blindly accept:

```text
Constant       1.5
Ramp           2.0
ColorCorrect   3.0
Blur           4.0–8.0 depending kernel/path
Transform      4.0
CornerPin      5.0
Distort        5.0–8.0
Spherize       5.0
Grain          3.0
Comp           dynamic based on active layers
Preview        CPU/display budget separately
CameraShake    4.0
```

Use chunking when batch size or resolution exceeds the budget.

---

# 13. V3 schema patterns

## 13.1 Proper Combo

Wrong:

```python
io.String.Input("mode", default="gaussian")
```

Correct:

```python
io.Combo.Input(
    "mode",
    options=["gaussian", "box", "defocus"],
    default="gaussian",
)
```

## 13.2 Advanced controls

```python
io.Combo.Input(
    "edge_mode",
    options=["black", "clamp", "mirror", "wrap"],
    default="clamp",
    advanced=True,
)
```

## 13.3 DynamicCombo

Use when selected mode changes which controls should exist.

Example Reformat:

```python
io.DynamicCombo.Input(
    "resize_mode",
    options=[
        io.DynamicCombo.Option(
            "dimensions",
            [
                io.Int.Input("width", default=1920, min=1, max=16384),
                io.Int.Input("height", default=1080, min=1, max=16384),
            ],
        ),
        io.DynamicCombo.Option(
            "scale",
            [
                io.Float.Input(
                    "scale",
                    default=1.0,
                    min=0.01,
                    max=16.0,
                    step=0.01,
                ),
            ],
        ),
        io.DynamicCombo.Option(
            "megapixels",
            [
                io.Float.Input(
                    "megapixels",
                    default=2.0,
                    min=0.01,
                    max=256.0,
                ),
            ],
        ),
    ],
)
```

Execute:

```python
resize_mode = resize_mode_dict["resize_mode"]

if resize_mode == "dimensions":
    width = resize_mode_dict["width"]
    height = resize_mode_dict["height"]
elif resize_mode == "scale":
    scale = resize_mode_dict["scale"]
```

Always verify exact dictionary keys against the installed API version.

## 13.4 Autogrow

Use for true variable input counts such as Append and eventually Comp.

```python
template = io.Autogrow.TemplatePrefix(
    input=io.Image.Input("image"),
    prefix="image",
    min=2,
    max=64,
)

io.Autogrow.Input("images", template=template)
```

Do not convert nodes to Autogrow before compatibility tests and node replacement mappings are ready.

## 13.5 NodeOutput

All nodes:

```python
return io.NodeOutput(result)
```

Multiple outputs:

```python
return io.NodeOutput(image, mask, width, height)
```

Preview:

```python
return io.NodeOutput(
    image,
    ui=ui.PreviewImage(image, cls=cls),
)
```

## 13.6 Lazy inputs

Example Merge:

```python
io.Image.Input("A"),
io.Image.Input("B", lazy=True),
```

Conceptual V3:

```python
@classmethod
def check_lazy_status(cls, A, B, mix, **kwargs):
    if mix <= 0.0:
        return []
    if B is None:
        return ["B"]
    return []
```

Confirm the exact current method signature in the installed Comfy API before implementation because lazy-evaluation docs contain legacy and migration examples.

## 13.7 Cache fingerprint

Use only where a node has external or procedural change semantics that the default graph fingerprint does not fully express.

```python
@classmethod
def fingerprint_inputs(cls, seed, width, height, noise_type, **kwargs):
    return (
        int(seed),
        int(width),
        int(height),
        str(noise_type),
    )
```

Do not return constant `True`.

## 13.8 Lifecycle

```python
from comfy_api.latest import ComfyExtension

class MajoorImageOpsExtension(ComfyExtension):
    async def on_load(self) -> None:
        await register_node_replacements()
        register_imageops_routes()
        initialize_shared_caches()

    async def get_node_list(self):
        return NODES

async def comfy_entrypoint():
    return MajoorImageOpsExtension()
```

Route registration must be idempotent.

## 13.9 Node replacement

```python
from comfy_api.latest import ComfyAPI, io

api = ComfyAPI()

async def register_node_replacements():
    await api.node_replacement.register(
        io.NodeReplace(
            new_node_id="ImageOpsReformat",
            old_node_id="ImageOpsCrop",
            old_widget_ids=[
                "aspect_ratio",
                "width",
                "height",
            ],
            input_mapping=[
                {"new_id": "image", "old_id": "image"},
            ],
            output_mapping=[
                {"new_idx": 0, "old_idx": 0},
            ],
        )
    )
```

Only use replacement when the old node ID/input layout actually changes.

---

# 14. UI design rule

A professional node must not become a cockpit.

Default view:

```text
5–8 primary controls
```

Advanced:

```text
technical controls
alpha policy
edge policy
sampling
bbox/format policy
quality
memory-sensitive options
```

Use tooltips for every non-obvious VFX term.

---

# 15. NODE 01 — Color Correct → professional Grade

## Target

A single production-grade color operator that works safely on HDR values and optionally respects premultiplied alpha.

## Primary UI

```text
Exposure
Contrast
Pivot
Gamma
Saturation
Temperature
Tint
Mix
Mask
```

## Advanced

```text
Lift
Gain
Offset
Vibrance
Hue
Working Mode: linear / display-style
Alpha Mode: auto / straight / premultiplied
Clamp: none / alpha-only / 0-1
```

## Core math

Exposure:

```python
rgb = rgb * (2.0 ** exposure)
```

Contrast around pivot:

```python
rgb = (rgb - pivot) * contrast + pivot
```

Gain + lift + offset:

```python
rgb = (rgb + lift) * gain + offset
```

Gamma must handle negatives predictably. Suggested signed power:

```python
def signed_pow(x, exponent, eps=1e-8):
    return torch.sign(x) * torch.pow(torch.abs(x).clamp_min(eps), exponent)

rgb = signed_pow(rgb, 1.0 / max(gamma, 1e-6))
```

Do not claim this is an ACES grade operator. It is a generic scene-linear-safe operator.

Luminance for saturation:

```python
luma = (
    rgb[..., 0:1] * 0.2126
    + rgb[..., 1:2] * 0.7152
    + rgb[..., 2:3] * 0.0722
)
rgb = luma + (rgb - luma) * saturation
```

## Alpha-safe path

```python
rgb, alpha = split_rgba(source)

if alpha_mode == "premultiplied":
    rgb = unpremultiply(rgb, alpha)

rgb = apply_grade(rgb, params)

if alpha_mode == "premultiplied":
    rgb = premultiply(rgb, alpha)
```

## Tests

- [ ] negative RGB survives with clamp=none
- [ ] RGB > 1 survives
- [ ] exposure +1 doubles RGB
- [ ] mix=0 exact input
- [ ] mask=0 exact input
- [ ] premult/unpremult round trip within tolerance
- [ ] batch animated exposure
- [ ] mixed bypass

## Definition of Done

- [ ] no unconditional RGB clamp
- [ ] shared mask/mix contract
- [ ] shared alpha helpers
- [ ] preview parity where frontend supports grade

---

# 16. NODE 02 — Blur → professional spatial filter

## Modes

```text
Gaussian
Box
Defocus
Directional   # optional phase 2
Radial        # optional phase 2
```

## Primary controls

```text
Size X
Size Y
Lock X/Y
Mode
Mix
Mask
```

## Advanced

```text
Edge mode
Channels
Quality
Alpha mode
```

## Gaussian

Use separable convolution where possible.

Kernel:

```python
def gaussian_kernel1d(radius: float, device, dtype):
    sigma = max(radius / 3.0, 1e-6)
    half = max(1, int(round(radius)))
    x = torch.arange(-half, half + 1, device=device, dtype=dtype)
    k = torch.exp(-(x * x) / (2.0 * sigma * sigma))
    return k / k.sum()
```

Do not hard-code one sigma mapping without documenting it.

## Channels

Implement shared channel mask:

```python
selected = channel_mask("rgb")  # conceptual
```

Avoid processing alpha unless requested.

## BBox

Logical ROI:

```python
output_bbox = input_bbox.expand(math.ceil(max(size_x, size_y)))
```

## Tests

- [ ] zero radius exact no-op
- [ ] X-only blur
- [ ] Y-only blur
- [ ] alpha unchanged for RGB mode
- [ ] edge mode golden fixtures
- [ ] HDR values remain HDR
- [ ] memory chunk test
- [ ] mixed per-frame bypass

---

# 17. NODE 03 — Camera Shake → deterministic temporal transform

## Modes

```text
Handheld
Smooth Drift
Impact
Vehicle
Custom
```

## Controls

```text
Translation X
Translation Y
Rotation
Scale
Frequency
Smoothness
Seed
Phase
```

## Advanced

```text
Motion Blur
Shutter Angle
Samples
Edge Mode
Filter
```

## Deterministic motion

Do not use Python global RNG.

Generate frame-time noise from a seed:

```python
def seeded_randn(count, *, seed, device, dtype):
    gen = torch.Generator(device=device)
    gen.manual_seed(int(seed))
    return torch.randn(count, generator=gen, device=device, dtype=dtype)
```

For smooth handheld motion, low-pass noise rather than independently randomizing frames.

Concept:

```python
noise = seeded_randn(frame_count + pad, ...)
kernel = gaussian_temporal_kernel(smoothness, ...)
motion = conv1d(noise, kernel)
```

Then:

```python
matrix_n = build_2d_transform(
    tx=motion_x[n] * amplitude_x,
    ty=motion_y[n] * amplitude_y,
    rotation=motion_r[n] * rotation_amount,
    ...
)
```

## Motion blur

Sample transforms across the shutter interval:

```text
frame time t
shutter angle 180°
=> exposure interval roughly 0.5 frame
```

Approximation:

```python
sample_times = torch.linspace(
    -shutter_fraction * 0.5,
    shutter_fraction * 0.5,
    samples,
    device=device,
)
```

Warp each sample and average in the working domain.

## Tests

- [ ] same seed => identical result
- [ ] different seed => different result
- [ ] zero amplitude => exact input
- [ ] no frame-to-frame RNG CPU transfer
- [ ] memory budget
- [ ] motion blur samples deterministic

---

# 18. NODE 04 — Channel → Shuffle

## Target

Make Channel a compositing-grade channel routing node.

## Per-output channel source

Options for R/G/B/A:

```text
R
G
B
A
Luma
Zero
One
Mask
```

## Example schema concept

```python
CHANNEL_OPTIONS = ["R", "G", "B", "A", "Luma", "Zero", "One", "Mask"]

io.Combo.Input("out_r", options=CHANNEL_OPTIONS, default="R"),
io.Combo.Input("out_g", options=CHANNEL_OPTIONS, default="G"),
io.Combo.Input("out_b", options=CHANNEL_OPTIONS, default="B"),
io.Combo.Input("out_a", options=CHANNEL_OPTIONS, default="A"),
```

## Implementation

```python
def get_component(image, name, optional_mask=None):
    rgb, alpha = split_rgba(image)

    if name == "R":
        return rgb[..., 0:1]
    if name == "G":
        return rgb[..., 1:2]
    if name == "B":
        return rgb[..., 2:3]
    if name == "A":
        return alpha if alpha is not None else torch.ones_like(rgb[..., 0:1])
    if name == "Luma":
        return (
            rgb[..., 0:1] * 0.2126
            + rgb[..., 1:2] * 0.7152
            + rgb[..., 2:3] * 0.0722
        )
    if name == "Zero":
        return torch.zeros_like(rgb[..., 0:1])
    if name == "One":
        return torch.ones_like(rgb[..., 0:1])
    if name == "Mask":
        if optional_mask is None:
            raise ValueError("Mask source selected but no mask connected")
        return optional_mask.unsqueeze(-1)
    raise ValueError(name)
```

## Tests

- [ ] RGB swap
- [ ] alpha to RGB
- [ ] luma to alpha
- [ ] zero/one constants
- [ ] no alpha input behavior
- [ ] mask source validation

---

# 19. NODE 05 — CornerPin → production corner pin

## Inputs

Two quads:

```text
FROM:
TL TR BR BL

TO:
TL TR BR BL
```

Do not mix corner ordering.

## Homography

Solve:

```text
p_to ~ H * p_from
```

Use a numerically stable batched solver.

Conceptual DLT:

```python
def solve_homography(src_xy, dst_xy):
    # src_xy, dst_xy: [B, 4, 2]
    # build A and solve h with h33=1 or use SVD
    ...
```

Prefer an implementation covered by precise identity, translation, scale and perspective golden tests.

## Controls

```text
Filter
Edge Mode
Mix
Mask
Invert Transform
```

Advanced:

```text
Motion Blur
Shutter
Samples
BBox policy
```

## Output optional matrix

If adding an output:

```python
io.Custom("IMAGEOPS_MATRIX3").Output("matrix")
```

Only do this if a real downstream use exists. Do not create proprietary sockets just for theoretical neatness.

## Tests

- [ ] identity
- [ ] pure translation
- [ ] perspective trapezoid
- [ ] inverse
- [ ] corner order
- [ ] transparent edges
- [ ] RGBA alpha geometry
- [ ] batch matrices

---

# 20. NODE 06 — Comp → professional multilayer compositor

This is one of the flagship nodes.

## Architecture

Comp MUST become a thin orchestration layer over:

```text
Transform Engine
Mask Engine
Merge Engine
Batch Engine
Alpha Engine
Memory Budget
```

## Layer model

Conceptual internal object:

```python
from dataclasses import dataclass

@dataclass
class CompLayer:
    image: torch.Tensor
    mask: torch.Tensor | None
    enabled: bool = True
    opacity: float = 1.0
    blend_mode: str = "over"
    translate_x: float = 0.0
    translate_y: float = 0.0
    scale: float = 1.0
    rotation: float = 0.0
```

## Autogrow

Long-term V3 form:

```python
layer_template = io.Autogrow.TemplatePrefix(
    input=io.Image.Input("image"),
    prefix="image",
    min=2,
    max=64,
)

io.Autogrow.Input("layers", template=layer_template)
```

If current custom frontend carries per-layer controls not expressible through a simple Autogrow input, preserve the existing frontend until a tested migration exists.

## Lazy upstream evaluation

Disabled layers should ideally not execute upstream.

At minimum:

```text
enabled=false => no local transform/merge work
opacity=0     => no local transform/merge work
```

Where schema allows it, mark expensive layer inputs lazy.

## Composite loop

```python
result = base

for layer in active_layers:
    fg = transform_layer(layer.image, layer.transform)

    if layer.mask is not None:
        fg = apply_layer_mask(fg, layer.mask)

    result = merge(
        result,
        fg,
        mode=layer.blend_mode,
        mix=layer.opacity,
        alpha_policy=alpha_policy,
    )
```

## Optimization

- [ ] skip disabled layer
- [ ] skip opacity 0
- [ ] fast path opacity 1 + over
- [ ] process only required layers
- [ ] progress reporting
- [ ] avoid repeated format conversion

## Progress

```python
api = ComfyAPI()

await api.execution.set_progress(
    value=i + 1,
    max_value=len(active_layers),
)
```

If `execute` must become async, verify no caller/front-end assumptions break.

## Tests

- [ ] 2/4/16 layers
- [ ] disabled layer exact skip
- [ ] opacity 0 exact skip
- [ ] batch alignment contract
- [ ] blend golden parity
- [ ] transform parity with standalone Transform
- [ ] alpha compositing golden
- [ ] old workflow migration
- [ ] progress does not require invalid hidden ID access

---

# 21. NODE 07 — Constant → professional generator

## Modes

```text
Solid
Transparent
Checker
Grid
Color Bars     # optional
```

Use `DynamicCombo` because each generator mode needs different parameters.

## Example

```python
io.DynamicCombo.Input(
    "generator",
    options=[
        io.DynamicCombo.Option(
            "solid",
            [
                io.Float.Input("r", default=0.0, min=-16.0, max=16.0),
                io.Float.Input("g", default=0.0, min=-16.0, max=16.0),
                io.Float.Input("b", default=0.0, min=-16.0, max=16.0),
                io.Float.Input("a", default=1.0, min=0.0, max=1.0),
            ],
        ),
        io.DynamicCombo.Option(
            "checker",
            [
                io.Int.Input("cell_size", default=32, min=1, max=4096),
            ],
        ),
    ],
)
```

## Generation

Avoid per-pixel Python loops.

```python
color = torch.tensor([r, g, b, a], device=device, dtype=dtype)
image = color.view(1, 1, 1, 4).expand(batch, height, width, 4).clone()
```

Checker:

```python
yy, xx = torch.meshgrid(
    torch.arange(height, device=device),
    torch.arange(width, device=device),
    indexing="ij",
)
checker = ((xx // cell_size + yy // cell_size) % 2).float()
```

## Tests

- [ ] HDR values
- [ ] 1/3/4-channel public behavior as designed
- [ ] huge allocation blocked
- [ ] deterministic checker
- [ ] frame count memory budget

---

# 22. NODE 08 — Crop → Reformat / Crop engine

Do not necessarily rename the node ID immediately.

## Modes

Use `DynamicCombo`:

```text
Crop rectangle
Dimensions
Scale
Aspect Ratio
Fit
Fill
Megapixels
```

## Geometry helpers

Fit:

```python
scale = min(target_w / source_w, target_h / source_h)
```

Fill:

```python
scale = max(target_w / source_w, target_h / source_h)
```

Megapixels preserving aspect:

```python
target_pixels = megapixels * 1_000_000.0
scale = math.sqrt(target_pixels / (source_w * source_h))
out_w = round(source_w * scale)
out_h = round(source_h * scale)
```

## Filters

```text
nearest
bilinear
bicubic
lanczos
area
```

Use `area` primarily for significant downsampling where supported.

## Tests

- [ ] current no-op regression remains fixed
- [ ] 16:9→1:1
- [ ] fit
- [ ] fill
- [ ] center/anchor correctness
- [ ] odd resolutions
- [ ] alpha
- [ ] mask
- [ ] batch
- [ ] max dimensions / budget

---

# 23. NODE 09 — CropStitch → patch round-trip engine

This node is strategically important for AI patch workflows.

## Target flow

```text
Image
  ↓
Crop (+ metadata)
  ↓
AI processing
  ↓
CropStitch
  ↓
Original-format reconstructed image
```

## Metadata strategy

Do not replace public IMAGE compatibility.

Options:

1. Continue explicit coordinates/metadata outputs.
2. Add an optional ImageOps crop context custom socket in addition to normal outputs.
3. Never require proprietary metadata for basic operation.

Concept:

```python
@dataclass(frozen=True)
class CropContext:
    source_width: int
    source_height: int
    x: int
    y: int
    width: int
    height: int
    scale_x: float
    scale_y: float
```

## Edge integration

Add optional:

```text
Feather
Erode/Dilate
Edge color correction
```

Feather should blend:

```python
result = source * (1.0 - matte) + patch * matte
```

where matte is spatially aligned.

## Tests

- [ ] exact crop→stitch round trip
- [ ] resized patch
- [ ] batch hold-last policy only where intentional
- [ ] edge feather
- [ ] alpha patch
- [ ] patch out of bounds
- [ ] HDR

---

# 24. NODE 10 — Distort → displacement / STMap / warp

## Modes

```text
Displacement
STMap
UV
Twirl
Pinch
Wave
Lens (later)
```

Use `DynamicCombo`.

## Displacement

Define convention explicitly.

Example:

```text
map R or X:
    0.5 = no displacement
    0.0 = negative max
    1.0 = positive max
```

or signed:

```text
0 = no displacement
negative/positive = signed displacement
```

Pick one and document it. Do not mix.

## STMap

Professional convention:

```text
R = normalized source X
G = normalized source Y
```

Then:

```python
grid = stmap[..., :2] * 2.0 - 1.0
warped = torch.nn.functional.grid_sample(
    source_bchw,
    grid,
    mode=filter_mode,
    padding_mode=padding_mode,
    align_corners=False,
)
```

The `align_corners` convention must be fixed globally and tested.

## Grid caching

For procedural warps:

```text
cache key:
width
height
mode
parameters
device
dtype
```

Use bounded cache; never leak GPU memory indefinitely.

## Tests

- [ ] identity STMap
- [ ] horizontal shift
- [ ] vertical shift
- [ ] corner convention
- [ ] align_corners fixture
- [ ] displacement sign
- [ ] alpha
- [ ] HDR
- [ ] memory

---

# 25. NODE 11 — Draw → paint/roto-oriented drawing

Do not attempt to rebuild Photoshop.

## Tools

```text
Brush
Eraser
Line
Rectangle
Ellipse
```

Optional later:

```text
Clone
Bezier/Roto
```

## Stroke representation

Store vector-ish commands in frontend/workflow metadata:

```json
{
  "tool": "brush",
  "points": [[100, 120, 1.0], [103, 122, 0.9]],
  "size": 24,
  "hardness": 0.7,
  "opacity": 0.8
}
```

Backend rasterizes.

## Payload security

Validate:

```python
MAX_STROKES = 20_000
MAX_POINTS_PER_STROKE = 100_000
MAX_TOTAL_POINTS = 1_000_000
```

Reject malformed coordinates and non-finite values.

## Brush alpha

Concept:

```python
distance = torch.sqrt(dx * dx + dy * dy)
inner = radius * hardness
coverage = 1.0 - ((distance - inner) / max(radius - inner, eps))
coverage = coverage.clamp(0.0, 1.0)
```

## Tests

- [ ] payload limits
- [ ] malformed JSON
- [ ] deterministic raster
- [ ] opacity
- [ ] erase alpha
- [ ] high-DPI coordinate mapping
- [ ] frontend serialization round-trip

---

# 26. NODE 12 — FrameRange → true temporal slice

## Public strategy

Prefer native ComfyUI `VIDEO` support for public video workflows.

The official built-in video model currently exposes:

```text
VIDEO
  ↓ GetVideoComponents
IMAGE
AUDIO
FPS
bit_depth
```

and reconstruction:

```text
IMAGE + FPS + AUDIO + bit_depth
  ↓ CreateVideo
VIDEO
```

ImageOps should interoperate with this model rather than inventing a parallel public video ecosystem.

## Modes

```text
start frame
end frame
before: black / hold / loop / bounce
after:  black / hold / loop / bounce
```

## Frame slice

Inclusive/exclusive convention MUST be explicit. Recommended Python-like:

```text
[start, end)
```

## Audio trim

Frames map to seconds:

```python
start_seconds = start_frame / fps
end_seconds = end_frame / fps
```

Audio sample range:

```python
start_sample = round(start_seconds * sample_rate)
end_sample = round(end_seconds * sample_rate)
```

Do not clone full audio unchanged after trimming frames.

## Tests

Fixtures:

```text
12 fps
24 fps
25 fps
30 fps
60 fps
```

- [ ] exact duration
- [ ] audio trimmed to frame duration
- [ ] no A/V drift above tolerance
- [ ] empty range error
- [ ] negative range policy
- [ ] hold/loop/bounce deterministic

---

# 27. NODE 13 — Grain → film-grain-style operator

## Fix current architecture first

- GPU RNG on the source device
- no CPU random generation per frame
- no `amount` applied twice
- shared batch/frame count policy
- memory budget

## Correct amount structure

Wrong conceptual pattern:

```python
noise *= amount
blended = overlay(rgb, noise)
out = lerp(rgb, blended, amount)
```

Amount is effectively used twice.

Choose one of:

```python
grain = noise * amount
out = rgb + grain
```

or:

```python
grain_pattern = build_grain(...)
out = lerp(rgb, grain_blend(rgb, grain_pattern), amount)
```

not both.

## Professional controls

```text
Amount
Size
Softness
Seed
Temporal evolution
Luma response
RGB independence
```

Optional presets:

```text
Fine
Medium
Coarse
16mm-like
35mm-like
```

Label these as stylistic, not scientifically exact stock simulations.

## Temporal grain

Seed should be deterministic per sequence.

Example:

```python
frame_seed = base_seed + frame_index * 1_000_003
```

Better: use a generator sequence without CPU transfer.

## Luma response

```python
luma = compute_luma(rgb)
response = curve(luma)
grain = grain * response
```

## Tests

- [ ] amount=0 exact input
- [ ] linear response near small amount
- [ ] deterministic seed
- [ ] per-frame temporal change
- [ ] no CPU RNG hot path
- [ ] memory budget
- [ ] HDR remains unclamped

---

# 28. NODE 14 — Transform → flagship 2D transform

## Primary controls

```text
Translate X
Translate Y
Rotate
Scale
Filter
Mix
Mask
```

## Advanced

```text
Scale X
Scale Y
Pivot X
Pivot Y
Skew X
Skew Y
Flip
Edge Mode
Canvas/BBox mode
Motion Blur
Shutter
Samples
```

## Matrix order

Document one order and never change silently.

Recommended:

```text
T(position)
× T(pivot)
× R
× Skew
× S
× T(-pivot)
```

## Expand mode

Implement actual expanded canvas.

Transform the four source corners:

```python
corners = torch.tensor([
    [0, 0, 1],
    [W, 0, 1],
    [W, H, 1],
    [0, H, 1],
])
warped = (M @ corners.T).T
```

Compute:

```python
min_x = floor(warped[:, 0].min())
max_x = ceil(warped[:, 0].max())
```

Then add translation so expanded output starts at `(0,0)`.

## Motion blur

Share implementation with CameraShake / CornerPin.

## Tests

- [ ] identity bit-close
- [ ] 90° rotation
- [ ] pivot rotation
- [ ] non-uniform scale
- [ ] expanded bbox
- [ ] transparent edge
- [ ] HDR
- [ ] alpha
- [ ] batch animated transform
- [ ] mask/mix

---

# 29. NODE 15 — Invert

Keep this node simple.

## Channels

```text
RGB
RGBA
R
G
B
A
Mask
```

## Pivot

Default:

```text
1.0
```

Formula:

```python
out = pivot - source
```

For conventional normalized invert with pivot 1:

```python
1.0 - source
```

Do not clamp.

## Tests

- [ ] HDR
- [ ] negative values
- [ ] alpha-only
- [ ] RGB-only
- [ ] mask/mix if supported

---

# 30. NODE 16 — Append → shot concatenation foundation

This node should become the base of the future Sequencer.

## Inputs

Use `Autogrow` if compatible:

```text
Shot 1
Shot 2
Shot 3
...
```

Public type preference:

```text
VIDEO where native timing/audio must be retained
IMAGE batch where only frames are available
```

## Per-shot controls

Eventually:

```text
Trim In
Trim Out
Speed
Reverse
```

If Autogrow cannot attach per-element widget groups cleanly in the current API, keep a simple Append node and build the richer Sequencer separately.

## Global policies

```text
Resolution:
strict
fit first
fill first
explicit

FPS:
strict
first
explicit

Audio:
concat
drop
first-only   # discouraged but explicit if retained
```

## Retime

Simple retime by frame remapping:

```python
source_pos = output_frame_index * speed
```

Nearest:

```python
idx = round(source_pos)
```

Linear frame blend:

```python
i0 = floor(source_pos)
i1 = min(i0 + 1, last)
t = source_pos - i0
frame = lerp(frames[i0], frames[i1], t)
```

Do not call frame blending optical flow.

## Audio

Speed changes require audio policy.

Initial professional-safe policy:

```text
speed != 1:
    either explicit "drop audio"
    or perform time stretch using a proven audio implementation
```

Do not silently desynchronize.

## Tests

- [ ] 2/8/32 shots
- [ ] FPS mismatch strict error
- [ ] explicit conform
- [ ] audio concat
- [ ] resolution mismatch
- [ ] trim
- [ ] reverse
- [ ] no A/V drift

---

# 31. NODE 17 — Keyer → production matte operator

## Primary

```text
Screen Color
Tolerance
Softness
Despill
Mix
```

## Matte controls

```text
Clip Black
Clip White
Gamma
Erode
Dilate
Blur
Invert
```

## Outputs

```text
RGBA result
Matte
Despill result (optional)
```

## Color distance

Do not key directly in display RGB if a better perceptual or chroma distance is available.

Start with documented chroma-distance model.

Concept:

```python
diff = rgb - screen_color
distance = torch.linalg.vector_norm(diff, dim=-1, keepdim=True)
```

Then:

```python
matte = smoothstep(tolerance, tolerance + softness, distance)
```

Implement numerically stable smoothstep:

```python
def smoothstep(edge0, edge1, x):
    t = ((x - edge0) / max(edge1 - edge0, 1e-6)).clamp(0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)
```

## Despill

Do not merely subtract green everywhere. Modulate by inverse matte / spill amount and preserve luminance as much as practical.

## Tests

- [ ] pure screen
- [ ] foreground
- [ ] semitransparent edge
- [ ] despill
- [ ] matte morphology
- [ ] HDR foreground
- [ ] alpha output

---

# 32. NODE 18 — Clamp

## Modes

```text
Hard
Soft Knee
```

Hard:

```python
out = source.clamp(minimum, maximum)
```

Soft knee must be clearly defined mathematically before implementation.

Example shoulder concept:

```python
def soft_clip_high(x, high, knee):
    if knee <= 0:
        return torch.minimum(x, torch.as_tensor(high, device=x.device, dtype=x.dtype))
    start = high - knee
    # Define continuous piecewise curve and test derivative continuity.
```

Do not implement an arbitrary "soft" curve without documented fixtures.

## Channels

```text
RGB
RGBA
R
G
B
A
```

## Tests

- [ ] negative allowed before clamp
- [ ] >1 allowed before clamp
- [ ] channel selection
- [ ] hard exact values
- [ ] soft continuity if implemented

---

# 33. NODE 19 — Merge → production 2-input merge

This is another flagship.

## Input convention

Make it explicit forever:

```text
A = background
B = foreground
```

## Primary controls

```text
Operation
Mix
Mask
Foreground Fit
```

## Advanced

```text
Alpha policy
Premult policy
BBox policy
Working mode
Batch policy
```

## Over formula

For straight RGB inputs:

```python
out_a = b_a + a_a * (1.0 - b_a)

numerator = (
    b_rgb * b_a
    + a_rgb * a_a * (1.0 - b_a)
)

out_rgb = numerator / out_a.clamp_min(eps)
```

For premultiplied RGB:

```python
out_rgb_premult = b_rgb_premult + a_rgb_premult * (1.0 - b_a)
out_a = b_a + a_a * (1.0 - b_a)
```

Be extremely explicit about which internal representation is used.

## Plus

```python
rgb = A_rgb + B_rgb
```

No clamp.

## Multiply

```python
rgb = A_rgb * B_rgb
```

## Screen

```python
rgb = 1.0 - (1.0 - A_rgb) * (1.0 - B_rgb)
```

Note: some artistic blend modes assume normalized display-referred values and may behave unexpectedly in HDR/negative ranges. Document this rather than silently clamping.

## Lazy evaluation

If `mix == 0`, B should not be needed where API supports lazy execution.

## Golden parity

One JSON fixture should drive both Python and JS preview tests.

Example:

```json
{
  "mode": "multiply",
  "a": [0.2, 0.5, 2.0],
  "b": [0.8, 0.5, 0.25],
  "expected": [0.16, 0.25, 0.5]
}
```

## Tests

- [ ] all modes finite
- [ ] Python/JS parity
- [ ] HDR cases
- [ ] alpha over golden
- [ ] mix 0 / 1
- [ ] mask 0 / 1
- [ ] batch strict/broadcast
- [ ] no hidden cycle

---

# 34. NODE 20 — MaskConvert → matte utility

## Modes

```text
Image Luma → Mask
R → Mask
G → Mask
B → Mask
A → Mask
Mask → RGB
Mask → RGBA
```

## Optional controls

```text
Invert
Normalize
Threshold
```

Normalize:

```python
lo = x.amin(dim=(-2, -1), keepdim=True)
hi = x.amax(dim=(-2, -1), keepdim=True)
mask = (x - lo) / (hi - lo).clamp_min(1e-6)
```

Threshold:

```python
mask = (mask >= threshold).to(mask.dtype)
```

## Tests

- [ ] constant image normalization
- [ ] alpha absent
- [ ] luma coefficients
- [ ] threshold
- [ ] invert
- [ ] batch

---

# 35. NODE 21 — Noise → procedural noise engine

## Types

Phase 1:

```text
White
Value
Perlin-like / gradient
FBM
```

Phase 2:

```text
Simplex
Voronoi
Cellular
Blue-noise tile
```

Do not import a large dependency just for noise.

## Controls

```text
Scale
Seed
Octaves
Gain
Lacunarity
Offset X/Y
Time
```

## FBM

```python
value = 0
amplitude = 1
frequency = 1

for octave in range(octaves):
    value += amplitude * noise(p * frequency)
    frequency *= lacunarity
    amplitude *= gain
```

Prefer vectorized implementation and cap octaves.

## Continuous animation

Noise over time should vary continuously:

```text
noise(x, y, t)
```

not merely a totally unrelated image each frame unless mode says "random per frame".

## Tests

- [ ] deterministic seed
- [ ] different seed
- [ ] temporal continuity metric
- [ ] octave cap
- [ ] memory
- [ ] no CPU loop per pixel

---

# 36. NODE 22 — PadOut → Canvas / Format Extend

## Modes

```text
Pixels:
left/right/top/bottom

Target dimensions:
width/height
anchor
```

Use DynamicCombo.

## Fill

```text
transparent
black
color
edge
mirror
wrap
```

## PyTorch example

Constant:

```python
# convert to BCHW first
out = torch.nn.functional.pad(
    source_bchw,
    (left, right, top, bottom),
    mode="constant",
    value=0.0,
)
```

Mirror:

```python
mode="reflect"
```

Wrap may require explicit indexing because `F.pad` mode support differs.

## Tests

- [ ] every anchor
- [ ] RGBA transparent
- [ ] HDR color
- [ ] mirror
- [ ] edge
- [ ] dimensions smaller than input policy
- [ ] memory

---

# 37. NODE 23 — Preview → display-only viewer

Preview MUST NOT change processing values.

## View modes

```text
RGB
RGBA
Alpha
R
G
B
Mask
```

## Display controls

```text
Exposure
Gamma
Checkerboard
Fit
100%
```

These controls affect the browser display only.

## Backend limit

Before PIL conversion:

```python
frames = images[:max_frames]
```

Never:

```python
pil_list = tensor_batch_to_pil_list(images)
frames = pil_list[:max_frames]
```

## Safety caps

Configurable:

```text
max_preview_frames = 16
max_preview_side = 2048
max_preview_pixels_total
max_animation_duration
```

## V3 output

Where possible:

```python
return io.NodeOutput(
    source,
    ui=ui.PreviewImage(display_tensor, cls=cls),
)
```

Custom live-preview route can remain for low-latency functionality not covered by the built-in helper.

## Server route

Register from extension lifecycle, idempotently.

Validate:

- resolved paths remain inside allowed Comfy folders
- media extension allowlist
- concurrency limit for transcoding
- timeout
- output size/cache cap
- no shell command interpolation

## Tests

- [ ] route exists after plugin load
- [ ] traversal rejected
- [ ] huge batch converts only selected frames
- [ ] preview does not mutate source
- [ ] HDR source preserved

---

# 38. NODE 24 — Ramp → professional gradient generator

## Modes

```text
Linear
Radial
Box
Four Corner
```

## Controls

```text
Color A
Color B
Position
Angle
Scale
Falloff
```

Output:

```text
IMAGE
MASK
```

## Linear ramp

Normalize coordinates:

```python
yy, xx = torch.meshgrid(
    torch.linspace(-1.0, 1.0, H, device=device),
    torch.linspace(-1.0, 1.0, W, device=device),
    indexing="ij",
)

direction = torch.tensor(
    [math.cos(angle), math.sin(angle)],
    device=device,
)

t = xx * direction[0] + yy * direction[1]
t = (t * scale + offset)
```

Only clamp the interpolation weight:

```python
w = t.clamp(0.0, 1.0)
```

Do not clamp HDR endpoint colors.

```python
rgb = color_a + (color_b - color_a) * w[..., None]
```

## Tests

- [ ] endpoints exact
- [ ] HDR colors
- [ ] radial center
- [ ] angle
- [ ] mask output
- [ ] memory

---

# 39. NODE 25 — Spherize → reusable warp family

## Modes

```text
Spherize
Bulge
Pinch
Fisheye
```

## Controls

```text
Center X/Y
Radius
Strength
Falloff
Filter
Edge
Mix
Mask
```

## Coordinate engine

Build normalized coordinates once.

```python
yy, xx = normalized_grid(H, W, device, dtype)

dx = xx - center_x
dy = yy - center_y
r = torch.sqrt(dx * dx + dy * dy)
```

Apply mapping only inside radius.

Example generic radial warp:

```python
u = (r / radius).clamp(0.0, 1.0)
factor = 1.0 + strength * (1.0 - u) ** falloff
src_x = center_x + dx / factor
src_y = center_y + dy / factor
```

The precise Spherize mapping should preserve existing visual behavior unless intentionally versioned.

## Cache

Cache base coordinate grid by:

```text
H, W, device, dtype
```

Bound cache size.

## Tests

- [ ] strength=0 identity
- [ ] center
- [ ] radius boundary continuity
- [ ] alpha
- [ ] HDR
- [ ] cached/non-cached identical
- [ ] memory

---

# 40. NODE 26 — Text → production title/text renderer

## Primary

```text
Text
Font
Size
Color
Position
Alignment
```

## Advanced

```text
Weight/style
Tracking
Leading
Box width/height
Wrap
Vertical align
Stroke
Stroke width
Shadow
Rotation
Scale
```

## Outputs

```text
RGBA image
Mask
```

## Rendering quality

If PIL remains renderer:

- cache fonts
- render at configurable supersample factor
- downsample with high-quality filter
- avoid reloading font file per frame
- normalize baseline/anchor handling

Example font cache:

```python
from functools import lru_cache
from PIL import ImageFont

@lru_cache(maxsize=128)
def load_font_cached(path: str, size: int):
    return ImageFont.truetype(path, size=size)
```

Supersampling:

```python
render_size = round(font_size * supersample)
font = load_font_cached(font_path, render_size)
```

Then downsample.

## Security

Font paths must resolve only through approved font discovery, not arbitrary uncontrolled filesystem traversal.

## Tests

- [ ] deterministic raster
- [ ] font cache
- [ ] Unicode
- [ ] wrapping
- [ ] alignment
- [ ] mask output
- [ ] empty text
- [ ] long text bounds
- [ ] batch text behavior

---

# 41. Shared professional engines to implement after node stabilization

## 41.1 Blend engine

One backend implementation, one frontend reference implementation, shared golden fixtures.

File:

```text
nodes/core/blend.py
tests/golden/blend_modes.json
src/preview/ops/blend.ts
```

## 41.2 Geometry engine

Use for:

```text
Transform
CornerPin
CameraShake
Comp layer transforms
Text transform
```

## 41.3 Warp engine

Use for:

```text
Distort
Spherize
possibly Lens later
```

## 41.4 Matte engine

Use for:

```text
MaskConvert
Keyer
CropStitch feather
Draw mask
Merge mask
all effect masks
```

## 41.5 Timeline engine

Use for:

```text
FrameRange
Append
future Sequencer
CameraShake timing
animated parameters
```

---

# 42. Timeline model

Create an internal, non-public contract.

```python
# nodes/core/timeline.py

from dataclasses import dataclass

@dataclass(frozen=True)
class TimelineInfo:
    fps: float
    frame_count: int

    @property
    def duration_seconds(self) -> float:
        return self.frame_count / self.fps

def frame_to_seconds(frame: int, fps: float) -> float:
    return frame / fps

def seconds_to_frame(time_s: float, fps: float) -> float:
    return time_s * fps
```

Do not use frame index as if it were time without FPS.

---

# 43. Native VIDEO strategy

Publicly prefer native ComfyUI `VIDEO`.

Current official flow:

```text
LoadVideo
  → VIDEO

GetVideoComponents(VIDEO)
  → IMAGE
  → AUDIO
  → FPS
  → bit_depth

CreateVideo(IMAGE, FPS, AUDIO?, bit_depth?)
  → VIDEO
```

For ImageOps:

```text
FrameRange:
VIDEO → VIDEO

Append:
VIDEO... → VIDEO

Image-only processors:
IMAGE → IMAGE
```

If an image node accepts both `IMAGE` and `VIDEO` through `MultiType`, define clearly whether it preserves timing/audio itself or only operates on extracted frames.

Never pretend to preserve video metadata when only a frame tensor survives.

---

# 44. FPS policies

Standard enum:

```text
strict
first
explicit
```

Behavior:

### strict

```python
if any(abs(fps - first_fps) > 1e-6 for fps in fps_values):
    raise ValueError("FPS mismatch")
```

### first

Conform all timing to first source FPS.

### explicit

Use user-selected FPS.

Do not silently choose first FPS without exposing the policy.

---

# 45. Resolution conform policies

Standard:

```text
strict
fit
fill
stretch
pad
```

Use same geometry engine as Reformat.

---

# 46. Audio policies

Standard:

```text
preserve
concat
drop
```

Potential future:

```text
mix
crossfade
time_stretch
```

Do not implement fake time stretch by naive sample truncation/repetition and call it professional.

---

# 47. Curve editor future-proofing

Do not build the full curve editor in this phase, but design numeric resolution APIs to accept per-frame values.

Future frontend payload:

```json
{
  "interpolation": "bezier",
  "keys": [
    {"frame": 0, "value": 0.0},
    {"frame": 24, "value": 1.0}
  ]
}
```

Frontend can sample this into a frame vector.

Backend receives resolved per-frame values through the same `resolve_frame_parameter()` contract.

---

# 48. Search aliases and metadata

Make `imageops_nodes.json` or another single manifest the source of truth for:

```text
node_id
display name
category
description
search aliases
preview support
experimental flag
```

Schema test should compare every node against the manifest.

Example:

```python
assert set(schema.search_aliases) == set(manifest[node_id]["search_aliases"])
```

---

# 49. Caching strategy

## Cache only reusable immutable resources

Examples:

```text
font objects
base coordinate grids
Gaussian kernels
procedural lookup tables
```

Avoid caching full user images by default.

## Bounded cache

```python
from functools import lru_cache

@lru_cache(maxsize=64)
def cached_kernel(...):
    ...
```

GPU tensor caches need custom eviction because `lru_cache` can retain VRAM.

Example conceptual cache:

```python
class DeviceTensorCache:
    def __init__(self, max_entries=32):
        self.max_entries = max_entries
        self._items = OrderedDict()

    def get_or_create(self, key, factory):
        ...
```

Clear caches during extension unload if the API later provides an unload lifecycle.

---

# 50. Progress reporting

Use on operations with visible duration:

```text
Comp many layers
large video FrameRange/Append
large Draw raster
heavy multi-frame Transform
heavy Distort
```

Avoid progress calls on millisecond operators.

Current V3 pattern:

```python
api = ComfyAPI()

await api.execution.set_progress(
    value=current,
    max_value=total,
    preview_image=optional_preview,
)
```

Only make execution async where required and tested.

---

# 51. Frontend architecture

Target:

```text
src/preview/
├── core/
│   ├── graph.ts
│   ├── media.ts
│   ├── renderer.ts
│   ├── scheduler.ts
│   └── video.ts
├── ops/
│   ├── blend.ts
│   ├── color.ts
│   ├── geometry.ts
│   ├── masks.ts
│   ├── procedural.ts
│   ├── video.ts
│   └── ...
└── node-adapters/
```

Continue decomposing `implementation.ts`.

Rule:

```text
No single implementation file should remain the real owner of most node logic.
```

Frontend preview should approximate backend semantics and be covered by parity fixtures where practical.

---

# 52. Preview parity levels

Define three levels.

## Level A — exact parity required

```text
Merge blend math
Invert
Clamp
basic ColorCorrect
Ramp
simple Transform coordinates
```

## Level B — perceptual parity

```text
Blur
Grain
Spherize
Distort
```

## Level C — backend-only accepted

```text
heavy/high-quality modes
video/audio operations
complex Keyer refinements
```

The UI must indicate when preview is approximate.

---

# 53. Test architecture

```text
tests/
├── unit/
│   ├── core/
│   │   ├── test_alpha.py
│   │   ├── test_batch.py
│   │   ├── test_bbox.py
│   │   ├── test_masks.py
│   │   ├── test_parameters.py
│   │   ├── test_transform.py
│   │   ├── test_blend.py
│   │   └── test_timeline.py
│   └── nodes/
│       ├── test_blur.py
│       ├── test_merge.py
│       └── ...
├── integration/
│   ├── test_registry.py
│   ├── test_routes.py
│   ├── test_v3_schema.py
│   ├── test_workflow_compat.py
│   ├── test_video_roundtrip.py
│   └── test_node_replacements.py
├── golden/
│   ├── blend_modes.json
│   ├── transform_cases.json
│   ├── alpha_over.json
│   └── keyer_cases.json
└── fixtures/
    ├── images/
    ├── masks/
    └── video/
```

---

# 54. Numeric test tolerances

Do not use one tolerance for everything.

Suggested:

```text
pure arithmetic:
atol=1e-6 / rtol=1e-6

grid sampling / bicubic:
atol=1e-4 or justified tolerance

frontend float implementation:
epsilon <= 1e-4 where exact math expected

image encoding/preview:
perceptual/format-specific checks
```

Document any relaxed tolerance.

---

# 55. Performance benchmark suite

Create a lightweight benchmark command separate from CI.

Reference sizes:

```text
512×512 × 1
1920×1080 × 1
1920×1080 × 24
3840×2160 × 1
3840×2160 × 16
```

Measure:

```text
runtime
peak allocated GPU memory
CPU peak where relevant
device transfers
```

Benchmark:

```text
Blur
Transform
Merge
Comp 8 layers
Grain
Distort
Spherize
Preview
```

Do not make CI fail on absolute speed because runners vary. Use benchmarks to detect severe regressions locally/nightly.

---

# 56. Workflow compatibility strategy

Before changing a schema:

1. Save representative old workflows.
2. Snapshot current widget positions/input IDs.
3. Design new schema.
4. Register `NodeReplace` when required.
5. Load old workflows in integration test.
6. Verify links and widget values migrate.
7. Only then remove old compatibility code.

Official Node Replacement supports:

```text
old node ID
old widget IDs
input mappings
output mappings
Autogrow dotted paths
```

Use it.

---

# 57. Package-level extension lifecycle

Recommended shape:

```python
# __init__.py

from comfy_api.latest import ComfyExtension
from .nodes import NODES
from .node_replacements import register_node_replacements
from .server import register_imageops_routes
from .nodes.core.cache import initialize_caches

class MajoorImageOpsExtension(ComfyExtension):
    async def on_load(self) -> None:
        await register_node_replacements()
        register_imageops_routes()
        initialize_caches()

    async def get_node_list(self):
        return NODES

async def comfy_entrypoint():
    return MajoorImageOpsExtension()
```

`server.py`:

```python
_REGISTERED = False

def register_imageops_routes():
    global _REGISTERED
    if _REGISTERED:
        return

    # Register routes here.
    # Confirm exact PromptServer/API mechanism against current ComfyUI.
    _REGISTERED = True
```

Do not register duplicate aiohttp routes.

---

# 58. Minimum supported ComfyUI version

After integration tests confirm the actual minimum:

```toml
[tool.comfy]
requires-comfyui = ">=<verified-version>"
```

Do not guess the version.

CI matrix should include:

```text
latest supported ComfyUI
minimum supported ComfyUI
```

If `comfy_api.latest` remains intentionally used, test latest on every PR.

---

# 59. Suggested implementation phases

Do not implement all professional features at once.

## PHASE A — Core semantic foundation

- alpha
- mask/mix
- batch
- per-frame parameters
- format/bbox
- sampling
- transform engine
- blend engine
- HDR contract

Nodes changed only enough to consume shared semantics.

## PHASE B — Flagship nodes

1. Merge
2. Transform
3. ColorCorrect
4. Crop/Reformat
5. Comp

## PHASE C — Geometry / matte / procedural

6. Blur
7. CornerPin
8. Distort
9. Spherize
10. Keyer
11. Grain
12. Noise
13. Ramp

## PHASE D — Utility nodes

14. Channel
15. Constant
16. CropStitch
17. Invert
18. Clamp
19. MaskConvert
20. PadOut
21. Text
22. Draw
23. Preview

## PHASE E — Temporal/video

24. CameraShake
25. FrameRange
26. Append

Then build Sequencer from the shared timeline/video foundation.

---

# 60. Suggested PR sequence

## PR-01 — `core/pro-compositing-contracts`

Deliver:

- `alpha.py`
- `masks.py`
- `parameters.py`
- batch cleanup
- HDR rules
- tests

## PR-02 — `core/geometry-engine`

Deliver:

- sampling
- transform matrix
- bbox
- grid helpers
- tests

## PR-03 — `core/blend-engine`

Deliver:

- blend modes
- alpha over
- Python/JS goldens

## PR-04 — `nodes/merge-pro`

Deliver professional Merge.

## PR-05 — `nodes/transform-pro`

Deliver professional Transform.

## PR-06 — `nodes/grade-reformat-pro`

ColorCorrect + Crop/Reformat.

## PR-07 — `nodes/comp-pro`

Comp consumes engines.

## PR-08 — `nodes/warp-pro`

CornerPin + Distort + Spherize + Blur.

## PR-09 — `nodes/matte-procedural`

Keyer + Grain + Noise + Ramp + MaskConvert.

## PR-10 — `nodes/utilities-pro`

Channel + Constant + CropStitch + Invert + Clamp + PadOut + Text + Draw.

## PR-11 — `preview/pro-display`

Preview limits, display semantics, frontend decomposition.

## PR-12 — `video/native-timeline`

CameraShake + FrameRange + Append native video semantics.

## PR-13 — `migration/compatibility`

Node replacements, workflow fixtures, aliases.

## PR-14 — `release/pro-compositing`

Docs, examples, version, full integration suite.

---

# 61. Per-node professional readiness matrix

| Node | Shared engine | Major professional upgrade | Risk |
|---|---|---|---|
| Color Correct | color/alpha/mask | HDR grade + premult | Medium |
| Blur | sampling/roi/mask | channels + edge + bbox | Medium |
| CameraShake | transform/timeline | deterministic temporal transform | High |
| Channel | channels | Shuffle routing | Low |
| CornerPin | transform/warp | From/To homography | High |
| Comp | merge/transform/timeline | layers + lazy + Autogrow | Very High |
| Constant | procedural/memory | generators + HDR | Low |
| Crop | format/sampling/bbox | Reformat modes | Medium |
| CropStitch | bbox/masks | patch metadata + feather | Medium |
| Distort | warp/sampling | STMap + displacement | High |
| Draw | masks/raster | vector stroke pipeline | High |
| FrameRange | timeline/video | A/V-correct slicing | High |
| Grain | procedural/timeline | GPU film grain | Medium |
| Transform | geometry/sampling | matrix + expand + motion blur | High |
| Invert | channels/masks | channel-aware HDR invert | Low |
| Append | timeline/video | shot concat/trim/retime | Very High |
| Keyer | matte/color | key + despill + matte tools | High |
| Clamp | channels | hard/soft controlled clamp | Low |
| Merge | blend/alpha | correct compositing | Very High |
| MaskConvert | matte/channels | conversion toolkit | Low |
| Noise | procedural | coherent noise | Medium |
| PadOut | format/sampling | canvas extend | Low |
| Preview | display/server | HDR-safe display | High |
| Ramp | procedural | multi-ramp generator | Low |
| Spherize | warp/cache | warp family | Medium |
| Text | raster/cache | typographic renderer | Medium |

---

# 62. Definition of "professional" for this project

A node is NOT professional merely because it has many controls.

A node is professional when:

- [ ] its input/output domain is explicit
- [ ] its alpha semantics are explicit
- [ ] its mask/mix behavior matches every other ImageOps node
- [ ] its batch behavior is deterministic
- [ ] its temporal behavior is FPS-aware where relevant
- [ ] it does not destroy HDR values unintentionally
- [ ] it has predictable edge/sampling behavior
- [ ] it respects memory constraints
- [ ] it shares engines with related nodes
- [ ] it can be previewed without changing final data
- [ ] it has golden numerical tests for critical math
- [ ] it is backward compatible or migratable
- [ ] it uses V3 schema features appropriately
- [ ] it exposes simple primary controls and hides specialist controls under Advanced
- [ ] it is documented enough that a compositor can predict its result

---

# 63. Final Codex execution checklist

This is the master checklist. Do not declare the professional evolution complete until all applicable items are done.

## 63.1 Core architecture

- [ ] Create/normalize `nodes/core/alpha.py`
- [ ] Create/normalize `nodes/core/masks.py`
- [ ] Create/normalize `nodes/core/channels.py`
- [ ] Create/normalize `nodes/core/parameters.py`
- [ ] Consolidate `nodes/core/batch.py`
- [ ] Create/normalize `nodes/core/bbox.py`
- [ ] Create/normalize `nodes/core/format.py`
- [ ] Create/normalize `nodes/core/sampling.py`
- [ ] Create/normalize `nodes/core/transform.py`
- [ ] Create/normalize `nodes/core/warp.py`
- [ ] Create/normalize `nodes/core/blend.py`
- [ ] Create/normalize `nodes/core/timeline.py`
- [ ] Normalize `nodes/core/video.py`
- [ ] Extend `nodes/core/memory.py`
- [ ] Add bounded cache utilities
- [ ] Add finite-value validation utilities
- [ ] Remove duplicate legacy helpers after migration

## 63.2 Global image contract

- [ ] RGB supports negative values
- [ ] RGB supports >1 values
- [ ] Alpha canonical range `[0,1]`
- [ ] Mask canonical range `[0,1]`
- [ ] Preview clamping isolated from processing
- [ ] No accidental `.clamp(0,1)` on RGB
- [ ] NaN/Inf policy explicit

## 63.3 Alpha

- [ ] `split_rgba`
- [ ] `premultiply`
- [ ] `unpremultiply`
- [ ] `replace_alpha`
- [ ] shared alpha tests
- [ ] ColorCorrect consumes shared alpha
- [ ] Merge consumes shared alpha
- [ ] Keyer consumes shared alpha
- [ ] CropStitch consumes shared alpha
- [ ] Transform preserves alpha

## 63.4 Mask / mix

- [ ] one `apply_mask_mix` implementation
- [ ] mask 0 = source
- [ ] mask 1 = processed
- [ ] mix 0 = source
- [ ] mix 1 = normal effect
- [ ] invert mask consistent
- [ ] mask batch alignment consistent
- [ ] mask resize interpolation consistent

## 63.5 Batch

- [ ] eliminate hidden cyclic `_expand_image_batch`
- [ ] strict policy
- [ ] singleton broadcast
- [ ] hold-last only where intentional
- [ ] loop only where intentional
- [ ] batch tests for 1→N
- [ ] batch tests for M→N mismatch
- [ ] frame parameter resolver uses same semantics

## 63.6 Per-frame controls

- [ ] central `resolve_frame_parameter`
- [ ] scalar support
- [ ] tensor/list support
- [ ] hold behavior
- [ ] optional loop behavior
- [ ] mixed bypass implementation
- [ ] remove node-local parameter repetition code

## 63.7 Format / bbox / ROI

- [ ] format model
- [ ] bbox model
- [ ] bbox union/intersection/expand
- [ ] Transform bbox
- [ ] Blur bbox expansion
- [ ] Crop bbox
- [ ] Merge bbox union
- [ ] Comp active layer bbox logic
- [ ] ROI remains internal and does not break Comfy IMAGE interop

## 63.8 Geometry / sampling

- [ ] common normalized-grid convention
- [ ] fixed `align_corners` convention
- [ ] common filter names
- [ ] common edge names
- [ ] common transform matrices
- [ ] identity goldens
- [ ] pixel-center goldens
- [ ] odd-size resolution tests
- [ ] RGBA warp tests

## 63.9 V3 schemas

- [ ] all controlled strings use `io.Combo.Input`
- [ ] `DynamicCombo` used where controls depend on mode
- [ ] specialist controls marked `advanced=True`
- [ ] `Autogrow` evaluated for Append
- [ ] `Autogrow` evaluated for Comp
- [ ] `MultiType` retained only where type semantics are sound
- [ ] all execute methods return `io.NodeOutput`
- [ ] descriptions/tooltips current
- [ ] search aliases complete
- [ ] hidden values use current V3 contract
- [ ] schema snapshot test covers all 26 nodes

## 63.10 V3 lifecycle

- [ ] extension `on_load`
- [ ] idempotent route registration
- [ ] node replacements registered in `on_load`
- [ ] shared cache initialization
- [ ] no accidental import-order route dependency

## 63.11 Lazy execution

- [ ] Merge B can be skipped when mathematically unnecessary
- [ ] disabled Comp layers skip local work
- [ ] evaluate lazy Comp inputs if API permits cleanly
- [ ] optional Distort map skipped when mode does not use it
- [ ] tests prove skipped upstream evaluation where implemented

## 63.12 Cache / fingerprint

- [ ] no constant-True fingerprint misuse
- [ ] deterministic procedural nodes reviewed
- [ ] base geometry grids cached where profitable
- [ ] kernels cached where profitable
- [ ] font loading cached
- [ ] GPU caches bounded
- [ ] cache tests

## 63.13 Memory

- [ ] ColorCorrect budget/chunking if needed
- [ ] Blur budget
- [ ] CameraShake budget
- [ ] CornerPin budget
- [ ] Comp budget
- [ ] Constant budget
- [ ] Crop budget
- [ ] CropStitch budget
- [ ] Distort budget
- [ ] Draw payload/memory cap
- [ ] FrameRange budget
- [ ] Grain budget
- [ ] Transform budget
- [ ] Append budget
- [ ] Merge budget
- [ ] Noise budget
- [ ] PadOut budget
- [ ] Preview CPU/display budget
- [ ] Ramp budget
- [ ] Spherize budget
- [ ] Text render budget

## 63.14 Color Correct

- [ ] exposure
- [ ] contrast + pivot
- [ ] gamma
- [ ] lift
- [ ] gain
- [ ] offset
- [ ] saturation
- [ ] vibrance
- [ ] temperature/tint
- [ ] premult policy
- [ ] HDR tests
- [ ] mask/mix

## 63.15 Blur

- [ ] X/Y radius
- [ ] lock XY
- [ ] Gaussian
- [ ] Box
- [ ] Defocus
- [ ] edge modes
- [ ] channel selection
- [ ] HDR-safe
- [ ] bbox expansion
- [ ] mask/mix

## 63.16 CameraShake

- [ ] deterministic RNG
- [ ] smooth motion generation
- [ ] translation
- [ ] rotation
- [ ] scale
- [ ] seed
- [ ] frequency/smoothness
- [ ] motion blur optional
- [ ] transform engine reuse
- [ ] timing tests

## 63.17 Channel

- [ ] R/G/B/A routing
- [ ] luma source
- [ ] zero source
- [ ] one source
- [ ] mask source
- [ ] RGBA output
- [ ] tests

## 63.18 CornerPin

- [ ] FROM quad
- [ ] TO quad
- [ ] homography
- [ ] inverse
- [ ] filter
- [ ] edge
- [ ] alpha
- [ ] bbox
- [ ] motion blur optional
- [ ] golden tests

## 63.19 Comp

- [ ] shared Merge engine
- [ ] shared Transform engine
- [ ] layer enabled
- [ ] opacity
- [ ] per-layer mask
- [ ] per-layer transform
- [ ] blend mode
- [ ] skip disabled layers
- [ ] progress reporting
- [ ] batch policy
- [ ] memory budget
- [ ] Autogrow migration decision
- [ ] lazy evaluation decision
- [ ] old workflows tested

## 63.20 Constant

- [ ] Solid
- [ ] Transparent
- [ ] Checker
- [ ] Grid
- [ ] HDR colors
- [ ] DynamicCombo
- [ ] memory budget
- [ ] deterministic

## 63.21 Crop/Reformat

- [ ] crop rectangle
- [ ] dimensions
- [ ] scale
- [ ] aspect
- [ ] fit
- [ ] fill
- [ ] megapixels
- [ ] anchors
- [ ] filters
- [ ] DynamicCombo
- [ ] existing no-op regression remains fixed
- [ ] workflow migration

## 63.22 CropStitch

- [ ] crop context strategy
- [ ] resize-back
- [ ] coordinate alignment
- [ ] feather
- [ ] matte morphology optional
- [ ] alpha
- [ ] HDR
- [ ] batch policy
- [ ] round-trip goldens

## 63.23 Distort

- [ ] Displacement
- [ ] STMap
- [ ] UV convention
- [ ] Twirl
- [ ] Pinch
- [ ] Wave
- [ ] common warp engine
- [ ] filter
- [ ] edge
- [ ] mask/mix
- [ ] grid cache
- [ ] memory

## 63.24 Draw

- [ ] vector stroke payload
- [ ] brush
- [ ] eraser
- [ ] line
- [ ] rectangle
- [ ] ellipse
- [ ] hardness
- [ ] opacity
- [ ] payload validation
- [ ] coordinate mapping
- [ ] frontend/backend round-trip

## 63.25 FrameRange

- [ ] native VIDEO interoperability
- [ ] start/end semantics
- [ ] before policy
- [ ] after policy
- [ ] FPS-aware
- [ ] audio trim
- [ ] bit depth policy
- [ ] 12/24/25/30/60fps tests
- [ ] A/V duration tests

## 63.26 Grain

- [ ] GPU RNG
- [ ] remove amount² behavior
- [ ] size
- [ ] softness
- [ ] temporal evolution
- [ ] RGB independence
- [ ] luma response
- [ ] memory
- [ ] deterministic seed
- [ ] HDR

## 63.27 Transform

- [ ] shared matrix engine
- [ ] translate
- [ ] rotate
- [ ] uniform scale
- [ ] XY scale
- [ ] pivot
- [ ] skew
- [ ] flip
- [ ] filters
- [ ] edge
- [ ] real expand canvas
- [ ] mask/mix
- [ ] motion blur optional
- [ ] animated params
- [ ] goldens

## 63.28 Invert

- [ ] channel selection
- [ ] pivot
- [ ] HDR
- [ ] alpha
- [ ] no clamp

## 63.29 Append

- [ ] Autogrow decision
- [ ] native VIDEO
- [ ] trim in/out
- [ ] reverse
- [ ] speed
- [ ] resolution policy
- [ ] FPS policy
- [ ] audio policy
- [ ] A/V sync tests
- [ ] future Sequencer-compatible core

## 63.30 Keyer

- [ ] screen color
- [ ] tolerance
- [ ] softness
- [ ] matte generation
- [ ] clip black/white
- [ ] matte gamma
- [ ] erode/dilate
- [ ] blur
- [ ] despill
- [ ] RGBA output
- [ ] matte output
- [ ] golden edge cases

## 63.31 Clamp

- [ ] arbitrary min/max
- [ ] channel selection
- [ ] hard clamp
- [ ] soft-knee only with defined math
- [ ] HDR tests

## 63.32 Merge

- [ ] A/B convention documented
- [ ] alpha-over contract
- [ ] premult contract
- [ ] blend modes centralized
- [ ] mix
- [ ] mask
- [ ] fit
- [ ] batch policy
- [ ] lazy B
- [ ] Python/JS golden parity
- [ ] HDR tests

## 63.33 MaskConvert

- [ ] luma
- [ ] R
- [ ] G
- [ ] B
- [ ] A
- [ ] normalize
- [ ] threshold
- [ ] invert
- [ ] mask→RGB
- [ ] mask→RGBA

## 63.34 Noise

- [ ] white
- [ ] coherent noise
- [ ] FBM
- [ ] octaves
- [ ] gain
- [ ] lacunarity
- [ ] deterministic seed
- [ ] temporal continuity
- [ ] GPU/vectorized
- [ ] memory

## 63.35 PadOut

- [ ] side padding
- [ ] target dimensions
- [ ] anchors
- [ ] transparent
- [ ] color
- [ ] edge
- [ ] mirror
- [ ] wrap
- [ ] HDR
- [ ] alpha

## 63.36 Preview

- [ ] display only
- [ ] RGB
- [ ] RGBA
- [ ] alpha
- [ ] channels
- [ ] checker
- [ ] exposure/gamma display
- [ ] max frames before conversion
- [ ] max side/pixels
- [ ] route registration
- [ ] traversal protection
- [ ] transcode semaphore/timeouts
- [ ] source tensor unchanged

## 63.37 Ramp

- [ ] Linear
- [ ] Radial
- [ ] Box
- [ ] Four Corner
- [ ] colors
- [ ] angle
- [ ] position
- [ ] falloff
- [ ] image output
- [ ] mask output
- [ ] HDR endpoint colors
- [ ] memory

## 63.38 Spherize

- [ ] Spherize
- [ ] Bulge
- [ ] Pinch
- [ ] Fisheye
- [ ] center
- [ ] radius
- [ ] strength
- [ ] falloff
- [ ] filter
- [ ] edge
- [ ] mask/mix
- [ ] bounded grid cache
- [ ] HDR

## 63.39 Text

- [ ] font discovery
- [ ] font cache
- [ ] size
- [ ] tracking
- [ ] leading
- [ ] wrap
- [ ] align
- [ ] vertical align
- [ ] fill
- [ ] stroke
- [ ] shadow
- [ ] transform
- [ ] RGBA output
- [ ] mask output
- [ ] supersampling
- [ ] Unicode
- [ ] path security

## 63.40 VIDEO / timeline

- [ ] public native VIDEO where appropriate
- [ ] `ImageOpsMedia` no longer masquerades as `IMAGE`
- [ ] FPS contract
- [ ] frame→seconds helpers
- [ ] audio trim
- [ ] audio concat
- [ ] bit depth propagation policy
- [ ] no silent metadata loss claims
- [ ] future Sequencer consumes same timeline engine

## 63.41 Frontend

- [ ] continue decomposing `implementation.ts`
- [ ] node-specific adapters
- [ ] shared blend math
- [ ] shared geometry conventions
- [ ] preview parity fixtures
- [ ] approximate preview clearly marked
- [ ] no duplicate schema source of truth
- [ ] all mode changes reflected in preview

## 63.42 Compatibility

- [ ] old workflow fixture set
- [ ] NodeReplace for changed node IDs
- [ ] NodeReplace for changed widget layouts
- [ ] Autogrow mapping where needed
- [ ] output mapping tests
- [ ] no broken links after migration

## 63.43 Tests

- [ ] pure unit tests run without ComfyUI
- [ ] ComfyUI integration test job
- [ ] route integration test
- [ ] 26-node schema test
- [ ] Python blend goldens
- [ ] JS blend goldens
- [ ] transform goldens
- [ ] alpha over goldens
- [ ] video fixtures
- [ ] old workflow fixtures
- [ ] GPU tests optionally separated
- [ ] CPU fallback expectations documented

## 63.44 Release gate

Before calling this professional-compositing milestone complete:

- [ ] Python CI green
- [ ] TypeScript check green
- [ ] frontend tests green
- [ ] generated frontend clean
- [ ] ComfyUI integration green
- [ ] main branch protection enabled
- [ ] Quality Gate required
- [ ] no P0 issues
- [ ] no known silent data-corruption bug
- [ ] no known RGB-clamp regression
- [ ] no hidden cyclic batch policy
- [ ] all 26 nodes load
- [ ] all 26 node schemas valid
- [ ] live preview works
- [ ] `/imageops/viewmedia` works after normal plugin load
- [ ] representative image workflows pass
- [ ] representative video workflows pass
- [ ] old workflows either load directly or migrate through NodeReplace
- [ ] memory stress cases fail safely rather than OOM unpredictably
- [ ] documentation updated
- [ ] package minimum ComfyUI version verified and declared

---

# 64. Final expected architecture after completion

```text
                    ComfyUI V3
                        │
      ┌─────────────────┼─────────────────┐
      │                 │                 │
    IMAGE              MASK             VIDEO
      │                 │                 │
      └──────────────┬──┴────────────┬────┘
                     │               │
              Surface Contract   Timeline Contract
                     │               │
        ┌────────────┼────────────┐  │
        │            │            │  │
      Color       Geometry    Procedural
        │            │            │  │
      Grade       Transform      Noise
      Keyer       CornerPin      Grain
      Merge       Distort        Ramp
        │          Spherize       │
        └────────────┼────────────┘
                     │
              Shared VFX Core
                     │
        alpha / mask / batch / bbox
        channels / sampling / cache
        memory / animation / validation
                     │
              GPU tensor processing
                     │
                io.NodeOutput
                     │
           Live Preview / Comfy UI
```

The goal is not 26 larger nodes.

The goal is:

> **6–8 strong reusable compositing engines exposed through 26 focused professional tools.**

That is the architectural threshold where ImageOps stops looking like a collection of filters and starts behaving like a coherent compositing toolkit.

---

# 65. Codex final instruction

When implementing this roadmap:

1. **Do not add features before the stabilization roadmap is green.**
2. **Build the shared contracts first.**
3. **Migrate the five flagship nodes first: Merge, Transform, ColorCorrect, Crop/Reformat, Comp.**
4. **Use those nodes as architectural proof before migrating the remaining 21.**
5. **Do not duplicate engine code.**
6. **Do not sacrifice ComfyUI interoperability for internal elegance.**
7. **Do not sacrifice HDR or alpha correctness for preview convenience.**
8. **Do not sacrifice workflow compatibility for cleaner schemas without NodeReplace.**
9. **Every professional behavior must be testable and documented.**
10. **The future Sequencer must be built on the same timeline/video engine created for FrameRange and Append.**

**Completion target:** a stable, testable, V3-native, HDR-aware, alpha-correct, batch-deterministic, video-aware ImageOps compositing toolkit suitable for serious production workflows.
