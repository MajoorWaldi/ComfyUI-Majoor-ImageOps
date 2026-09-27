"""Shared mask/mix contract for ImageOps.

Every effect node with a mask and/or mix control must behave identically:
    mask = 0 -> original
    mask = 1 -> fully processed
    mix = 0  -> original
    mix = 1  -> mask-controlled processed result

Do not reimplement this blend formula per node; use apply_mask_mix.
"""
from __future__ import annotations

import torch

from .batch import match_mask_batch


def normalize_mask(
    mask: torch.Tensor | None,
    *,
    target_batch: int,
    invert: bool = False,
) -> torch.Tensor | None:
    """Clamp a [B,H,W] mask to [0,1] and align it to target_batch.

    Returns None unchanged so callers can treat "no mask" as "no-op" without a
    separate branch.
    """
    if mask is None:
        return None

    mask = mask.float().clamp(0.0, 1.0)
    mask = match_mask_batch(mask, target_batch, name="mask")

    if invert:
        mask = 1.0 - mask

    return mask


def apply_mask_mix(
    source: torch.Tensor,
    processed: torch.Tensor,
    mask: torch.Tensor | None,
    mix: float | torch.Tensor = 1.0,
) -> torch.Tensor:
    """Blend source -> processed, gated by mask (per-pixel) and mix (global)."""
    if mask is None:
        weight = mix
    else:
        if mask.ndim == 3:
            mask = mask.unsqueeze(-1)
        weight = mask * mix

    return source + (processed - source) * weight
