from ._helpers import MEDIA_INPUT_TYPE, _alpha_mask_from_image, _apply_merge, _apply_mask_to_image, _coerce_media_to_tensor, _prepare_effect_mask, _scalar
from ._progress import start_progress
from ._preview import build_node_preview_result

class ImageOpsMerge:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "A": (MEDIA_INPUT_TYPE, {"tooltip": "Background Images/Video input.", "display_name": "Background"}),
                "B": (MEDIA_INPUT_TYPE, {"tooltip": "Foreground Images/Video input.", "display_name": "Foreground"}),
                "bypass": ("BOOLEAN", {"default": False}),
                "mode": (["over", "add", "subtract", "multiply", "screen", "difference", "max", "min"], {"default": "over"}),
                "mix": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask applied to the merged result", "display_name": "Mask"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, A, B, bypass=False, mode="over", mix=1.0, invert_mask=False, mask=None, unique_id=None):
        A = _coerce_media_to_tensor(A, "A")
        B = _coerce_media_to_tensor(B, "B")
        effect_mask = _prepare_effect_mask(mask, A, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = effect_mask if effect_mask is not None else _alpha_mask_from_image(A)
            if effect_mask is None and _scalar(invert_mask, bool):
                output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
            progress.finish()
            return build_node_preview_result(A, (A, output_mask), prefix="imageops_merge")
        out = _apply_merge(A, B, mode, mix)
        out = _apply_mask_to_image(A, out, effect_mask)
        output_mask = effect_mask if effect_mask is not None else _alpha_mask_from_image(out)
        if effect_mask is None and _scalar(invert_mask, bool):
            output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(out, (out, output_mask), prefix="imageops_merge")
