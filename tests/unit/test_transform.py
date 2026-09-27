from __future__ import annotations

import math

import torch

from nodes.core.transform import build_2d_transform, mat_rotate, transform_points

DEVICE = torch.device("cpu")
DTYPE = torch.float32


def _transform(**kwargs) -> torch.Tensor:
    return build_2d_transform(device=DEVICE, dtype=DTYPE, **kwargs)


def test_identity_leaves_points_unchanged():
    matrix = _transform()
    points = torch.tensor([[0.0, 0.0], [10.0, 5.0]])

    out = transform_points(matrix, points)

    assert torch.allclose(out, points, atol=1e-6)


def test_pure_translation():
    matrix = _transform(tx=5.0, ty=-3.0)
    points = torch.tensor([[0.0, 0.0], [1.0, 1.0]])

    out = transform_points(matrix, points)

    assert torch.allclose(out, torch.tensor([[5.0, -3.0], [6.0, -2.0]]), atol=1e-6)


def test_non_uniform_scale():
    matrix = _transform(sx=2.0, sy=0.5)
    points = torch.tensor([[10.0, 10.0]])

    out = transform_points(matrix, points)

    assert torch.allclose(out, torch.tensor([[20.0, 5.0]]), atol=1e-6)


def test_90_degree_rotation_about_origin():
    matrix = mat_rotate(90.0, device=DEVICE, dtype=DTYPE)
    points = torch.tensor([[1.0, 0.0]])

    out = transform_points(matrix, points)

    assert torch.allclose(out, torch.tensor([[0.0, 1.0]]), atol=1e-5)


def test_rotation_about_pivot_keeps_pivot_fixed():
    matrix = _transform(rotation=45.0, pivot_x=50.0, pivot_y=50.0)
    pivot = torch.tensor([[50.0, 50.0]])

    out = transform_points(matrix, pivot)

    assert torch.allclose(out, pivot, atol=1e-4)


def test_expanded_bbox_of_rotated_square():
    # A 100x100 square rotated 45 degrees about its center should expand to
    # roughly its diagonal (100*sqrt(2)) on each axis.
    matrix = _transform(rotation=45.0, pivot_x=50.0, pivot_y=50.0)
    corners = torch.tensor([[0.0, 0.0], [100.0, 0.0], [100.0, 100.0], [0.0, 100.0]])

    warped = transform_points(matrix, corners)

    span_x = warped[:, 0].max() - warped[:, 0].min()
    span_y = warped[:, 1].max() - warped[:, 1].min()

    expected = 100.0 * math.sqrt(2.0)
    assert abs(float(span_x) - expected) < 1e-3
    assert abs(float(span_y) - expected) < 1e-3
