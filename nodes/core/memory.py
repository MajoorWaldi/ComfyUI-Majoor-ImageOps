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
) -> int:
    """Check whether a planned allocation fits within the memory budget.

    Returns the estimated byte count if within budget.
    Raises MemoryBudgetError with a helpful message if not.
    """
    est = estimate_bytes(B, H, W, C, dtype, multiplier)
    limit_mb = float(budget_mb if budget_mb is not None else MAX_ALLOC_MB)
    
    # Attempt to query actual free memory from ComfyUI
    try:
        import comfy.model_management as mm
        # Defaulting to checking CPU memory if device is not explicitly tracked in budget yet,
        # but mm.get_free_memory usually expects a device. If we pass None or a default device:
        # Actually, let's just check the default torch device or mm's tracked memory
        device = mm.get_torch_device() if hasattr(mm, 'get_torch_device') else None
        if device is not None:
            free_bytes = mm.get_free_memory(device)
            if free_bytes > 0:
                free_mb = free_bytes / (1024 * 1024)
                # Cap the limit to 90% of free memory to leave a safety margin
                limit_mb = min(limit_mb, free_mb * 0.9)
    except (ImportError, AttributeError, Exception):
        pass

    est_mb = est / (1024 * 1024)
    if est_mb > limit_mb:
        raise MemoryBudgetError(est_mb, limit_mb, label)
    return est
