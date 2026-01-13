from ._helpers import _apply_color_correct, _apply_mask_to_image, _select_media_tensor


class ImageOpsColorCorrect:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "brightness": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "contrast": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "saturation": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image, brightness, contrast, gamma, saturation, video=None, mask=None):
        source = _select_media_tensor(image, video)
        processed = _apply_color_correct(source, brightness, contrast, gamma, saturation)
        return (_apply_mask_to_image(source, processed, mask),)
