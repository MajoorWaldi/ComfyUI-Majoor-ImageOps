from ._helpers import _apply_huesat, _apply_mask_to_image, _select_media_tensor

class ImageOpsHueSat:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "hue_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.5, "display": "slider", "round": 0.001}),
                "saturation": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "value": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, hue_deg=0.0, saturation=1.0, value=1.0, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_huesat(src, hue_deg, saturation, value)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)