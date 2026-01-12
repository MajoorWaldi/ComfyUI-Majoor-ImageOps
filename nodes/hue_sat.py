from ._helpers import _apply_huesat, _apply_mask_to_image, _select_media_tensor
from ._preview import save_temp_images, save_temp_animated


class ImageOpsHueSat:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "hue_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.5}),
                "saturation": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01}),
                "value": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, hue_deg=0.0, saturation=1.0, value=1.0,
              preview=False, preview_mode="images", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_huesat(src, hue_deg, saturation, value)
        out = _apply_mask_to_image(src, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_huesat", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_huesat")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_huesat", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_huesat")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_huesat")}
            return {"ui": ui, "result": (out,)}
        return (out,)
