from ._helpers import _apply_sharpen, _apply_mask_to_image, _select_media_tensor
from ._preview import save_temp_images, save_temp_animated


class ImageOpsSharpen:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "amount": ("FLOAT", {"default": 0.6, "min": 0.0, "max": 3.0, "step": 0.01}),
                "radius": ("INT", {"default": 2, "min": 0, "max": 64, "step": 1}),
                "sigma": ("FLOAT", {"default": 1.0, "min": 0.1, "max": 20.0, "step": 0.05}),
                "threshold": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 0.5, "step": 0.005}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, amount=0.6, radius=2, sigma=1.0, threshold=0.0,
              preview=False, preview_mode="images", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_sharpen(src, amount, radius, sigma, threshold)
        out = _apply_mask_to_image(src, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_sharpen", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_sharpen")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_sharpen", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_sharpen")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_sharpen")}
            return {"ui": ui, "result": (out,)}
        return (out,)
