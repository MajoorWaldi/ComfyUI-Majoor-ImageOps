from ._helpers import _apply_levels, _apply_mask_to_image, _select_media_tensor
from ._preview import save_temp_images, save_temp_animated


class ImageOpsGradeLevels:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "in_min": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.005}),
                "in_max": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.005}),
                "gamma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 5.0, "step": 0.01}),
                "out_min": ("FLOAT", {"default": 0.0, "min": -1.0, "max": 1.0, "step": 0.005}),
                "out_max": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.005}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, in_min=0.0, in_max=1.0, gamma=1.0, out_min=0.0, out_max=1.0,
              preview=False, preview_mode="images", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_levels(src, in_min, in_max, gamma, out_min, out_max)
        out = _apply_mask_to_image(src, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_levels", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_levels")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_levels", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_levels")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_levels")}
            return {"ui": ui, "result": (out,)}
        return (out,)
