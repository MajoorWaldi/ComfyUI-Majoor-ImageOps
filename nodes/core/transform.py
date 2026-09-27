"""Shared 2D transform matrix engine (homogeneous coordinates, forward convention).

Produces a forward 3x3 matrix mapping source pixel coordinates to destination
pixel coordinates: dst = M @ [x, y, 1]. Nodes that sample via
torch.nn.functional.affine_grid need the inverse of this matrix sliced to its
top 2 rows; this module only builds the forward matrix, not that adaptation,
since affine_grid's inverse-sampling convention is specific to that call site.

Matrix order is fixed and must not change silently:
    T(position) @ T(pivot) @ R @ Skew @ S @ T(-pivot)
"""
from __future__ import annotations

import math

import torch


def mat_identity(*, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    return torch.eye(3, device=device, dtype=dtype)


def mat_translate(tx: float, ty: float, *, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    return torch.tensor(
        [
            [1.0, 0.0, tx],
            [0.0, 1.0, ty],
            [0.0, 0.0, 1.0],
        ],
        device=device,
        dtype=dtype,
    )


def mat_scale(sx: float, sy: float, *, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    return torch.tensor(
        [
            [sx, 0.0, 0.0],
            [0.0, sy, 0.0],
            [0.0, 0.0, 1.0],
        ],
        device=device,
        dtype=dtype,
    )


def mat_rotate(degrees: float, *, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    r = math.radians(float(degrees))
    c, s = math.cos(r), math.sin(r)
    return torch.tensor(
        [
            [c, -s, 0.0],
            [s, c, 0.0],
            [0.0, 0.0, 1.0],
        ],
        device=device,
        dtype=dtype,
    )


def mat_skew(skew_x_degrees: float, skew_y_degrees: float, *, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    kx = math.tan(math.radians(float(skew_x_degrees)))
    ky = math.tan(math.radians(float(skew_y_degrees)))
    return torch.tensor(
        [
            [1.0, kx, 0.0],
            [ky, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ],
        device=device,
        dtype=dtype,
    )


def build_2d_transform(
    *,
    tx: float = 0.0,
    ty: float = 0.0,
    sx: float = 1.0,
    sy: float = 1.0,
    rotation: float = 0.0,
    skew_x: float = 0.0,
    skew_y: float = 0.0,
    pivot_x: float = 0.0,
    pivot_y: float = 0.0,
    device: torch.device,
    dtype: torch.dtype,
) -> torch.Tensor:
    return (
        mat_translate(tx, ty, device=device, dtype=dtype)
        @ mat_translate(pivot_x, pivot_y, device=device, dtype=dtype)
        @ mat_rotate(rotation, device=device, dtype=dtype)
        @ mat_skew(skew_x, skew_y, device=device, dtype=dtype)
        @ mat_scale(sx, sy, device=device, dtype=dtype)
        @ mat_translate(-pivot_x, -pivot_y, device=device, dtype=dtype)
    )


def transform_points(matrix: torch.Tensor, points_xy: torch.Tensor) -> torch.Tensor:
    """Apply a 3x3 matrix to [N, 2] points, returning [N, 2]."""
    ones = torch.ones((points_xy.shape[0], 1), device=points_xy.device, dtype=points_xy.dtype)
    homogeneous = torch.cat([points_xy, ones], dim=-1)
    out = homogeneous @ matrix.T
    return out[:, :2]
