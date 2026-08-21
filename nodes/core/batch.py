"""Batch policy helpers for ImageOps.

All nodes must use match_batch() instead of ad-hoc repeat/index clamping
for multi-input batch alignment.
"""
from __future__ import annotations

import torch


class BatchMismatchError(ValueError):
    """Raised when two non-singleton batches have incompatible frame counts."""

    def __init__(self, name_a: str, count_a: int, name_b: str, count_b: int):
        super().__init__(
            f"Batch size mismatch: {name_a} has {count_a} frames, "
            f"{name_b} has {count_b} frames. "
            f"Non-singleton batch mismatch is not allowed by default. "
            f"Connect matching frame counts or a single-frame input."
        )
        self.name_a = name_a
        self.count_a = count_a
        self.name_b = name_b
        self.count_b = count_b


def match_batch(
    a: torch.Tensor,
    b: torch.Tensor,
    *,
    name_a: str = "input_a",
    name_b: str = "input_b",
    policy: str = "strict",
) -> tuple[torch.Tensor, torch.Tensor]:
    """Align two tensors along the batch (dim 0) axis.

    Policies:
        strict              N == M or one is singleton; error otherwise.
        broadcast_singleton Same as strict (default behavior).
        hold_last           Repeat last frame of shorter input to match longer.
        loop                Cycle shorter input to match longer.

    Returns the (possibly expanded) pair. Singleton broadcast uses expand()
    for zero-copy when safe.
    """
    ba = a.shape[0]
    bb = b.shape[0]

    if ba == bb:
        return a, b

    # Singleton broadcast — zero-copy via expand
    if ba == 1:
        expand_shape = [bb] + [-1] * (a.dim() - 1)
        return a.expand(*expand_shape), b
    if bb == 1:
        expand_shape = [ba] + [-1] * (b.dim() - 1)
        return a, b.expand(*expand_shape)

    # Non-singleton mismatch
    policy = str(policy).strip().lower()

    if policy in ("strict", "broadcast_singleton"):
        raise BatchMismatchError(name_a, ba, name_b, bb)

    target = max(ba, bb)

    if policy == "hold_last":
        if ba < target:
            pad = a[-1:].expand(target - ba, *[-1] * (a.dim() - 1))
            a = torch.cat([a, pad], dim=0)
        if bb < target:
            pad = b[-1:].expand(target - bb, *[-1] * (b.dim() - 1))
            b = torch.cat([b, pad], dim=0)
        return a, b

    if policy == "loop":
        if ba < target:
            reps = (target + ba - 1) // ba
            a = a.repeat(reps, *([1] * (a.dim() - 1)))[:target]
        if bb < target:
            reps = (target + bb - 1) // bb
            b = b.repeat(reps, *([1] * (b.dim() - 1)))[:target]
        return a, b

    raise ValueError(f"Unknown batch policy: {policy!r}")


def match_mask_batch(
    mask: torch.Tensor,
    target_batch: int,
    *,
    name: str = "mask",
) -> torch.Tensor:
    """Align a [B,H,W] mask to a target batch size.

    Singleton broadcast uses expand() for zero-copy.
    Non-singleton mismatch raises BatchMismatchError.
    """
    if mask.shape[0] == target_batch:
        return mask
    if mask.shape[0] == 1:
        return mask.expand(target_batch, -1, -1)
    raise BatchMismatchError(name, mask.shape[0], "image", target_batch)
