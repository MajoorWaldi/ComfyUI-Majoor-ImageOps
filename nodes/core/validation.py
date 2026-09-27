"""Finite-value sanitation for the HDR-safe image contract.

RGB is never blindly clamped here. Only NaN/Inf get a defined fallback value;
alpha and mask channels are separately clamped to their canonical [0, 1] range.
"""
from __future__ import annotations

import torch


def sanitize_finite(
    x: torch.Tensor,
    *,
    nan: float = 0.0,
    posinf: float | None = None,
    neginf: float | None = None,
) -> torch.Tensor:
    """Replace NaN/Inf with defined values. Leaves finite values (including
    negative and >1 RGB) untouched."""
    if torch.isfinite(x).all():
        return x
    return torch.nan_to_num(x, nan=nan, posinf=posinf, neginf=neginf)


def clamp_mask(mask: torch.Tensor) -> torch.Tensor:
    return sanitize_finite(mask).clamp(0.0, 1.0)


def clamp_alpha(alpha: torch.Tensor) -> torch.Tensor:
    return sanitize_finite(alpha).clamp(0.0, 1.0)
