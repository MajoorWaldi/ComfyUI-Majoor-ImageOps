"""Shared pytest fixtures for ImageOps tests."""
from __future__ import annotations

import torch
import pytest


@pytest.fixture
def rgb_image_1x64():
    """Single-frame 64x64 RGB test image with a gradient pattern."""
    img = torch.zeros(1, 64, 64, 3, dtype=torch.float32)
    # Horizontal red gradient, vertical green gradient
    img[..., 0] = torch.linspace(0, 1, 64).unsqueeze(0)
    img[..., 1] = torch.linspace(0, 1, 64).unsqueeze(1)
    img[..., 2] = 0.25
    return img


@pytest.fixture
def rgba_image_1x64():
    """Single-frame 64x64 RGBA test image with semi-transparent alpha."""
    img = torch.zeros(1, 64, 64, 4, dtype=torch.float32)
    img[..., 0] = torch.linspace(0, 1, 64).unsqueeze(0)
    img[..., 1] = torch.linspace(0, 1, 64).unsqueeze(1)
    img[..., 2] = 0.25
    img[..., 3] = 0.8
    return img


@pytest.fixture
def rgb_batch_4x64():
    """4-frame 64x64 RGB batch."""
    return torch.rand(4, 64, 64, 3, dtype=torch.float32)


@pytest.fixture
def rgba_batch_4x64():
    """4-frame 64x64 RGBA batch."""
    return torch.rand(4, 64, 64, 4, dtype=torch.float32)


@pytest.fixture
def mask_1x64():
    """Single-frame 64x64 mask with a radial gradient."""
    ys = torch.linspace(-1, 1, 64)
    xs = torch.linspace(-1, 1, 64)
    gy, gx = torch.meshgrid(ys, xs, indexing="ij")
    r = (gx * gx + gy * gy).sqrt().clamp(0, 1)
    return (1.0 - r).unsqueeze(0)  # [1, 64, 64]


@pytest.fixture
def mask_4x64():
    """4-frame 64x64 mask batch."""
    return torch.rand(4, 64, 64, dtype=torch.float32)


@pytest.fixture
def hdr_image_1x64():
    """Single-frame 64x64 RGB image with HDR values (outside [0,1])."""
    img = torch.zeros(1, 64, 64, 3, dtype=torch.float32)
    img[0, :32, :, 0] = 2.0     # bright red
    img[0, 32:, :, 1] = -0.25   # negative green
    img[0, :, :32, 2] = 4.0     # very bright blue
    img[0, :, 32:, 2] = 0.5
    return img
