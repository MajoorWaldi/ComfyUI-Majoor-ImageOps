from ._helpers import _apply_lumakey, _select_media_tensor


class ImageOpsLumaKey:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("MASK",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "low": ("FLOAT", {"default": 0.1, "min": 0.0, "max": 1.0, "step": 0.005}),
                "high": ("FLOAT", {"default": 0.9, "min": 0.0, "max": 1.0, "step": 0.005}),
                "softness": ("FLOAT", {"default": 0.05, "min": 0.0, "max": 0.5, "step": 0.005}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
            }
        }

    def apply(self, image=None, low=0.1, high=0.9, softness=0.05, video=None):
        src = _select_media_tensor(image, video)
        mask = _apply_lumakey(src, low, high, softness)
        # mask is [B,H,W], comfy expects [B,H,W]
        return (mask,)
