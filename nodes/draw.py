from __future__ import annotations

import base64
import io

import numpy as np
import torch
from PIL import Image

from ._helpers import MEDIA_INPUT_TYPE, _expand_image_batch, _hex_to_rgb01, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result


def _blank_draw_base(width: int, height: int, bg_color: str) -> torch.Tensor:
    target_w = max(1, _scalar(width, int))
    target_h = max(1, _scalar(height, int))
    r, g, b = _hex_to_rgb01(bg_color)
    base = torch.zeros((1, target_h, target_w, 3), dtype=torch.float32)
    base[..., 0] = r
    base[..., 1] = g
    base[..., 2] = b
    return base


def _decode_overlay_rgba(
    overlay_data: str | None,
    width: int,
    height: int,
    batch: int,
    device,
    dtype,
) -> torch.Tensor:
    target_w = max(1, _scalar(width, int))
    target_h = max(1, _scalar(height, int))
    safe_batch = max(1, _scalar(batch, int))
    blank = torch.zeros((1, target_h, target_w, 4), device=device, dtype=dtype)

    raw = str(overlay_data or "").strip()
    if not raw:
        return blank.expand(safe_batch, -1, -1, -1)

    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")
    if not raw:
        return blank.expand(safe_batch, -1, -1, -1)

    try:
        decoded = base64.b64decode(raw)
        with Image.open(io.BytesIO(decoded)) as painter:
            overlay = painter.convert("RGBA")
            if overlay.size != (target_w, target_h):
                overlay = overlay.resize((target_w, target_h), Image.LANCZOS)
            array = np.asarray(overlay).astype(np.float32) / 255.0
    except Exception:
        return blank.expand(safe_batch, -1, -1, -1)

    tensor = torch.from_numpy(array).to(device=device, dtype=dtype).unsqueeze(0)
    return tensor.expand(safe_batch, -1, -1, -1)


def _composite_overlay(base: torch.Tensor, overlay_rgba: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    if base.dim() != 4:
        raise ValueError(f"Expected base image as [B,H,W,C], got {tuple(base.shape)}")
    if overlay_rgba.dim() != 4 or overlay_rgba.shape[-1] < 4:
        raise ValueError(f"Expected overlay image as [B,H,W,4], got {tuple(overlay_rgba.shape)}")

    base = base.float().clamp(0.0, 1.0)
    overlay_rgba = overlay_rgba.float().clamp(0.0, 1.0)

    if base.shape[0] != overlay_rgba.shape[0]:
        overlay_rgba = _expand_image_batch(overlay_rgba, base.shape[0])

    overlay_rgb = overlay_rgba[..., :3]
    overlay_alpha = overlay_rgba[..., 3:4]
    base_rgb = base[..., :3]
    out_rgb = overlay_rgb * overlay_alpha + base_rgb * (1.0 - overlay_alpha)

    if base.shape[-1] >= 4:
        base_alpha = base[..., 3:4].clamp(0.0, 1.0)
        out_alpha = overlay_alpha + base_alpha * (1.0 - overlay_alpha)
        result = torch.cat([out_rgb, out_alpha], dim=-1)
    else:
        result = out_rgb

    return result.clamp(0.0, 1.0), overlay_alpha[..., 0].clamp(0.0, 1.0)


class ImageOpsDraw:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("image", "source_image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 64}),
                "sync_dimensions": ("BOOLEAN", {"default": True, "label_on": "Linked", "label_off": "Free"}),
                "bg_color": ("STRING", {"default": "#000000"}),
                "tool": (["brush", "eraser"], {"default": "brush"}),
                "brush_edge": (["hard", "soft"], {"default": "hard"}),
                "brush_color": ("STRING", {"default": "#FFFFFF"}),
                "brush_opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "brush_size": ("INT", {"default": 10, "min": 1, "max": 256, "step": 1, "display": "slider"}),
                "overlay_data": ("STRING", {"default": "", "multiline": False}),
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
        width=1024,
        height=1024,
        sync_dimensions=True,
        bg_color="#000000",
        tool="brush",
        brush_edge="hard",
        brush_color="#FFFFFF",
        brush_opacity=1.0,
        brush_size=10,
        overlay_data="",
        invert_mask=False,
        video=None,
        unique_id=None,
    ):
        del sync_dimensions, tool, brush_edge, brush_color, brush_opacity, brush_size
        progress = start_progress(unique_id=unique_id)

        source = None
        if image is not None or video is not None:
            source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        else:
            source = _blank_draw_base(width, height, bg_color)

        batch = int(source.shape[0])
        target_h = int(source.shape[1])
        target_w = int(source.shape[2])
        overlay = _decode_overlay_rgba(
            overlay_data,
            target_w,
            target_h,
            batch=batch,
            device=source.device,
            dtype=source.dtype,
        )

        if _scalar(bypass, bool):
            mask = torch.zeros((batch, target_h, target_w), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
            progress.finish()
            return build_node_preview_result(source, (source, source, mask), prefix="imageops_draw")

        result, mask = _composite_overlay(source, overlay)
        if _scalar(invert_mask, bool):
            mask = 1.0 - mask
        progress.finish()
        return build_node_preview_result(result, (result, source, mask.clamp(0.0, 1.0)), prefix="imageops_draw")
