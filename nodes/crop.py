from ._helpers import (
    ASPECT_RATIO_PRESETS,
    MEDIA_INPUT_TYPE,
    _apply_interactive_crop_resize,
    _apply_interactive_crop_resize_with_mask_pair,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _select_media_tensor,
)
from ._preview import build_node_preview_result


class ImageOpsCrop:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        aspect_options = list(ASPECT_RATIO_PRESETS.keys())
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "aspect_ratio": (aspect_options, {"default": "1:1"}),
                "width": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "sync_dimensions": ("BOOLEAN", {"default": True, "label_on": "Linked", "label_off": "Free"}),
                "crop_center_x": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "crop_center_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "crop_scale": ("FLOAT", {"default": 1.0, "min": 0.05, "max": 1.0, "step": 0.001}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
        }

    def apply(self, image=None, bypass=False, aspect_ratio="1:1", width=1024, height=1024, sync_dimensions=True,
              invert_mask=False, mask=None, crop_center_x=0.5, crop_center_y=0.5, crop_scale=1.0):
        del sync_dimensions
        source = _select_media_tensor(image, None)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)

        if bool(bypass):
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_crop")

        if input_mask is not None:
            result, output_mask = _apply_interactive_crop_resize_with_mask_pair(
                source,
                input_mask,
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
            )
        else:
            result = _apply_interactive_crop_resize(
                source,
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
            )
            output_mask = _apply_interactive_crop_resize(
                output_mask_source.unsqueeze(-1),
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
            )[..., 0]
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_crop")
