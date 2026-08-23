import pytest
import torch

from nodes._helpers import _apply_color_adjust

class TestHDRSupport:
    def test_apply_color_adjust_preserves_hdr(self):
        # Create an HDR tensor [B, H, W, C]
        hdr_image = torch.tensor([[[[2.0, 5.0, 10.0]]]], dtype=torch.float32)

        # Apply identity color adjustment
        adjusted = _apply_color_adjust(
            hdr_image,
            temperature=0.0,
            tint=0.0,
            hue=0.0,
            brightness=0.0,
            contrast=0.0,
            saturation=0.0,
            vibrance=0.0,
            gamma=1.0,
        )

        # It should not be clamped to 1.0
        assert adjusted.max().item() > 1.0
        assert torch.allclose(adjusted, hdr_image, atol=1e-4)


