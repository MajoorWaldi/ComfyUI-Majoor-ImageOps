from ._helpers import _apply_sharpen, _apply_mask_to_image, _select_media_tensor

class ImageOpsSharpen:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "amount": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 3.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "radius": ("INT", {"default": 2, "min": 0, "max": 64, "step": 1}),
                "sigma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 20.0, "step": 0.05, "display": "slider", "round": 0.001}),
                "threshold": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.5, "step": 0.005, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, amount=0.6, radius=2, sigma=1.0, threshold=0.0, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_sharpen(src, amount, radius, sigma, threshold)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)