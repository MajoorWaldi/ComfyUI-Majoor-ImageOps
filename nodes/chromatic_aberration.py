from __future__ import annotations

import math

import torch
import torch.nn.functional as F

from ._helpers import (
    EPSILON,
    _apply_mask_to_image,
    _param_tensor,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress
from ._helpers import apply_per_frame_bypass


def _radial_sample(channel: torch.Tensor, grid_x_px: torch.Tensor, grid_y_px: torch.Tensor, cx_px: torch.Tensor, cy_px: torch.Tensor, k: torch.Tensor, w: int, h: int) -> torch.Tensor:
    factor = 1.0 + k
    sx = (grid_x_px - cx_px) * factor + cx_px
    sy = (grid_y_px - cy_px) * factor + cy_px
    gx = sx / max(w - 1, 1) * 2.0 - 1.0
    gy = sy / max(h - 1, 1) * 2.0 - 1.0
    grid = torch.stack([gx, gy], dim=-1)
    return F.grid_sample(channel.unsqueeze(1), grid, mode="bilinear", padding_mode="border", align_corners=True).squeeze(1)


def _apply_chromatic_aberration(source: torch.Tensor, amount, center_x, center_y) -> torch.Tensor:
    x = source.float()
    b, h, w, c = x.shape
    device, dtype = x.device, x.dtype

    amount_t = _param_tensor(amount, b, device, dtype).view(b, 1, 1)
    cx_t = _param_tensor(center_x, b, device, dtype).view(b, 1, 1) * float(max(0, w - 1))
    cy_t = _param_tensor(center_y, b, device, dtype).view(b, 1, 1) * float(max(0, h - 1))

    half_diag = math.sqrt((w / 2.0) ** 2 + (h / 2.0) ** 2)
    k = amount_t / max(half_diag, EPSILON)

    ys_px, xs_px = torch.meshgrid(
        torch.arange(h, device=device, dtype=dtype),
        torch.arange(w, device=device, dtype=dtype),
        indexing="ij",
    )
    xs_px = xs_px.unsqueeze(0).expand(b, -1, -1)
    ys_px = ys_px.unsqueeze(0).expand(b, -1, -1)

    rgb = x[..., :3]
    r = _radial_sample(rgb[..., 0], xs_px, ys_px, cx_t, cy_t, k, w, h)
    g = rgb[..., 1]
    bl = _radial_sample(rgb[..., 2], xs_px, ys_px, cx_t, cy_t, -k, w, h)
    out_rgb = torch.stack([r, g, bl], dim=-1)
    if c > 3:
        return torch.cat([out_rgb, x[..., 3:].clamp(0.0, 1.0)], dim=-1)
    return out_rgb


class ImageOpsChromaticAberration(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsChromaticAberration",
            display_name="〽️ Image Ops Chromatic Aberration",
            category="image/imageops", essentials_category="Image Tools",
            search_aliases=["chromatic aberration", "fringe", "fringing", "lens", "color fringe", "ca"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("amount", default=2.0, min=-30.0, max=30.0, step=0.1, display_mode=io.NumberDisplay("slider"), round=0.01, tooltip="Radial channel shift in pixels at the frame corner. Positive shifts red outward and blue inward."),
                io.Float.Input("center_x", default=0.5, min=-1.0, max=2.0, step=0.01, round=0.001),
                io.Float.Input("center_y", default=0.5, min=-1.0, max=2.0, step=0.01, round=0.001),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], tooltip="Images/Video input.", display_name="Images/Video", optional=True, extra_dict={"forceInput": True}),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Mask.Output("mask", display_name="mask"),
            ],
        )

    @classmethod
    def execute(
        cls,
        image=None,
        bypass=False,
        amount=2.0,
        center_x=0.5,
        center_y=0.5,
        invert_mask=False,
        video=None,
        mask=None,
        **kwargs,
    ):
        source = _select_media_tensor(image, video, working_set=5)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress()
        if isinstance(bypass, bool) and bypass:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_chromatic_aberration")
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_chromatic_aberration")
        if _scalar(amount) == 0.0 and not isinstance(amount, (list, tuple)):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_chromatic_aberration")

        result = _apply_chromatic_aberration(source, amount, center_x, center_y)
        result = _apply_mask_to_image(source, result, effect_mask) if effect_mask is not None else result
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_chromatic_aberration")
