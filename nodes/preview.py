import torch

from ._helpers import MEDIA_INPUT_TYPE, _alpha_mask_from_image, _coerce_mask_tensor, _mask_to_preview_image, _select_media_tensor
from ._progress import start_progress
from ._preview import save_temp_images, save_temp_animated, save_temp_strip


class ImageOpsPreview:
    """
    Preview bridge node:
    - previews IMAGE or MASK input
    - passes IMAGE through to IMAGE output
    - passes MASK through to MASK output
    """
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "preview"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "preview_target": (["auto", "image", "mask"], {"default": "auto"}),
                "mode": (["images", "strip", "animated_webp", "animated_gif"], {"default": "images"}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    def preview(self, image=None, preview_target="auto", mode="images", mask=None, video=None, prompt=None, extra_pnginfo=None, unique_id=None):
        del prompt, extra_pnginfo
        progress = start_progress(unique_id=unique_id)
        image_tensor = None
        if image is not None or video is not None:
            image_tensor = _select_media_tensor(image, video)

        mask_tensor = _coerce_mask_tensor(
            mask,
            device=image_tensor.device if image_tensor is not None else None,
            dtype=image_tensor.dtype if image_tensor is not None else torch.float32,
        )

        if image_tensor is None and mask_tensor is None:
            raise ValueError("ImageOps Preview requires an image/video input, a mask input, or both.")

        output_image = image_tensor if image_tensor is not None else _mask_to_preview_image(mask_tensor)
        output_mask = mask_tensor if mask_tensor is not None else _alpha_mask_from_image(output_image)

        target = str(preview_target or "auto").strip().lower()
        if target == "mask":
            preview_image = _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)
        elif target == "image":
            preview_image = output_image
        else:
            preview_image = output_image if image_tensor is not None else _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)

        if mode == "strip":
            item = save_temp_strip(preview_image, prefix="imageops_preview", ext="png")
            ui = {"images": [item]} if item else {"images": save_temp_images(preview_image, prefix="imageops_preview")}
        elif mode == "animated_webp":
            item = save_temp_animated(preview_image, prefix="imageops_preview", ext="webp")
            ui = {"images": [item]} if item else {"images": save_temp_images(preview_image, prefix="imageops_preview")}
        elif mode == "animated_gif":
            item = save_temp_animated(preview_image, prefix="imageops_preview", ext="gif")
            ui = {"images": [item]} if item else {"images": save_temp_images(preview_image, prefix="imageops_preview")}
        else:
            ui = {"images": save_temp_images(preview_image, prefix="imageops_preview")}
        progress.finish()
        return {"ui": ui, "result": (output_image, output_mask)}
