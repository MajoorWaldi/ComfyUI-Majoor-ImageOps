"""Comp must not silently clamp scene-linear/HDR RGB when compositing a layer."""
from __future__ import annotations

import torch

from nodes._helpers import _composite_comp_layer, _make_comp_canvas


def test_rect_placement_preserves_hdr_layer():
    canvas = _make_comp_canvas(1, 8, 8, torch.device("cpu"), torch.float32)
    layer = torch.full((1, 4, 4, 3), 3.0)  # HDR RGB, fully covering placement

    out = _composite_comp_layer(
        canvas,
        layer,
        None,
        mode="over",
        opacity=1.0,
        center_x=0.5,
        center_y=0.5,
        scale=1.0,
        rotate_deg=0.0,
    )

    assert out[..., :3].max() > 1.0
    # alpha stays canonical regardless of RGB range
    assert out[..., 3].max() <= 1.0
    assert out[..., 3].min() >= 0.0
