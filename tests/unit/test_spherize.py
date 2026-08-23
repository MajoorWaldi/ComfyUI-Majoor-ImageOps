"""Unit tests for ImageOpsSpherize verifying mask grid warping and bypass."""
from __future__ import annotations

import pytest
import torch

from nodes.spherize import ImageOpsSpherize


def _unwrap(result):
    if isinstance(result, dict):
        return result["result"]
    return result


class TestImageOpsSpherize:
    def test_spherize_bypass_preserves_resolution(self):
        node = ImageOpsSpherize()
        # Input image is 120x80
        image = torch.rand(1, 80, 120, 3, dtype=torch.float32)
        mask = torch.rand(1, 80, 120, dtype=torch.float32)

        # Custom size is set to 256x256, but bypass=True should NEVER resize
        result = _unwrap(node.execute(
            image=image,
            mask=mask,
            bypass=True,
            size_mode="custom",
            width=256,
            height=256,
        ))

        out_image = result[0]
        out_mask = result[1]

        assert out_image.shape == (1, 80, 120, 3)
        assert out_mask.shape == (1, 80, 120)
        assert torch.allclose(out_image, image)
        assert torch.allclose(out_mask, mask)

    def test_spherize_mask_warped_with_image(self):
        node = ImageOpsSpherize()
        # Put a spot at center
        image = torch.zeros(1, 64, 64, 3, dtype=torch.float32)
        image[0, 30:34, 30:34, :] = 1.0

        mask = torch.zeros(1, 64, 64, dtype=torch.float32)
        mask[0, 30:34, 30:34] = 1.0

        result = _unwrap(node.execute(
            image=image,
            mask=mask,
            mode="spherize",
            strength=1.0,
            size_mode="from_input",
        ))

        out_image = result[0]
        out_mask = result[1]

        assert out_image.shape == (1, 64, 64, 3)
        assert out_mask.shape == (1, 64, 64)
        assert torch.isfinite(out_image).all()
        assert torch.isfinite(out_mask).all()
        # Center spot should still be present and warped in both image and mask
        assert out_image[0, 32, 32, 0] > 0.5
        assert out_mask[0, 32, 32] > 0.5
