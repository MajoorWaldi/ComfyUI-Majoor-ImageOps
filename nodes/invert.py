from ._helpers import _apply_invert, _apply_mask_to_image, _select_media_tensor
from ._preview import save_temp_images, save_temp_animated


class ImageOpsInvert:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "invert_alpha": ("BOOLEAN", {"default": False}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, invert_alpha=False, preview=False, preview_mode="images", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_invert(src, invert_alpha=bool(invert_alpha))
        out = _apply_mask_to_image(src, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_invert", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_invert")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_invert", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_invert")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_invert")}
            return {"ui": ui, "result": (out,)}
        return (out,)
