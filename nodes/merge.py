from ._helpers import MEDIA_INPUT_TYPE, _apply_merge, _apply_mask_to_image, _coerce_media_to_tensor, _prepare_effect_mask, _resolve_mask_output_source, _scalar
from ._progress import start_progress
from ._preview import build_node_preview_result


def _all_zero_mix(mix) -> bool:
    if isinstance(mix, (list, tuple)):
        if len(mix) == 0:
            return True
        return all(_scalar(mix, index=i) <= 0.0 for i in range(len(mix)))
    return _scalar(mix) <= 0.0


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
                "mode": ([
                    "over",
                    "add",
                    "subtract",
                    "multiply",
                    "screen",
                    "overlay",
                    "soft_light",
                    "difference",
                    "max",
                    "min",
                    "lighten",
                    "darken",
                    "color_dodge",
                    "color_burn",
                    "exclusion",
                    "vivid_light",
                    "pin_light",
                    "hard_mix",
                ], {"default": "over"}),
                "mix": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "round": 0.001}),
                "foreground_fit": (["stretch", "contain", "cover", "none"], {"default": "stretch"}),
                "blend_space": (["linear", "srgb"], {"default": "linear"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "mask": ("MASK", {"tooltip": "Optional mask applied to the merged result", "display_name": "Mask"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, A, B, bypass=False, mode="over", mix=1.0, foreground_fit="stretch", blend_space="linear", invert_mask=False, mask=None, unique_id=None):
        A = _coerce_media_to_tensor(A, "A")
        effect_mask = _prepare_effect_mask(mask, A, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, A, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = effect_mask if effect_mask is not None else output_mask_source
            progress.finish()
            return build_node_preview_result(A, (A, output_mask), prefix="imageops_merge")
        if _all_zero_mix(mix):
            output_mask = effect_mask if effect_mask is not None else output_mask_source
            progress.finish()
            return build_node_preview_result(A, (A, output_mask), prefix="imageops_merge")
        B = _coerce_media_to_tensor(B, "B")
        out = _apply_merge(A, B, mode, mix, foreground_fit, blend_space)
        out = _apply_mask_to_image(A, out, effect_mask)
        output_mask = effect_mask if effect_mask is not None else output_mask_source
        progress.finish()
        return build_node_preview_result(out, (out, output_mask), prefix="imageops_merge")
