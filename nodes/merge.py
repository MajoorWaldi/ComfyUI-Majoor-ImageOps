from ._helpers import _apply_merge, _apply_mask_to_image

class ImageOpsMerge:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": ("IMAGE", {"tooltip": "Background"}),
                "B": ("IMAGE", {"tooltip": "Foreground"}),
                "mode": (["over", "add", "subtract", "multiply", "screen", "difference", "max", "min"], {"default": "over"}),
                "mix": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask applied to merge result"}),
            }
        }

    def apply(self, A, B, mode="over", mix=1.0, mask=None):
        out = _apply_merge(A, B, mode, mix)
        out = _apply_mask_to_image(A, out, mask)
        return (out,)