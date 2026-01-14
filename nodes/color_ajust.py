from ._helpers import (
    _apply_color_correct,
    _apply_huesat,
    _apply_mask_to_image,
    _select_media_tensor,
)


class ImageOpsColorAjust:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "bypass": ("BOOLEAN", {"default": False}),
                "brightness": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "contrast": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "saturation": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "hue_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "hs_saturation": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "hs_value": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            },
        }

    def apply(
        self,
        image,
        bypass,
        brightness,
        contrast,
        gamma,
        saturation,
        hue_deg,
        hs_saturation,
        hs_value,
        video=None,
        mask=None,
    ):
        source = _select_media_tensor(image, video)
        if bool(bypass):
            return (source,)
        x = _apply_color_correct(source, brightness, contrast, gamma, saturation)
        x = _apply_huesat(x, hue_deg, hs_saturation, hs_value)
        return (_apply_mask_to_image(source, x, mask),)
