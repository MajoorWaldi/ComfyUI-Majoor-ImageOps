"""Unit tests for ImageOpsCrop including mask synchronization."""
from __future__ import annotations

import pytest
import torch

from nodes.crop import ImageOpsCrop


def _unwrap(result):
    if isinstance(result, dict):
        return result["result"]
    return result


class TestImageOpsCrop:
    def test_crop_with_mask_synchronized(self):
        node = ImageOpsCrop()
        image = torch.zeros(1, 100, 100, 3, dtype=torch.float32)
        # Put distinct values in quadrant
        image[0, :50, :50, 0] = 1.0

        mask = torch.zeros(1, 100, 100, dtype=torch.float32)
        mask[0, :50, :50] = 1.0

        result = _unwrap(node.execute(
            image=image,
            mask=mask,
            aspect_ratio="1:1",
            width=50,
            height=50,
            crop_center_x=0.25,
            crop_center_y=0.25,
            crop_scale=0.5,
        ))

        out_image = result[0]
        out_mask = result[1]

        assert out_image.shape == (1, 50, 50, 3)
        assert out_mask.shape == (1, 50, 50)
        # Cropped region should capture the white area in both image and mask
        assert (out_image[..., 0] > 0.9).all()
        assert (out_mask > 0.9).all()

    def test_crop_bypass(self):
        node = ImageOpsCrop()
        image = torch.rand(1, 80, 80, 3, dtype=torch.float32)
        mask = torch.rand(1, 80, 80, dtype=torch.float32)

        result = _unwrap(node.execute(image=image, mask=mask, bypass=True))
        out_image = result[0]
        out_mask = result[1]

        assert torch.allclose(out_image, image)
        assert torch.allclose(out_mask, mask)
