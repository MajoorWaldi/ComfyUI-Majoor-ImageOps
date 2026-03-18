from ._helpers import (
    CHANNEL_OPTIONS,
    MEDIA_INPUT_TYPE,
    _channel_mask_to_image,
    _extract_channel_mask,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _select_media_tensor,
)
from ._preview import build_node_preview_result


class ImageOpsChannel:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "channel": (CHANNEL_OPTIONS, {"default": "Red"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
        }

    def apply(self, image=None, bypass=False, channel="Red", invert_mask=False, mask=None):
        source = _select_media_tensor(image, None)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        if bool(bypass):
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_channel")

        extracted = _extract_channel_mask(source, channel)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        if effect_mask is not None:
            extracted = (extracted * effect_mask).clamp(0.0, 1.0)

        result = _channel_mask_to_image(extracted, source)
        return build_node_preview_result(result, (result, extracted), prefix="imageops_channel")
