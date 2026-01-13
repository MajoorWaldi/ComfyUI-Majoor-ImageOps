from ._helpers import _apply_blur, _apply_mask_to_image, _select_media_tensor


class ImageOpsBlur:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "radius": ("INT", {"default": 3, "min": 0, "max": 128, "step": 1}),
                "sigma": ("FLOAT", {"default": 1.5, "min": 0.01, "max": 64.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image, radius, sigma, video=None, mask=None):
        source = _select_media_tensor(image, video)
        processed = _apply_blur(source, radius, sigma)
        return (_apply_mask_to_image(source, processed, mask),)
