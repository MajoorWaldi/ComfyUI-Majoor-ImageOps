from ._helpers import _apply_edge_detect, _apply_mask_to_image, _select_media_tensor
from ._preview import save_temp_images, save_temp_animated


class ImageOpsEdgeDetect:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 10.0, "step": 0.05}),
                "preview": ("BOOLEAN", {"default": False}),
                "preview_mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, strength=1.0, preview=False, preview_mode="images", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_edge_detect(src, strength)
        out = _apply_mask_to_image(src, out, mask)

        if preview:
            if preview_mode == "animated_webp":
                item = save_temp_animated(out, prefix="imageops_edge", ext="webp")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_edge")}
            elif preview_mode == "animated_gif":
                item = save_temp_animated(out, prefix="imageops_edge", ext="gif")
                ui = {"images": [item]} if item else {"images": save_temp_images(out, prefix="imageops_edge")}
            else:
                ui = {"images": save_temp_images(out, prefix="imageops_edge")}
            return {"ui": ui, "result": (out,)}
        return (out,)
