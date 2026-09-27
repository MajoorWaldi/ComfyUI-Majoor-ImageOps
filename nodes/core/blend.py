"""Shared RGB blend-mode engine.

One backend implementation, validated against tests/golden/blend_modes.json,
which is also the fixture the frontend preview (js/preview/shared/blend-modes.js)
is tested against. Do not reimplement these formulas per node; import from here.

Inputs are treated as straight (non-premultiplied), display-range [0,1] RGB.
Alpha compositing (over/mask/mix) is a separate concern, handled by the caller
via nodes.core.masks / nodes.core.alpha; this module only computes the
per-channel blend result for a given mode.
"""
from __future__ import annotations

import torch

_EPSILON = 1e-6


def normalize_blend_mode(mode: str) -> str:
    normalized = str(mode or "over").strip().lower().replace("-", "_").replace(" ", "_")
    return "over" if normalized == "normal" else normalized


def soft_light_curve(x: torch.Tensor) -> torch.Tensor:
    return torch.where(
        x <= 0.25,
        ((16.0 * x - 12.0) * x + 4.0) * x,
        torch.sqrt(x),
    )


def blend_rgb(base_rgb: torch.Tensor, top_rgb: torch.Tensor, mode: str) -> torch.Tensor:
    """Core blend modes shared by every ImageOps compositing node."""
    normalized = normalize_blend_mode(mode)
    if normalized in ("over", "normal"):
        return top_rgb
    if normalized == "add":
        return base_rgb + top_rgb
    if normalized == "multiply":
        return base_rgb * top_rgb
    if normalized == "screen":
        return 1.0 - (1.0 - base_rgb) * (1.0 - top_rgb)
    if normalized == "overlay":
        return torch.where(
            base_rgb <= 0.5,
            2.0 * base_rgb * top_rgb,
            1.0 - 2.0 * (1.0 - base_rgb) * (1.0 - top_rgb),
        )
    if normalized == "soft_light":
        return torch.where(
            top_rgb <= 0.5,
            base_rgb - (1.0 - 2.0 * top_rgb) * base_rgb * (1.0 - base_rgb),
            base_rgb + (2.0 * top_rgb - 1.0) * (soft_light_curve(base_rgb) - base_rgb),
        )
    if normalized == "difference":
        return (base_rgb - top_rgb).abs()
    if normalized == "color_dodge":
        return torch.where(
            top_rgb >= 1.0 - _EPSILON,
            torch.ones_like(base_rgb),
            base_rgb / (1.0 - top_rgb).clamp(min=_EPSILON),
        )
    if normalized == "color_burn":
        return torch.where(
            top_rgb <= _EPSILON,
            torch.zeros_like(base_rgb),
            (1.0 - (1.0 - base_rgb) / top_rgb.clamp(min=_EPSILON)).clamp(0.0, 1.0),
        )
    if normalized == "exclusion":
        return base_rgb + top_rgb - 2.0 * base_rgb * top_rgb
    if normalized in ("lighten", "max"):
        return torch.maximum(base_rgb, top_rgb)
    if normalized in ("darken", "min"):
        return torch.minimum(base_rgb, top_rgb)
    return top_rgb


def blend_rgb_extended(base_rgb: torch.Tensor, top_rgb: torch.Tensor, mode: str) -> torch.Tensor:
    """blend_rgb plus the Merge-specific modes that are themselves composed
    from other modes (subtract, vivid_light, pin_light, hard_mix)."""
    normalized = normalize_blend_mode(mode)
    if normalized in ("over", "normal"):
        return top_rgb
    if normalized == "subtract":
        return base_rgb - top_rgb
    if normalized == "vivid_light":
        burn = blend_rgb_extended(base_rgb, top_rgb * 2.0, "color_burn")
        dodge = blend_rgb_extended(base_rgb, top_rgb * 2.0 - 1.0, "color_dodge")
        return torch.where(top_rgb <= 0.5, burn, dodge)
    if normalized == "pin_light":
        return torch.where(
            top_rgb <= 0.5,
            torch.minimum(base_rgb, top_rgb * 2.0),
            torch.maximum(base_rgb, top_rgb * 2.0 - 1.0),
        )
    if normalized == "hard_mix":
        vivid = blend_rgb_extended(base_rgb, top_rgb, "vivid_light")
        return torch.where(vivid < 0.5, torch.zeros_like(vivid), torch.ones_like(vivid))
    return blend_rgb(base_rgb, top_rgb, normalized)
