from __future__ import annotations

import torch

from ._helpers import _hex_to_rgb01, _scalar
from ._preview import build_node_preview_result
from ._progress import start_progress

_MODES = ["constant", "checkerboard"]


def _constant_image(batch: int, height: int, width: int, color: str, alpha: float) -> torch.Tensor:
    rgb = torch.tensor(_hex_to_rgb01(color), dtype=torch.float32).view(1, 1, 1, 3)
    image = rgb.expand(batch, height, width, 3).clone()
    a = torch.full((batch, height, width, 1), float(alpha), dtype=torch.float32)
    return torch.cat([image, a], dim=-1).clamp(0.0, 1.0)


def _checkerboard_image(
    batch: int,
    height: int,
    width: int,
    color_a: str,
    color_b: str,
    alpha: float,
    tile_size: int,
    offset_x: int,
    offset_y: int,
) -> torch.Tensor:
    tile = max(1, int(tile_size))
    yy = (torch.arange(height, dtype=torch.int64).view(height, 1) + int(offset_y)) // tile
    xx = (torch.arange(width, dtype=torch.int64).view(1, width) + int(offset_x)) // tile
    pattern = torch.remainder(xx + yy, 2).to(torch.float32).view(1, height, width, 1)
    rgb_a = torch.tensor(_hex_to_rgb01(color_a), dtype=torch.float32).view(1, 1, 1, 3)
    rgb_b = torch.tensor(_hex_to_rgb01(color_b), dtype=torch.float32).view(1, 1, 1, 3)
    rgb = rgb_a * (1.0 - pattern) + rgb_b * pattern
    rgb = rgb.expand(batch, height, width, 3).clone()
    a = torch.full((batch, height, width, 1), float(alpha), dtype=torch.float32)
    return torch.cat([rgb, a], dim=-1).clamp(0.0, 1.0)


class ImageOpsConstant:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
    RETURN_NAMES = ("image", "mask", "width", "height")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "mode": (_MODES, {"default": "constant"}),
                "width": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096, "step": 1}),
                "color": ("COLOR", {"default": "#ffffff"}),
                "color_b": ("COLOR", {"default": "#000000"}),
                "alpha": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01}),
                "tile_size": ("INT", {"default": 64, "min": 1, "max": 2048, "step": 1}),
                "offset_x": ("INT", {"default": 0, "min": -8192, "max": 8192, "step": 1}),
                "offset_y": ("INT", {"default": 0, "min": -8192, "max": 8192, "step": 1}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def generate(
        self,
        mode="constant",
        width=1024,
        height=1024,
        batch_size=1,
        color="#ffffff",
        color_b="#000000",
        alpha=1.0,
        tile_size=64,
        offset_x=0,
        offset_y=0,
        unique_id=None,
    ):
        progress = start_progress(unique_id=unique_id)
        out_w = max(1, _scalar(width, int))
        out_h = max(1, _scalar(height, int))
        batch = max(1, _scalar(batch_size, int))
        opacity = max(0.0, min(1.0, _scalar(alpha)))
        normalized_mode = str(mode or "constant").strip().lower().replace("-", "_").replace(" ", "_")

        if normalized_mode == "checkerboard":
            image = _checkerboard_image(
                batch,
                out_h,
                out_w,
                color,
                color_b,
                opacity,
                _scalar(tile_size, int),
                _scalar(offset_x, int),
                _scalar(offset_y, int),
            )
        else:
            image = _constant_image(batch, out_h, out_w, color, opacity)

        mask = image[..., 3].clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(image, (image, mask, out_w, out_h), prefix="imageops_constant")
