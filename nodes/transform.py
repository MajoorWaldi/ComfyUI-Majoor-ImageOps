from __future__ import annotations

import math

import torch

from ._helpers import (
    MEDIA_INPUT_TYPE,
    EPSILON,
    _hex_to_rgb01,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _select_media_tensor,
    _unpremultiply_rgb_by_mask,
    _param_tensor,
    _scalar,
)
from ._progress import start_progress
from ._preview import build_node_preview_result


# ---------------------------------------------------------------------------
# GPU affine-transform helpers
# ---------------------------------------------------------------------------

def _filter_to_grid_sample_mode(filter_mode: str | list, index: int = 0) -> str:
    """Map an ImageOps filter name to a torch.nn.functional.grid_sample mode."""
    normalized = _scalar(filter_mode, str, index=index).strip().lower()
    return {"nearest": "nearest", "bilinear": "bilinear", "bicubic": "bicubic"}.get(normalized, "bilinear")


_TRANSFORM_FILL_MODES = ["transparent", "mirror", "stretch", "expand", "color"]


def _frame_param(value, index: int, typ: type = float):
    """Return one frame's scalar value when ComfyUI passes a per-frame list."""
    return _scalar(value, typ, index=index) if isinstance(value, (list, tuple)) else value


def _normalize_fill_mode(value, index: int = 0) -> str:
    normalized = _scalar(value, str, index=index).strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in ("border", "expand", "edge", "edge_extend", "replicate", "extend"):
        return "expand"
    if normalized in ("reflect", "reflection", "mirror"):
        return "mirror"
    if normalized in ("stretch", "fill", "cover"):
        return "stretch"
    if normalized in ("color", "colour", "constant", "solid"):
        return "color"
    return "transparent"


def _normalize_flip_mode(value, index: int = 0) -> str:
    normalized = _scalar(value, str, index=index).strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in ("horizontal", "x", "flip_x", "left_right"):
        return "horizontal"
    if normalized in ("vertical", "y", "flip_y", "top_bottom"):
        return "vertical"
    return "none"


def _flip_tensor_spatial(tensor: torch.Tensor, flip_mode):
    if isinstance(flip_mode, (list, tuple)):
        if tensor.shape[0] == 0:
            return tensor
        return torch.cat([
            _flip_tensor_spatial(tensor[index:index + 1], _normalize_flip_mode(flip_mode, index=index))
            for index in range(tensor.shape[0])
        ], dim=0)

    mode = _normalize_flip_mode(flip_mode)
    if mode == "none":
        return tensor

    if tensor.ndim < 3:
        return tensor

    dims = [2] if mode == "horizontal" else [1]
    return torch.flip(tensor, dims=dims).contiguous()


def _padding_mode_from_fill(fill_mode: str) -> str:
    if fill_mode == "expand":
        return "border"
    if fill_mode == "mirror":
        return "reflection"
    return "zeros"


def _make_fill_background(source: torch.Tensor, fill_mode, fill_color) -> torch.Tensor | None:
    normalized = _normalize_fill_mode(fill_mode)
    if normalized == "stretch":
        background = source.float().clamp(0.0, 1.0).clone()
        if background.shape[-1] >= 4:
            background[..., 3] = 1.0
        return background.to(device=source.device, dtype=source.dtype)
    if normalized != "color":
        return None

    batch, height, width, channels = source.shape
    background = torch.zeros((batch, height, width, channels), device=source.device, dtype=torch.float32)
    r, g, b = _hex_to_rgb01(_scalar(fill_color, str))
    if channels >= 1:
        background[..., 0] = r
    if channels >= 2:
        background[..., 1] = g
    if channels >= 3:
        background[..., 2] = b
    if channels >= 4:
        background[..., 3] = 1.0
    return background.to(device=source.device, dtype=source.dtype)


