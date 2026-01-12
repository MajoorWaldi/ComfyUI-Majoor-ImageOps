from ._helpers import _dilate_erode_mask


class ImageOpsDilateErode:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("MASK",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mask": ("MASK",),
                "operation": (["dilate", "erode"], {"default": "dilate"}),
                "radius": ("INT", {"default": 2, "min": 0, "max": 256, "step": 1}),
            }
        }

    def apply(self, mask, operation="dilate", radius=2):
        out = _dilate_erode_mask(mask, radius, operation)
        return (out,)
