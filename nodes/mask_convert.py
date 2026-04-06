import torch

from ._helpers import (
    LUMA_WEIGHTS,
    MEDIA_INPUT_TYPE,
    _coerce_mask_tensor,
    _mask_to_preview_image,
    _scalar,
    _select_media_tensor,
)
from ._preview import build_node_preview_result
from ._progress import start_progress


def _image_to_mask(image: torch.Tensor) -> torch.Tensor:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")

    if image.shape[-1] >= 4:
        alpha = image[..., 3].float().clamp(0.0, 1.0)
        if float((alpha.max() - alpha.min()).detach().cpu().item()) > 1e-6:
            return alpha
        if float((1.0 - alpha).abs().max().detach().cpu().item()) > 1e-6:
            return alpha

    rgb = image[..., :3].float().clamp(0.0, 1.0)
    weights = torch.tensor(LUMA_WEIGHTS, device=rgb.device, dtype=rgb.dtype)
    return (rgb * weights).sum(dim=-1).clamp(0.0, 1.0)


class ImageOpsMaskConvert:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "reverse": ("BOOLEAN", {"default": False, "label_on": "image -> mask", "label_off": "mask -> image"}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input used when reverse is enabled.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, reverse=False, image=None, video=None, mask=None, unique_id=None):
        progress = start_progress(unique_id=unique_id)

        if _scalar(reverse, bool):
            source = _select_media_tensor(image, video)
            output_mask = _image_to_mask(source)
            output_image = _mask_to_preview_image(output_mask, device=source.device, dtype=source.dtype)
        else:
            output_mask = _coerce_mask_tensor(mask)
            if output_mask is None:
                raise ValueError("ImageOps Mask Convert requires a mask input when reverse is disabled.")
            output_image = _mask_to_preview_image(output_mask)

        progress.finish()
        return build_node_preview_result(output_image, (output_image, output_mask), prefix="imageops_mask_convert")