def _composite_fill(result: torch.Tensor, coverage_mask: torch.Tensor, background: torch.Tensor | None) -> torch.Tensor:
    if background is None:
        return result

    fg = result.float().clamp(0.0, 1.0)
    bg = background.float().clamp(0.0, 1.0)
    blend = coverage_mask.unsqueeze(-1).float().clamp(0.0, 1.0)

    if fg.shape[-1] >= 4:
        fg_alpha = torch.maximum(fg[..., 3:4].clamp(0.0, 1.0), blend)
        bg_alpha = bg[..., 3:4].clamp(0.0, 1.0) if bg.shape[-1] >= 4 else torch.ones_like(fg_alpha)
        out_alpha = fg_alpha + bg_alpha * (1.0 - fg_alpha)
        premul_rgb = fg[..., :3] * fg_alpha + bg[..., :3] * bg_alpha * (1.0 - fg_alpha)
        safe_alpha = torch.where(out_alpha > EPSILON, out_alpha, torch.ones_like(out_alpha))
        out_rgb = torch.where(out_alpha > EPSILON, premul_rgb / safe_alpha, torch.zeros_like(premul_rgb))
        return torch.cat([out_rgb.clamp(0.0, 1.0), out_alpha.clamp(0.0, 1.0)], dim=-1).to(device=result.device, dtype=result.dtype)

    return (fg * blend + bg * (1.0 - blend)).clamp(0.0, 1.0).to(device=result.device, dtype=result.dtype)


def _build_affine_theta_batch(
    B: int,
    translate_x,
    translate_y,
    rotate_deg,
    scale,
    H: int,
    W: int,
    device: torch.device,
) -> torch.Tensor:
    """Build a [B, 2, 3] batch of inverse affine matrices for affine_grid / grid_sample.

    The matrix encodes clockwise rotation, uniform scale, and pixel translation.
    It maps output normalized [-1, 1] coords to input normalized coords, which is
    what affine_grid expects.

    No intermediate canvas is created, so rotation, translation, and scale happen
    in one sampling pass; only the final fixed-size output boundary can clip.
    """
    tx = _param_tensor(translate_x, B, device=device, dtype=torch.float32).view(B)
    ty = _param_tensor(translate_y, B, device=device, dtype=torch.float32).view(B)
    angle = _param_tensor(rotate_deg, B, device=device, dtype=torch.float32).view(B) * (math.pi / 180.0)
    safe_scale = _param_tensor(scale, B, device=device, dtype=torch.float32).view(B).clamp_min(EPSILON)
    inv_scale = safe_scale.reciprocal()

    cos_a = torch.cos(angle)
    sin_a = torch.sin(angle)
    tx_n = 2.0 * tx / max(W, 1)   # pixel to normalized
    ty_n = 2.0 * ty / max(H, 1)

    theta = torch.empty((B, 2, 3), device=device, dtype=torch.float32)
    theta[:, 0, 0] = cos_a * inv_scale
    theta[:, 0, 1] = sin_a * inv_scale
    theta[:, 0, 2] = -(tx_n * cos_a + ty_n * sin_a) * inv_scale
    theta[:, 1, 0] = -sin_a * inv_scale
    theta[:, 1, 1] = cos_a * inv_scale
    theta[:, 1, 2] = (tx_n * sin_a - ty_n * cos_a) * inv_scale
    return theta


def _transform_batch_affine(
    source: torch.Tensor,
    filter_mode,
    translate_x,
    translate_y,
    rotate_deg,
    scale,
    padding_mode: str = "zeros",
) -> torch.Tensor:
    """Batched GPU affine transform for a [B, H, W, C] image tensor."""
    B, H, W, C = source.shape
    if isinstance(filter_mode, (list, tuple)):
        if B == 0:
            return source
        return torch.cat([
            _transform_batch_affine(
                source[i:i + 1],
                _scalar(filter_mode, str, index=i),
                _frame_param(translate_x, i),
                _frame_param(translate_y, i),
                _frame_param(rotate_deg, i),
                _frame_param(scale, i),
                padding_mode=padding_mode,
            )
            for i in range(B)
        ], dim=0)

    d, dt = source.device, source.dtype
    mode  = _filter_to_grid_sample_mode(filter_mode)
    theta = _build_affine_theta_batch(B, translate_x, translate_y, rotate_deg, scale, H, W, d)
    grid  = torch.nn.functional.affine_grid(theta, size=(B, C, H, W), align_corners=False)
    x     = source.float().permute(0, 3, 1, 2)                      # [B,C,H,W]
    out   = torch.nn.functional.grid_sample(x, grid, mode=mode, padding_mode=padding_mode, align_corners=False)
    return out.permute(0, 2, 3, 1).clamp(0.0, 1.0).to(device=d, dtype=dt)


