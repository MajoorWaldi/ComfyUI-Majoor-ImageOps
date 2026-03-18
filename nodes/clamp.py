from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_clamp,
    _clamp_mask,
    _resolve_mask_output_source,
    _select_media_tensor,
)
from ._preview import build_node_preview_result

class ImageOpsClamp:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "min_v": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "max_v": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, bypass=False, min_v=0.0, max_v=1.0, invert_mask=False, video=None, mask=None):
        src = _select_media_tensor(image, video)
        output_mask_source = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        if bool(bypass):
            return build_node_preview_result(src, (src, output_mask_source), prefix="imageops_clamp")
        out = _apply_clamp(src, min_v, max_v)
        if mask is None and src.shape[-1] < 4:
            output_mask = output_mask_source
        else:
            output_mask = _clamp_mask(output_mask_source, min_v, max_v)
        return build_node_preview_result(out, (out, output_mask), prefix="imageops_clamp")
