from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_invert,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from ._preview import build_node_preview_result

class ImageOpsInvert:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "invert_alpha": ("BOOLEAN", {"default": False}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, bypass=False, invert_alpha=False, invert_mask=False, video=None, mask=None):
        src = _select_media_tensor(image, video)
        output_mask = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        if _scalar(bypass, bool):
            return build_node_preview_result(src, (src, output_mask), prefix="imageops_invert")
        out = _apply_invert(src, invert_alpha=_scalar(invert_alpha, bool))
        if mask is None and src.shape[-1] >= 4 and _scalar(invert_alpha, bool):
            output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
        return build_node_preview_result(out, (out, output_mask), prefix="imageops_invert")
