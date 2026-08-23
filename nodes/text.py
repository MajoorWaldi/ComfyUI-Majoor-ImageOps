from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont

from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_mask_to_image,
    _hex_to_rgb01,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress

_ALIGN = ["left", "center", "right"]


def _load_font(font_path: str, size: int):
    target_size = max(1, int(size))
    path = str(font_path or "").strip()
    candidates = [path] if path else []
    candidates += ["arial.ttf", "DejaVuSans.ttf"]
    for candidate in candidates:
        try:
            if candidate and (os.path.isfile(candidate) or candidate.endswith(".ttf")):
                return ImageFont.truetype(candidate, target_size)
        except Exception:
            continue
    return ImageFont.load_default()


def _rgba_tuple(color: str, opacity: float) -> tuple[int, int, int, int]:
    r, g, b = _hex_to_rgb01(color)
    a = max(0, min(255, int(round(float(opacity) * 255.0))))
    return (int(round(r * 255)), int(round(g * 255)), int(round(b * 255)), a)


def _tensor_to_pil_rgba(frame: torch.Tensor) -> Image.Image:
    arr = (frame.detach().cpu().float().clamp(0.0, 1.0).numpy() * 255.0 + 0.5).astype(np.uint8)
    if arr.shape[-1] >= 4:
        return Image.fromarray(arr[..., :4], mode="RGBA")
    return Image.fromarray(arr[..., :3], mode="RGB").convert("RGBA")


def _pil_rgba_to_tensor(image: Image.Image, device, dtype) -> torch.Tensor:
    arr = np.asarray(image.convert("RGBA")).astype(np.float32) / 255.0
    return torch.from_numpy(arr).to(device=device, dtype=dtype)


def _draw_text_overlay(
    source: torch.Tensor,
    text: str,
    x: float,
    y: float,
    font_size: int,
    color: str,
    opacity: float,
    align: str,
    line_spacing: int,
    stroke_width: int,
    stroke_color: str,
    font_path: str,
) -> torch.Tensor:
    if not str(text or ""):
        return source
    device = source.device
    dtype = source.dtype
    out = []
    font = _load_font(font_path, font_size)
    fill = _rgba_tuple(color, opacity)
    stroke_fill = _rgba_tuple(stroke_color, opacity)
    normalized_align = str(align or "left").strip().lower()
    if normalized_align not in _ALIGN:
        normalized_align = "left"

    for frame in source:
        # frame is [H, W, C]
        height, width = int(frame.shape[0]), int(frame.shape[1])
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        px = float(x) * max(1, width - 1)
        py = float(y) * max(1, height - 1)
        lines = str(text).splitlines() or [str(text)]
        try:
            bbox = draw.multiline_textbbox(
                (0, 0),
                "\n".join(lines),
                font=font,
                spacing=int(line_spacing),
                stroke_width=max(0, int(stroke_width)),
            )
            text_w = bbox[2] - bbox[0]
        except Exception:
            text_w = 0
        if normalized_align == "center":
            px -= text_w / 2.0
        elif normalized_align == "right":
            px -= text_w
        draw.multiline_text(
            (px, py),
            "\n".join(lines),
            font=font,
            fill=fill,
            spacing=int(line_spacing),
            align=normalized_align,
            stroke_width=max(0, int(stroke_width)),
            stroke_fill=stroke_fill,
        )
        overlay_t = _pil_rgba_to_tensor(overlay, device, dtype)
        alpha = overlay_t[..., 3:4]
        rgb = frame[..., :3]
        extra = frame[..., 3:] if frame.shape[-1] > 3 else torch.ones_like(frame[..., 0:1])
        out_rgb = rgb * (1.0 - alpha) + overlay_t[..., :3] * alpha
        out_alpha = (extra + alpha - extra * alpha).clamp(0.0, 1.0)
        out.append(torch.cat([out_rgb, out_alpha], dim=-1).unsqueeze(0))
    return torch.cat(out, dim=0)


class ImageOpsText(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsText",
            display_name="〽️ ImageOps Text",
            category="image/imageops",
            search_aliases=['text', 'title', 'caption', 'label', 'type', 'font'], inputs=[
                io.Boolean.Input("bypass", default=False),
                io.String.Input("text", default="ImageOps Text", multiline=True),
                io.Float.Input("x", default=0.5, min=-2.0, max=3.0, step=0.001),
                io.Float.Input("y", default=0.5, min=-2.0, max=3.0, step=0.001),
                io.Int.Input("font_size", default=64, min=1, max=512, step=1),
                io.Color.Input("color", default="#ffffff"),
                io.Float.Input("opacity", default=1.0, min=0.0, max=1.0, step=0.01),
                io.Combo.Input("align", options=_ALIGN, default="center"),
                io.Int.Input("line_spacing", default=4, min=0, max=256, step=1),
                io.Int.Input("stroke_width", default=0, min=0, max=64, step=1),
                io.Color.Input("stroke_color", default="#000000"),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], optional=True, display_name="Images/Video", tooltip="Images/Video input."),
                io.Mask.Input("mask", optional=True),
                io.String.Input("font_path", default="", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Mask.Output("mask", display_name="mask"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        bypass: bool = False,
        text: str = "ImageOps Text",
        x: float = 0.5,
        y: float = 0.5,
        font_size: int = 64,
        color: str = "#ffffff",
        opacity: float = 1.0,
        align: str = "center",
        line_spacing: int = 4,
        stroke_width: int = 0,
        stroke_color: str = "#000000",
        invert_mask: bool = False,
        image=None,
        video=None,
        mask=None,
        font_path: str = "",
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float()
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool) or not str(text or "") or float(_scalar(opacity)) <= 0.0:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_text")
        processed = _draw_text_overlay(
            source,
            str(text),
            _scalar(x),
            _scalar(y),
            _scalar(font_size, int),
            color,
            max(0.0, min(1.0, _scalar(opacity))),
            align,
            _scalar(line_spacing, int),
            _scalar(stroke_width, int),
            stroke_color,
            str(font_path or ""),
        )
        result = _apply_mask_to_image(source, processed, effect_mask) if effect_mask is not None else processed
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_text")
