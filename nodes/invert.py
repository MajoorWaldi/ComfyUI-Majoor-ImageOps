from ._helpers import _apply_invert, _apply_mask_to_image, _select_media_tensor

class ImageOpsInvert:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "bypass": ("BOOLEAN", {"default": False}),
                "invert_alpha": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, bypass=False, invert_alpha=False, video=None, mask=None):
        src = _select_media_tensor(image, video)
        if bool(bypass):
            return (src,)
        out = _apply_invert(src, invert_alpha=bool(invert_alpha))
        out = _apply_mask_to_image(src, out, mask)
        return (out,)
