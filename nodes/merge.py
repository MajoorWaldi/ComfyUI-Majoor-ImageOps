from ._helpers import _apply_merge, _apply_mask_to_image
from ._preview import save_temp_images, save_temp_animated


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
                "mix": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask applied to merge result"}),
            }
        }

    def apply(self, A, B, mode="over", mix=1.0, preview=False, preview_mode="images", mask=None):
        out = _apply_merge(A, B, mode, mix)
        out = _apply_mask_to_image(A, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_merge", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_merge")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_merge", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_merge")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_merge")}
            return {"ui": ui, "result": (out,)}
        return (out,)
