"""Merge must not silently clamp scene-linear/HDR RGB values to [0,1].

Alpha channels stay canonical [0,1]; only RGB is allowed out of range.
"""
from __future__ import annotations

import torch

from nodes._helpers import _apply_merge


def test_over_mode_preserves_out_of_range_foreground():
    a = torch.zeros((1, 1, 1, 3))
    b = torch.full((1, 1, 1, 3), 2.5)

    out = _apply_merge(a, b, mode="over", mix=1.0, blend_space="srgb")

    assert torch.allclose(out, b)


def test_add_mode_preserves_negative_background():
    a = torch.full((1, 1, 1, 3), -0.5)
    b = torch.full((1, 1, 1, 3), 1.0)

    out = _apply_merge(a, b, mode="add", mix=1.0, blend_space="srgb")

    assert torch.allclose(out, torch.full((1, 1, 1, 3), 0.5))


def test_alpha_channel_stays_clamped_even_when_rgb_is_hdr():
    a = torch.cat(
        [
            torch.full((1, 1, 1, 3), 3.0),  # HDR RGB
            torch.full((1, 1, 1, 1), 1.7),  # out-of-range alpha (invalid input)
        ],
        dim=-1,
    )
    b = torch.zeros((1, 1, 1, 3))

    # mix=0 passes A straight through, isolating A's own RGB/alpha handling
    # from B's compositing math.
    out = _apply_merge(a, b, mode="over", mix=0.0, blend_space="srgb")

    assert out.shape[-1] == 4
    assert out[..., 3:4].max() <= 1.0
    assert torch.allclose(out[..., :3], torch.full((1, 1, 1, 3), 3.0))
