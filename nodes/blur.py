from ._helpers import (
    _apply_blur,
    _apply_blur_with_mask_pair,
    _apply_mask_to_image,
    _blur_mask,
    _gaussian_effective_radius,
    MEDIA_INPUT_TYPE,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from ._progress import start_progress
from ._preview import build_node_preview_result


def _blur_is_noop(radius, sigma) -> bool:
    if isinstance(radius, (list, tuple)) or isinstance(sigma, (list, tuple)):
        frame_count = max(
            len(radius) if isinstance(radius, (list, tuple)) else 1,
            len(sigma) if isinstance(sigma, (list, tuple)) else 1,
        )
        if frame_count <= 0:
            return True
        return all(
            _gaussian_effective_radius(_scalar(radius, int, index=i), _scalar(sigma, index=i)) <= 0
            for i in range(frame_count)
        )
    return _gaussian_effective_radius(_scalar(radius, int), _scalar(sigma)) <= 0


class ImageOpsBlur:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "radius": ("INT", {"default": 3, "min": 0, "max": 128, "step": 1}),
                "sigma": ("FLOAT", {"default": 1.5, "min": 0.01, "max": 64.0, "step": 0.01, "round": 0.001}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, radius=3, sigma=1.5, invert_mask=False, video=None, mask=None, unique_id=None):
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_blur")
        if _blur_is_noop(radius, sigma):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_blur")
        if input_mask is not None:
            result, output_mask = _apply_blur_with_mask_pair(source, input_mask, radius, sigma)
            result = _apply_mask_to_image(source, result, output_mask)
        else:
            result = _apply_blur(source, radius, sigma)
            output_mask = _blur_mask(output_mask_source, radius, sigma)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_blur")
