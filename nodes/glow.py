from ._helpers import _apply_glow, _apply_mask_to_image, _select_media_tensor

class ImageOpsGlow:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "threshold": ("FLOAT", {"default": 0.7, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "radius": ("INT", {"default": 6, "min": 0, "max": 128, "step": 1}),
                "sigma": ("FLOAT", {"default": 3.0, "min": 0.1, "max": 50.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "intensity": ("FLOAT", {"default": 0.8, "min": 0.0, "max": 5.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, threshold=0.7, radius=6, sigma=3.0, intensity=0.8, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_glow(src, threshold, radius, sigma, intensity)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)