from ._helpers import (
    CHANNEL_OPTIONS,
    MEDIA_INPUT_TYPE,
    _alpha_mask_from_image,
    _channel_mask_to_image,
    _extract_channel_mask,
    _scalar,
    _select_media_tensor,
)
from ._progress import start_progress
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
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, channel="Red", video=None, unique_id=None):
        source = _select_media_tensor(image, video)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = _alpha_mask_from_image(source)
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_channel")

        extracted = _extract_channel_mask(source, channel)
        result = _channel_mask_to_image(extracted, source)
        progress.finish()
        return build_node_preview_result(result, (result, extracted), prefix="imageops_channel")
