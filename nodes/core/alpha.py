"""Shared alpha contract for ImageOps.

RGB is treated as scene-referred: negative values and values > 1 are valid and
must survive these helpers untouched. Alpha is always clamped to [0, 1]. Nodes
that need premultiplied-alpha-safe processing (color grading, blur, warps)
should route through split_rgba/unpremultiply/premultiply instead of each
implementing their own division-by-alpha.
"""
from __future__ import annotations

import torch

_EPS = 1e-6


def split_rgba(image: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor | None]:
    """Split a [B,H,W,C] image into (rgb, alpha). alpha is None for C < 4."""
    if image.shape[-1] >= 4:
        return image[..., :3], image[..., 3:4]
    return image[..., :3], None


def premultiply(rgb: torch.Tensor, alpha: torch.Tensor | None) -> torch.Tensor:
    """Multiply straight RGB by alpha. No-op when alpha is None."""
    if alpha is None:
        return rgb
    return rgb * alpha


def unpremultiply(rgb: torch.Tensor, alpha: torch.Tensor | None, eps: float = _EPS) -> torch.Tensor:
    """Divide premultiplied RGB by alpha, back to straight RGB.

    Pixels with near-zero alpha would otherwise divide-by-zero into noise; those
    pixels are returned as zero instead of an arbitrary large value.
    """
    if alpha is None:
        return rgb
    safe = torch.where(alpha.abs() > eps, alpha, torch.ones_like(alpha))
    result = rgb / safe
    return torch.where(alpha.abs() > eps, result, torch.zeros_like(result))


def replace_alpha(image: torch.Tensor, alpha: torch.Tensor) -> torch.Tensor:
    """Return image with its alpha channel replaced (RGB unchanged, appended if absent)."""
    alpha = alpha.clamp(0.0, 1.0)
    return torch.cat((image[..., :3], alpha), dim=-1)
