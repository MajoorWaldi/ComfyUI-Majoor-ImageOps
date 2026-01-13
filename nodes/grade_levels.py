from ._helpers import _apply_levels, _apply_mask_to_image, _select_media_tensor

class ImageOpsGradeLevels:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "in_min": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.005, "display": "slider", "round": 0.001}),
                "in_max": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.005, "display": "slider", "round": 0.001}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "out_min": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.005, "display": "slider", "round": 0.001}),
                "out_max": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.005, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, in_min=0.0, in_max=1.0, gamma=1.0, out_min=0.0, out_max=1.0, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_levels(src, in_min, in_max, gamma, out_min, out_max)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)