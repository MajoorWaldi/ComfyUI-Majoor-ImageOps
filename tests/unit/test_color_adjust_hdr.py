"""Color Correct's vibrance step must not silently clamp scene-linear/HDR RGB."""
from __future__ import annotations

import torch

from nodes._helpers import _apply_vibrance_linear


def test_vibrance_preserves_out_of_range_highlight():
    # A strongly saturated, HDR-bright pixel: max channel well above 1.0.
    rgb = torch.tensor([[[[3.0, 0.2, 0.2]]]])
    vibrance = torch.full((1, 1, 1, 1), 0.5)

    out = _apply_vibrance_linear(rgb, vibrance)

    assert out.max() > 1.0


def test_vibrance_zero_is_noop():
    rgb = torch.tensor([[[[0.6, 0.3, 0.1]]]])
    vibrance = torch.zeros((1, 1, 1, 1))

    out = _apply_vibrance_linear(rgb, vibrance)

    assert torch.allclose(out, rgb)
