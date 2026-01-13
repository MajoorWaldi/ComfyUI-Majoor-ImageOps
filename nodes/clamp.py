from ._helpers import _apply_clamp, _apply_mask_to_image, _select_media_tensor

class ImageOpsClamp:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "min_v": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "max_v": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, min_v=0.0, max_v=1.0, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_clamp(src, min_v, max_v)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)