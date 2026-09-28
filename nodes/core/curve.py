"""Apply a 1D curve (as a lookup table over [0, 1]) to image colors.

The LUT itself comes from ComfyUI's CurveInput, whose interpolation matches the
frontend curve editor. js/preview/shared/curve.js mirrors the sampling below.
"""
from __future__ import annotations

import torch

CURVE_LUT_SIZE = 1024


def is_identity_lut(lut: torch.Tensor, tolerance: float = 1e-6) -> bool:
    identity = torch.linspace(0.0, 1.0, lut.shape[0], dtype=lut.dtype)
    return bool((lut - identity).abs().max() <= tolerance)


def apply_curve_lut(image: torch.Tensor, lut: torch.Tensor) -> torch.Tensor:
    """Map the RGB channels of [B,H,W,C] through `lut`, leaving alpha untouched.

    Values inside [0, 1] are interpolated in the LUT. HDR values outside that
    range keep their overshoot on top of the curve end point, so the curve never
    clips scene-linear data.
    """
    rgb = image[..., :3]
    lut = lut.to(device=image.device, dtype=image.dtype)
    position = rgb.clamp(0.0, 1.0) * (lut.shape[0] - 1)
    low = position.floor().long().clamp(max=lut.shape[0] - 2)
    weight = position - low.to(image.dtype)
    mapped = lut[low] * (1.0 - weight) + lut[low + 1] * weight
    mapped = mapped + torch.where(rgb < 0.0, rgb, torch.zeros_like(rgb)) + torch.where(rgb > 1.0, rgb - 1.0, torch.zeros_like(rgb))
    return torch.cat([mapped, image[..., 3:]], dim=-1)