def _transform_mask_affine(
    mask: torch.Tensor,
    filter_mode,
    translate_x,
    translate_y,
    rotate_deg,
    scale,
    device: torch.device,
    dtype: torch.dtype,
    padding_mode: str = "zeros",
) -> torch.Tensor:
    """Batched GPU affine transform for a [B, H, W] mask tensor."""
    B, H, W = mask.shape
    if isinstance(filter_mode, (list, tuple)):
        if B == 0:
            return mask.to(device=device, dtype=dtype)
        return torch.cat([
            _transform_mask_affine(
                mask[i:i + 1],
                _scalar(filter_mode, str, index=i),
                _frame_param(translate_x, i),
                _frame_param(translate_y, i),
                _frame_param(rotate_deg, i),
                _frame_param(scale, i),
                device,
                dtype,
                padding_mode=padding_mode,
            )
            for i in range(B)
        ], dim=0)

    mode  = _filter_to_grid_sample_mode(filter_mode)
    theta = _build_affine_theta_batch(B, translate_x, translate_y, rotate_deg, scale, H, W, device)
    grid  = torch.nn.functional.affine_grid(theta, size=(B, 1, H, W), align_corners=False)
    m     = mask.float().unsqueeze(1)                                # [B,1,H,W]
    out   = torch.nn.functional.grid_sample(m, grid, mode=mode, padding_mode=padding_mode, align_corners=False)
    return out.squeeze(1).clamp(0.0, 1.0).to(device=device, dtype=dtype)


# ---------------------------------------------------------------------------
# Masked-source transform (premultiply -> transform -> unpremultiply)
# ---------------------------------------------------------------------------

def _transform_masked_source(
    source: torch.Tensor,
    input_mask: torch.Tensor,
    filter_mode,
    translate_x,
    translate_y,
    rotate_deg,
    scale,
    progress=None,
    padding_mode: str = "zeros",
) -> tuple[torch.Tensor, torch.Tensor]:
    if source.shape[0] != input_mask.shape[0]:
        raise ValueError(
            f"ImageOpsTransform: source batch ({source.shape[0]}) and mask batch "
            f"({input_mask.shape[0]}) must match. Broadcasting would produce incorrect "
            "per-frame transforms."
        )

    # Premultiply RGB by mask before transforming to avoid colour bleeding at edges
    premult_rgb = source[..., :3].float().clamp(0.0, 1.0) * input_mask.unsqueeze(-1)

    # Pack RGB (+ alpha if present) into a single grid_sample call
    has_alpha = source.shape[-1] >= 4
    if has_alpha:
        combined = torch.cat([premult_rgb, source[..., 3:4].float().clamp(0.0, 1.0)], dim=-1)
    else:
        combined = premult_rgb

    total = source.shape[0] * (3 if has_alpha else 2)
    if progress is not None:
        progress.update_absolute(0, total=max(1, total))

    transformed   = _transform_batch_affine(combined, filter_mode, translate_x, translate_y, rotate_deg, scale, padding_mode=padding_mode)
    output_mask   = _transform_mask_affine(
        input_mask, filter_mode, translate_x, translate_y, rotate_deg, scale,
        source.device, source.dtype,
    )

    if progress is not None:
        progress.update_absolute(source.shape[0] * 2)

    rgb    = _unpremultiply_rgb_by_mask(transformed[..., :3], output_mask)
    result = torch.cat([rgb, transformed[..., 3:4]], dim=-1) if has_alpha else rgb

    if progress is not None:
        progress.update_absolute(total)

    if not result.shape[0]:
        raise ValueError("ImageOpsTransform received an empty image batch.")

    return result.clamp(0.0, 1.0), output_mask.clamp(0.0, 1.0)


