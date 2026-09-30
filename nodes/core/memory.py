"""Memory budget helpers for ImageOps.

All generators and high-cost operations must call check_budget() before
allocating large tensors to fail with a clear error instead of OOM.
"""
from __future__ import annotations

import os
import torch


def _get_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return int(default)


# "cpu" keeps all processing on the input tensor's device (ComfyUI images live on the CPU).
COMPUTE_DEVICE = os.getenv("IMAGEOPS_COMPUTE_DEVICE", "auto").strip().lower()

# Maximum single allocation in MB. Override with IMAGEOPS_MAX_ALLOC_MB env var.
MAX_ALLOC_MB = _get_int_env("IMAGEOPS_MAX_ALLOC_MB", 8192)


class MemoryBudgetError(MemoryError):
    """Raised when a planned allocation exceeds the budget."""

    def __init__(self, estimated_mb: float, budget_mb: float, label: str):
        super().__init__(
            f"{label}: estimated allocation is {estimated_mb:.0f} MB, "
            f"exceeding the budget of {budget_mb:.0f} MB. "
            f"Reduce resolution, frame count, or set IMAGEOPS_MAX_ALLOC_MB "
            f"to a higher value."
        )
        self.estimated_mb = estimated_mb
        self.budget_mb = budget_mb
        self.label = label


def estimate_bytes(
    B: int,
    H: int,
    W: int,
    C: int,
    dtype: torch.dtype = torch.float32,
    multiplier: float = 1.0,
) -> int:
    """Estimate bytes for a tensor allocation including a working-set multiplier.

    The multiplier accounts for intermediate allocations during processing:
        constant/ramp       ~1.0-2.0
        simple point op     ~2.0
        resize/grid_sample  ~3.0-5.0
        blur                ~3.0-8.0
        surface blur        much higher
        comp N layers       dynamic
    """
    element_size = torch.tensor([], dtype=dtype).element_size()
    return int(B * H * W * C * element_size * max(1.0, multiplier))


def check_budget(
    B: int,
    H: int,
    W: int,
    C: int,
    *,
    dtype: torch.dtype = torch.float32,
    multiplier: float = 2.0,
    label: str = "ImageOps allocation",
    budget_mb: float | None = None,
    device: torch.device | None = None,
) -> int:
    """Check whether a planned allocation fits within the memory budget.

    `device` is the device the allocation will actually happen on. When omitted,
    checks against ComfyUI's compute device (its historical default), which can
    under- or over-estimate headroom for allocations that end up on a different
    device (e.g. CPU fallback under low VRAM).

    Returns the estimated byte count if within budget.
    Raises MemoryBudgetError with a helpful message if not.
    """
    est = estimate_bytes(B, H, W, C, dtype, multiplier)
    limit_mb = float(budget_mb if budget_mb is not None else MAX_ALLOC_MB)

    mm = _model_management()
    if mm is not None:
        free_bytes = mm.get_free_memory(device if device is not None else mm.get_torch_device())
        if free_bytes > 0:
            # Cap the limit to 90% of free memory to leave a safety margin
            limit_mb = min(limit_mb, free_bytes / (1024 * 1024) * 0.9)

    est_mb = est / (1024 * 1024)
    if est_mb > limit_mb:
        raise MemoryBudgetError(est_mb, limit_mb, label)
    return est


def _model_management():
    """comfy.model_management, or None without ComfyUI or a usable torch device."""
    try:
        import comfy.model_management as mm
        mm.get_torch_device()
    except (ImportError, AssertionError):  # no ComfyUI (unit tests), or CPU-only torch without --cpu
        return None
    return mm


def to_compute_device(tensor: torch.Tensor, working_set: float) -> torch.Tensor:
    """Move `tensor` to ComfyUI's torch device when `working_set` copies of it fit in free memory.

    Falls back to the tensor's current device, so low-VRAM setups keep working.
    """
    mm = _model_management()
    if mm is None or COMPUTE_DEVICE == "cpu":
        return tensor
    device = mm.get_torch_device()
    if tensor.device == device:
        return tensor
    if mm.get_free_memory(device) < tensor.numel() * tensor.element_size() * working_set:
        return tensor
    return tensor.to(device)


def to_intermediate_device(tensor: torch.Tensor) -> torch.Tensor:
    """Return node outputs on ComfyUI's intermediate device, as downstream nodes expect."""
    mm = _model_management()
    if mm is None:
        return tensor
    return tensor.to(mm.intermediate_device())
