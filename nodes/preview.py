from ._preview import save_temp_images, save_temp_animated


class ImageOpsPreview:
    """
    Output-only preview node, similar to ComfyUI's PreviewImage, but tuned for IMAGE batches:
    - images: emits individual previews
    - animated_webp / animated_gif: emits a single animated preview for sequences
    """
    CATEGORY = "image/imageops"
    RETURN_TYPES = ()
    FUNCTION = "preview"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "mode": (["images", "animated_webp", "animated_gif"], {"default": "images"}),
            }
        }

    def preview(self, image, mode="images"):
        if mode == "animated_webp":
            item = save_temp_animated(image, prefix="imageops_preview", ext="webp")
            ui = {"images": [item]} if item else {"images": save_temp_images(image, prefix="imageops_preview")}
        elif mode == "animated_gif":
            item = save_temp_animated(image, prefix="imageops_preview", ext="gif")
            ui = {"images": [item]} if item else {"images": save_temp_images(image, prefix="imageops_preview")}
        else:
            ui = {"images": save_temp_images(image, prefix="imageops_preview")}
        return {"ui": ui}
