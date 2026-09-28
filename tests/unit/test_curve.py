"""Tests for core/curve.py — LUT application contract."""
from __future__ import annotations

import torch

from nodes.core.curve import CURVE_LUT_SIZE, apply_curve_lut, is_identity_lut


def _linear_lut(y0: float, y1: float) -> torch.Tensor:
    return torch.linspace(y0, y1, CURVE_LUT_SIZE)


def test_identity_lut_detected_and_leaves_image_unchanged():
    lut = _linear_lut(0.0, 1.0)
    image = torch.rand(2, 8, 8, 4)

    assert is_identity_lut(lut)
    assert torch.allclose(apply_curve_lut(image, lut), image, atol=1e-6)


def test_inverting_curve_flips_rgb_and_keeps_alpha():
    image = torch.rand(1, 8, 8, 4)

    result = apply_curve_lut(image, _linear_lut(1.0, 0.0))

    assert not is_identity_lut(_linear_lut(1.0, 0.0))
    assert torch.allclose(result[..., :3], 1.0 - image[..., :3], atol=1e-5)
    assert torch.equal(result[..., 3], image[..., 3])


def test_curve_output_keeps_channel_count():
    assert apply_curve_lut(torch.rand(1, 4, 4, 3), _linear_lut(0.0, 1.0)).shape == (1, 4, 4, 3)


def test_hdr_overshoot_is_preserved_above_and_below_the_curve():
    lut = _linear_lut(0.1, 0.8)
    image = torch.tensor([[[[2.0, -0.5, 0.5]]]])

    result = apply_curve_lut(image, lut)

    assert torch.allclose(result[0, 0, 0], torch.tensor([0.8 + 1.0, 0.1 - 0.5, 0.1 + 0.7 * 0.5]), atol=1e-4)


def test_midpoint_interpolates_between_lut_samples():
    lut = torch.tensor([0.0, 0.0, 1.0, 1.0])
    image = torch.tensor([[[[0.5, 0.5, 0.5]]]])

    assert torch.allclose(apply_curve_lut(image, lut)[0, 0, 0], torch.full((3,), 0.5))
