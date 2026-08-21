from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_clamp,
    _clamp_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from .compat.comfy_v3 import V3NodeBase
from ._progress import start_progress
from ._preview import build_node_preview_result

class ImageOpsClamp(V3NodeBase):
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "min_v": ("FLOAT", {"default": 0.0, "min": -10.0, "max": 10.0, "step": 0.01, "round": 0.001,
                                     "tooltip": "Minimum output value. Values below this are clamped up."}),
                "max_v": ("FLOAT", {"default": 1.0, "min": -10.0, "max": 10.0, "step": 0.01, "round": 0.001,
                                     "tooltip": "Maximum output value. Values above this are clamped down."}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, min_v=0.0, max_v=1.0, invert_mask=False, video=None, mask=None, unique_id=None):
        src = _select_media_tensor(image, video)
        output_mask_source = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(src, (src, output_mask_source), prefix="imageops_clamp")
        out = _apply_clamp(src, min_v, max_v)
        output_mask = _clamp_mask(output_mask_source, min_v, max_v)
        progress.finish()
        return build_node_preview_result(out, (out, output_mask), prefix="imageops_clamp")
