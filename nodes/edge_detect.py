from ._helpers import _apply_edge_detect, _apply_mask_to_image, _select_media_tensor

class ImageOpsEdgeDetect:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.05, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, strength=1.0, video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_edge_detect(src, strength)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)