from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_mask_to_image,
    _apply_color_adjust,
    _prepare_effect_mask,
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
                "tint": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "hue": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "brightness": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "contrast": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "saturation": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "vibrance": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 5.0, "display": "slider", "round": 0.001}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 2.2, "step": 0.1, "display": "slider", "round": 0.001}),
                "shadows_hue": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "round": 0.001}),
                "shadows_amount": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_hue": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "round": 0.001}),
                "midtones_amount": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_hue": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 1.0, "round": 0.001}),
                "highlights_amount": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 100.0, "step": 1.0, "round": 0.001}),
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
        tint=0.0,
        hue=0.0,
        brightness=0.0,
        contrast=0.0,
        saturation=0.0,
        vibrance=0.0,
        gamma=1.0,
        shadows_hue=0.0,
        shadows_amount=0.0,
        midtones_hue=0.0,
        midtones_amount=0.0,
        highlights_hue=0.0,
        highlights_amount=0.0,
        invert_mask=False,
        video=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_color_ajust")
        result = _apply_color_adjust(
            source,
            temperature,
            tint,
            hue,
            brightness,
            contrast,
            saturation,
            vibrance,
            gamma,
            shadows_hue,
            shadows_amount,
            midtones_hue,
            midtones_amount,
            highlights_hue,
            highlights_amount,
        )
        result = _apply_mask_to_image(source, result, effect_mask)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_color_ajust")
