"""Per-frame parameter resolution for animatable numeric controls.

Any node that accepts either a single scalar or a per-frame sequence for a
parameter (e.g. a widget fed a list) should resolve it through
resolve_frame_parameter instead of hand-rolling its own broadcast/hold/loop
logic. This is also the basis for future curve-editor support: a resolved
per-frame value vector, computed once, fed uniformly downstream.
"""
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
    """Resolve a scalar or sequence parameter to a [frame_count] tensor.

    policy controls how a shorter sequence is extended to frame_count:
        hold  repeat the last value
        loop  cycle from the start
    """
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

    raise ValueError(f"Cannot resolve parameter length={x.numel()} to {frame_count} with policy={policy!r}")
