from __future__ import annotations

import torch

from nodes.core.alpha import premultiply, replace_alpha, split_rgba, unpremultiply


def test_split_rgba_with_alpha():
    image = torch.rand((2, 4, 4, 4))

    rgb, alpha = split_rgba(image)

    assert rgb.shape == (2, 4, 4, 3)
    assert alpha.shape == (2, 4, 4, 1)
    assert torch.allclose(rgb, image[..., :3])
    assert torch.allclose(alpha, image[..., 3:4])


def test_split_rgba_without_alpha():
    image = torch.rand((2, 4, 4, 3))

    rgb, alpha = split_rgba(image)

    assert alpha is None
    assert torch.allclose(rgb, image)


def test_premultiply_unpremultiply_round_trip():
    rgb = torch.rand((1, 4, 4, 3)) * 2.0 - 0.5  # includes negative and >1 values
    alpha = torch.rand((1, 4, 4, 1)).clamp(0.2, 1.0)  # keep away from zero

    premult = premultiply(rgb, alpha)
    straight = unpremultiply(premult, alpha)

    assert torch.allclose(straight, rgb, atol=1e-5)


def test_premultiply_none_alpha_is_noop():
    rgb = torch.rand((1, 4, 4, 3))

    assert torch.allclose(premultiply(rgb, None), rgb)
    assert torch.allclose(unpremultiply(rgb, None), rgb)


def test_unpremultiply_zero_alpha_returns_zero_not_nan():
    rgb = torch.full((1, 1, 1, 3), 5.0)
    alpha = torch.zeros((1, 1, 1, 1))

    result = unpremultiply(rgb, alpha)

    assert torch.isfinite(result).all()
    assert torch.allclose(result, torch.zeros_like(result))


def test_unpremultiply_preserves_hdr_values():
    rgb = torch.tensor([[[[4.0, -1.0, 2.0]]]])
    alpha = torch.ones((1, 1, 1, 1))

    result = unpremultiply(rgb, alpha)

    assert torch.allclose(result, rgb)


def test_replace_alpha_clamps_and_keeps_rgb():
    image = torch.rand((1, 4, 4, 4)) * 2.0
    new_alpha = torch.full((1, 4, 4, 1), 1.5)

    out = replace_alpha(image, new_alpha)

    assert torch.allclose(out[..., :3], image[..., :3])
    assert torch.allclose(out[..., 3:4], torch.ones_like(new_alpha))