# ---------------------------------------------------------------------------
# Node
# ---------------------------------------------------------------------------

class ImageOpsTransform:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "translate_x": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "translate_y": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "rotate_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 8.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "flip": (["none", "horizontal", "vertical"], {"default": "none"}),
                "filter": (["nearest", "bilinear", "bicubic"],),
                "expand": ("BOOLEAN", {"default": False}),
                "fill_mode": (_TRANSFORM_FILL_MODES, {"default": "transparent", "tooltip": "How to fill uncovered areas when scale, rotate, or translate leaves holes."}),
                "fill_color": ("COLOR", {"default": "#000000"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, translate_x=0, translate_y=0, rotate_deg=0.0, scale=1.0, flip="none", filter="bilinear", expand=False, fill_mode="transparent", fill_color="#000000", invert_mask=False, video=None, mask=None, unique_id=None):
        # expand is accepted for workflow compatibility; the GPU path uses one
        # fixed-size affine_grid/grid_sample pass instead of intermediate canvases.
        del expand
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        safe_fill_mode = _normalize_fill_mode(fill_mode)
        safe_flip_mode = _normalize_flip_mode(flip)
        sample_padding = _padding_mode_from_fill(safe_fill_mode)
        progress = start_progress(unique_id=unique_id)

        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_transform")

        def _is_noop_param(value, kind="float"):
            if isinstance(value, (list, tuple)):
                for idx in range(len(value)):
                    current = _scalar(value, bool if kind == "bool" else float, index=idx) if kind == "bool" else _scalar(value, index=idx)
                    if kind == "bool":
                        if bool(current):
                            return False
                    elif kind == "int":
                        if abs(int(round(float(current)))) > 0:
                            return False
                    else:
                        if abs(float(current)) > EPSILON:
                            return False
                return True
            current = _scalar(value, bool) if kind == "bool" else _scalar(value)
            if kind == "bool":
                return not bool(current)
            if kind == "int":
                return abs(int(round(float(current)))) == 0
            return abs(float(current)) <= EPSILON

        no_translate = _is_noop_param(translate_x, "int") and _is_noop_param(translate_y, "int")
        no_rotate    = _is_noop_param(rotate_deg, "float")
        unit_scale   = _is_noop_param(
            _scalar(scale) - 1.0 if not isinstance(scale, (list, tuple))
            else [(_scalar(scale, index=i) - 1.0) for i in range(len(scale))],
            "float",
        )
        no_flip = safe_flip_mode == "none" if not isinstance(flip, (list, tuple)) else all(
            _normalize_flip_mode(flip, index=i) == "none" for i in range(len(flip))
        )
        if no_translate and no_rotate and unit_scale and no_flip:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_transform")

        if not no_flip:
            source = _flip_tensor_spatial(source, flip)
            output_mask_source = _flip_tensor_spatial(output_mask_source, flip)
            if input_mask is not None:
                input_mask = _flip_tensor_spatial(input_mask, flip)

        if input_mask is not None:
            result, output_mask = _transform_masked_source(
                source, input_mask, filter,
                translate_x, translate_y, rotate_deg, scale,
                progress=progress,
                padding_mode=sample_padding,
            )
            result = _composite_fill(result, output_mask, _make_fill_background(source, safe_fill_mode, fill_color))
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")

        # No external mask: transform image and alpha-derived mask on the GPU.
        progress.update_absolute(0, total=2)
        result      = _transform_batch_affine(source, filter, translate_x, translate_y, rotate_deg, scale, padding_mode=sample_padding)
        output_mask = _transform_mask_affine(
            output_mask_source, filter, translate_x, translate_y, rotate_deg, scale,
            source.device, source.dtype,
            padding_mode="zeros",
        )
        result = _composite_fill(result, output_mask, _make_fill_background(source, safe_fill_mode, fill_color))
        if safe_fill_mode != "transparent":
            output_mask = result[..., 3].clamp(0.0, 1.0) if result.shape[-1] >= 4 else torch.ones_like(output_mask)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")
