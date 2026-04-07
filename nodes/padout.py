import torch

from ._helpers import MEDIA_INPUT_TYPE, _hex_to_rgb01, _scalar, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress


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


class ImageOpsPadOut:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
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
                "fill_color": ("STRING", {"default": "#000000"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
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
        fill_color="#000000",
        invert_mask=False,
        video=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        progress = start_progress(unique_id=unique_id)

        batch = int(source.shape[0])
        source_h = int(source.shape[1])
        source_w = int(source.shape[2])
        channels = int(source.shape[3])

        if _scalar(bypass, bool):
            mask = torch.zeros((batch, source_h, source_w), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
            progress.finish()
            return build_node_preview_result(source, (source, mask), prefix="imageops_padout")

        left = max(0, _scalar(pad_left, int))
        top = max(0, _scalar(pad_top, int))
        right = max(0, _scalar(pad_right, int))
        bottom = max(0, _scalar(pad_bottom, int))

        out_w = source_w + left + right
        out_h = source_h + top + bottom

        out = torch.zeros((batch, out_h, out_w, channels), device=source.device, dtype=source.dtype)
        r, g, b = _hex_to_rgb01(fill_color)
        if channels >= 1:
            out[..., 0] = r
        if channels >= 2:
            out[..., 1] = g
        if channels >= 3:
            out[..., 2] = b
        if channels >= 4:
            out[..., 3] = 1.0

        out[:, top:top + source_h, left:left + source_w, :] = source

        mask = _build_padout_mask(
            batch=batch,
            height=out_h,
            width=out_w,
            top=top,
            left=left,
            source_h=source_h,
            source_w=source_w,
            device=source.device,
            dtype=source.dtype,
        )

        if _scalar(invert_mask, bool):
            mask = 1.0 - mask

        progress.finish()
        return build_node_preview_result(out, (out, mask.clamp(0.0, 1.0)), prefix="imageops_padout")