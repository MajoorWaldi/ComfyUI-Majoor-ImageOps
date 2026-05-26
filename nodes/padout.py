import torch

from ._helpers import ASPECT_RATIO_PRESETS, MEDIA_INPUT_TYPE, _scalar, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress

_PADOUT_TARGET_FORMATS = list(ASPECT_RATIO_PRESETS.keys())
_TARGET_RATIOS = {
    "1:1": (1, 1),
    "square": (1, 1),
    "nearest_square": (1, 1),
    "16:9": (16, 9),
    "9:16": (9, 16),
    "4:3": (4, 3),
    "3:4": (3, 4),
}


def _build_padout_mask(
    batch: int,
    height: int,
    width: int,
    top: int,
    left: int,
    source_h: int,
    source_w: int,
    device,
    dtype,
) -> torch.Tensor:
    mask = torch.ones((batch, height, width), device=device, dtype=dtype)
    mask[:, top:top + source_h, left:left + source_w] = 0.0
    return mask


def _snap_nonnegative(value: int, grid: int) -> int:
    if grid <= 1:
        return max(0, int(value))
    return max(0, int(round(int(value) / grid) * grid))


def _make_constant_pad(source: torch.Tensor, out_h: int, out_w: int) -> torch.Tensor:
    batch, _, _, channels = source.shape
    out = torch.zeros((batch, out_h, out_w, channels), device=source.device, dtype=source.dtype)
    if channels >= 4:
        out[..., 3] = 1.0
    return out


class ImageOpsPadOut:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "pad_left": ("INT", {"default": 128, "min": 0, "max": 4096, "step": 1}),
                "pad_top": ("INT", {"default": 128, "min": 0, "max": 4096, "step": 1}),
                "pad_right": ("INT", {"default": 128, "min": 0, "max": 4096, "step": 1}),
                "pad_bottom": ("INT", {"default": 128, "min": 0, "max": 4096, "step": 1}),
                "aspect_ratio": (_PADOUT_TARGET_FORMATS, {"default": "custom", "tooltip": "Interactive preview ratio preset. The UI turns this into explicit padding; backend output uses the pad values as-is."}),
                "snap_to_multiple": ("INT", {"default": 1, "min": 1, "max": 256, "step": 1, "tooltip": "Quantize padding to this multiple. Use 16 for Wan/VACE-friendly output sizes."}),
                "invert_mask": ("BOOLEAN", {"default": False, "tooltip": "By default the output mask marks the *padded* area as 1 and the original source as 0. Toggle to invert (source=1, padding=0)."}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        image=None,
        bypass=False,
        pad_left=128,
        pad_top=128,
        pad_right=128,
        pad_bottom=128,
        aspect_ratio="custom",
        snap_to_multiple=1,
        invert_mask=False,
        video=None,
        unique_id=None,
        **_unused,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        progress = start_progress(unique_id=unique_id)

        batch = int(source.shape[0])
        source_h = int(source.shape[1])
        source_w = int(source.shape[2])

        if _scalar(bypass, bool):
            mask = torch.zeros((batch, source_h, source_w), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
            progress.finish()
            meta = {"imageops_padout_source": {"source_w": source_w, "source_h": source_h, "pad_left": 0, "pad_top": 0, "pad_right": 0, "pad_bottom": 0, "output_w": source_w, "output_h": source_h}}
            return build_node_preview_result(source, (source, mask, source_w, source_h), prefix="imageops_padout", metadata=meta)

        snap = max(1, _scalar(snap_to_multiple, int))
        left = _snap_nonnegative(_scalar(pad_left, int), snap)
        top = _snap_nonnegative(_scalar(pad_top, int), snap)
        right = _snap_nonnegative(_scalar(pad_right, int), snap)
        bottom = _snap_nonnegative(_scalar(pad_bottom, int), snap)

        out_w = source_w + left + right
        out_h = source_h + top + bottom

        out = _make_constant_pad(source, out_h, out_w)

        out[:, top:top + source_h, left:left + source_w, :] = source

        stitch_mask = _build_padout_mask(
            batch=batch,
            height=out_h,
            width=out_w,
            top=top,
            left=left,
            source_h=source_h,
            source_w=source_w,
            device=source.device,
            dtype=source.dtype,
        ).clamp(0.0, 1.0)

        mask = stitch_mask
        if _scalar(invert_mask, bool):
            mask = 1.0 - mask

        progress.finish()
        meta = {"imageops_padout_source": {"source_w": source_w, "source_h": source_h, "pad_left": left, "pad_top": top, "pad_right": right, "pad_bottom": bottom, "output_w": out_w, "output_h": out_h, "snap_to_multiple": snap}}
        return build_node_preview_result(out, (out, mask.clamp(0.0, 1.0), out_w, out_h), prefix="imageops_padout", metadata=meta)
