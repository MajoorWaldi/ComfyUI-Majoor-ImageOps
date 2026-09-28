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

    def test_apply_color_adjust_input_space_linear_skips_srgb_curve(self):
        # A scene-linear/HDR source should not be run through the sRGB OETF/EOTF
        # when input_space="linear", or brightness would double-gamma the result.
        linear_image = torch.tensor([[[[0.25, 0.5, 2.0]]]], dtype=torch.float32)

        adjusted = _apply_color_adjust(
            linear_image,
            temperature=0.0,
            tint=0.0,
            hue=0.0,
            brightness=20.0,
            contrast=0.0,
            saturation=0.0,
            vibrance=0.0,
            gamma=1.0,
            input_space="linear",
        )

        expected = linear_image * 1.2
        assert torch.allclose(adjusted, expected, atol=1e-4)




def test_tensor_to_pil_clamps_hdr_for_display_only():
    from nodes._helpers import _tensor_to_pil

    image = torch.tensor([[[[2.0, -1.0, 0.5], [0.0, 1.0, 0.25]]]])

    pil = _tensor_to_pil(image)

    assert pil.mode == "RGB"
    assert list(pil.getdata()) == [(255, 0, 128), (0, 255, 64)]
    assert float(image.max()) == 2.0
