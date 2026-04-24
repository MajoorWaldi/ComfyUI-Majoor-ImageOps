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
                # Per-zone primaries. Each is added to the global value, weighted
                # by the corresponding luma mask (shadows / midtones / highlights),
                # so a zone slider at 0 (or 1.0 for gamma) is a perfect no-op.
                "shadows_temperature": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "shadows_tint": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "shadows_contrast": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "shadows_saturation": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "shadows_vibrance": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "shadows_gamma": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 2.2, "step": 0.01, "round": 0.001}),
                "shadows_brightness": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_temperature": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_tint": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_contrast": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_saturation": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_vibrance": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "midtones_gamma": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 2.2, "step": 0.01, "round": 0.001}),
                "midtones_brightness": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_temperature": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_tint": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_contrast": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_saturation": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_vibrance": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
                "highlights_gamma": ("FLOAT", {"default": 1.0, "min": 0.2, "max": 2.2, "step": 0.01, "round": 0.001}),
                "highlights_brightness": ("FLOAT", {"default": 0.0, "min": -100.0, "max": 100.0, "step": 1.0, "round": 0.001}),
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
        shadows_temperature=0.0,
        shadows_tint=0.0,
        shadows_contrast=0.0,
        shadows_saturation=0.0,
        shadows_vibrance=0.0,
        shadows_gamma=1.0,
        shadows_brightness=0.0,
        midtones_temperature=0.0,
        midtones_tint=0.0,
        midtones_contrast=0.0,
        midtones_saturation=0.0,
        midtones_vibrance=0.0,
        midtones_gamma=1.0,
        midtones_brightness=0.0,
        highlights_temperature=0.0,
        highlights_tint=0.0,
        highlights_contrast=0.0,
        highlights_saturation=0.0,
        highlights_vibrance=0.0,
        highlights_gamma=1.0,
        highlights_brightness=0.0,
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
            shadows_temperature=shadows_temperature,
            shadows_tint=shadows_tint,
            shadows_contrast=shadows_contrast,
            shadows_saturation=shadows_saturation,
            shadows_vibrance=shadows_vibrance,
            shadows_gamma=shadows_gamma,
            shadows_brightness=shadows_brightness,
            midtones_temperature=midtones_temperature,
            midtones_tint=midtones_tint,
            midtones_contrast=midtones_contrast,
            midtones_saturation=midtones_saturation,
            midtones_vibrance=midtones_vibrance,
            midtones_gamma=midtones_gamma,
            midtones_brightness=midtones_brightness,
            highlights_temperature=highlights_temperature,
            highlights_tint=highlights_tint,
            highlights_contrast=highlights_contrast,
            highlights_saturation=highlights_saturation,
            highlights_vibrance=highlights_vibrance,
            highlights_gamma=highlights_gamma,
            highlights_brightness=highlights_brightness,
        )
        result = _apply_mask_to_image(source, result, effect_mask)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_color_ajust")
