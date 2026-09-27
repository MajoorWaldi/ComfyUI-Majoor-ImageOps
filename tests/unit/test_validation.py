from __future__ import annotations

import torch

from nodes.core.validation import clamp_alpha, clamp_mask, sanitize_finite


def test_sanitize_finite_leaves_finite_values_untouched():
    x = torch.tensor([-5.0, 0.0, 2.5, 100.0])

    out = sanitize_finite(x)

    assert torch.allclose(out, x)


def test_sanitize_finite_replaces_nan_and_inf():
    x = torch.tensor([float("nan"), float("inf"), float("-inf"), 1.0])

    out = sanitize_finite(x, nan=0.0, posinf=10.0, neginf=-10.0)

    assert torch.allclose(out, torch.tensor([0.0, 10.0, -10.0, 1.0]))


def test_clamp_mask_clamps_out_of_range():
    mask = torch.tensor([-1.0, 0.5, 2.0])

    out = clamp_mask(mask)

    assert out.min() >= 0.0
    assert out.max() <= 1.0


def test_clamp_alpha_sanitizes_and_clamps():
    alpha = torch.tensor([float("nan"), -1.0, 0.5, 5.0])

    out = clamp_alpha(alpha)

    assert torch.isfinite(out).all()
    assert out.min() >= 0.0
    assert out.max() <= 1.0
