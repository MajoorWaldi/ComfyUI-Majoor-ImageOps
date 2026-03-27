from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_color_correct_reference,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from ._progress import start_progress
from ._preview import build_node_preview_result


class ImageOpsColorAjust:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "temperature": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "hue": ("FLOAT", {"default": 0.0, "min": -90.0, "max": 90.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "brightness": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "contrast": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "saturation": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 2.2, "step": 0.1, "display": "slider", "round": 0.001}),
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

    def apply(
        self,
        image=None,
        bypass=False,
        temperature=0.0,
        hue=0.0,
        brightness=0.0,
        contrast=0.0,
        saturation=0.0,
        gamma=1.0,
        invert_mask=False,
        video=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_color_ajust")
        result = _apply_color_correct_reference(source, temperature, hue, brightness, contrast, saturation, gamma)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_color_ajust")
