from __future__ import annotations

import torch

from ._helpers import _hex_to_rgb01, _scalar
from ._preview import build_node_preview_result
from ._progress import start_progress

_RAMP_MODES = ["linear", "ease_in", "ease_out", "smoothstep"]
_RAMP_SHAPES = ["linear", "radial"]


def _apply_ramp_curve(t: torch.Tensor, mode: str) -> torch.Tensor:
    normalized = str(mode or "linear").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized == "ease_in":
        return t * t
    if normalized == "ease_out":
        return 1.0 - (1.0 - t) * (1.0 - t)
    if normalized == "smoothstep":
        return t * t * (3.0 - 2.0 * t)
    return t


def _ramp_image(
    batch: int,
    height: int,
    width: int,
    color_a: str,
    color_b: str,
    alpha: float,
    start_x: float,
    start_y: float,
    end_x: float,
    end_y: float,
    ramp_shape: str,
    ramp_mode: str,
    invert: bool,
) -> torch.Tensor:
    xs = torch.linspace(0.0, 1.0, max(1, width), dtype=torch.float32).view(1, width)
    ys = torch.linspace(0.0, 1.0, max(1, height), dtype=torch.float32).view(height, 1)
    dx = float(end_x) - float(start_x)
    dy = float(end_y) - float(start_y)
    denom = dx * dx + dy * dy
    shape = str(ramp_shape or "linear").strip().lower().replace("-", "_").replace(" ", "_")
    if denom <= 1.0e-12:
        t = torch.zeros((height, width), dtype=torch.float32)
    elif shape == "radial":
        radius = denom ** 0.5
        t = torch.sqrt((xs - float(start_x)) ** 2 + (ys - float(start_y)) ** 2) / radius
        t = t.clamp(0.0, 1.0)
    else:
        t = ((xs - float(start_x)) * dx + (ys - float(start_y)) * dy) / denom
        t = t.clamp(0.0, 1.0)
    if invert:
        t = 1.0 - t
    t = _apply_ramp_curve(t, ramp_mode).view(1, height, width, 1).clamp(0.0, 1.0)
    rgb_a = torch.tensor(_hex_to_rgb01(color_a), dtype=torch.float32).view(1, 1, 1, 3)
    rgb_b = torch.tensor(_hex_to_rgb01(color_b), dtype=torch.float32).view(1, 1, 1, 3)
    rgb = (rgb_a * (1.0 - t) + rgb_b * t).expand(batch, height, width, 3).clone()
    a = torch.full((batch, height, width, 1), float(alpha), dtype=torch.float32)
    return torch.cat([rgb, a], dim=-1).clamp(0.0, 1.0)


class ImageOpsRamp:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096, "step": 1}),
                "color_a": ("COLOR", {"default": "#ffffff"}),
                "color_b": ("COLOR", {"default": "#000000"}),
                "alpha": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "start_x": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 3.0, "step": 0.001}),
                "start_y": ("FLOAT", {"default": 0.5, "min": -2.0, "max": 3.0, "step": 0.001}),
                "end_x": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 3.0, "step": 0.001}),
                "end_y": ("FLOAT", {"default": 0.5, "min": -2.0, "max": 3.0, "step": 0.001}),
                "ramp_shape": (_RAMP_SHAPES, {"default": "linear"}),
                "ramp_mode": (_RAMP_MODES, {"default": "linear"}),
                "invert": ("BOOLEAN", {"default": False}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def generate(
        self,
        width=1024,
        height=1024,
        batch_size=1,
        color_a="#ffffff",
        color_b="#000000",
        alpha=1.0,
        start_x=0.0,
        start_y=0.5,
        end_x=1.0,
        end_y=0.5,
        ramp_shape="linear",
        ramp_mode="linear",
        invert=False,
        unique_id=None,
    ):
        progress = start_progress(unique_id=unique_id)
        out_w = max(1, _scalar(width, int))
        out_h = max(1, _scalar(height, int))
        batch = max(1, _scalar(batch_size, int))
        opacity = max(0.0, min(1.0, _scalar(alpha)))
        image = _ramp_image(
            batch,
            out_h,
            out_w,
            color_a,
            color_b,
            opacity,
            _scalar(start_x),
            _scalar(start_y),
            _scalar(end_x),
            _scalar(end_y),
            ramp_shape,
            ramp_mode,
            _scalar(invert, bool),
        )
        mask = image[..., 3].clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(image, (image, mask, out_w, out_h), prefix="imageops_ramp")
