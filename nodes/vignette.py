from __future__ import annotations

import torch

from ._helpers import (
    _apply_mask_to_image,
    _hex_to_rgb01,
    _param_tensor,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress
from .core.video_io import extract_video_fps_audio, media_to_video
from ._helpers import apply_per_frame_bypass


def _apply_vignette(
    source: torch.Tensor,
    amount,
    size,
    softness,
    center_x,
    center_y,
    color: str,
) -> torch.Tensor:
    x = source.float()
    b, h, w, c = x.shape
    device, dtype = x.device, x.dtype

    amount_t = _param_tensor(amount, b, device, dtype).clamp(0.0, 1.0)
    size_t = _param_tensor(size, b, device, dtype)
    softness_t = _param_tensor(softness, b, device, dtype).clamp(min=1e-4)
    cx_t = _param_tensor(center_x, b, device, dtype)
    cy_t = _param_tensor(center_y, b, device, dtype)

    aspect = float(w) / float(max(1, h))
    ys, xs = torch.meshgrid(
        torch.linspace(0.0, 1.0, h, device=device, dtype=dtype),
        torch.linspace(0.0, 1.0, w, device=device, dtype=dtype),
        indexing="ij",
    )
    ys = ys.unsqueeze(0)
    xs = xs.unsqueeze(0)
    if aspect >= 1.0:
        dx = (xs - cx_t.view(b, 1, 1)) * aspect
        dy = ys - cy_t.view(b, 1, 1)
    else:
        dx = xs - cx_t.view(b, 1, 1)
        dy = (ys - cy_t.view(b, 1, 1)) / max(aspect, 1e-6)
    dist = torch.sqrt(dx * dx + dy * dy).unsqueeze(-1)

    inner = (size_t - softness_t).clamp(min=0.0)
    outer = size_t.clamp(min=inner + 1e-4)
    t = ((dist - inner) / (outer - inner).view(b, 1, 1, 1)).clamp(0.0, 1.0)
    t = t * t * (3.0 - 2.0 * t)
    falloff = t * amount_t.view(b, 1, 1, 1)

    rgb = x[..., :3]
    tint = torch.tensor(_hex_to_rgb01(color), device=device, dtype=dtype).view(1, 1, 1, 3)
    out_rgb = rgb * (1.0 - falloff) + tint * falloff
    if c > 3:
        return torch.cat([out_rgb, x[..., 3:].clamp(0.0, 1.0)], dim=-1)
    return out_rgb


class ImageOpsVignette(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsVignette",
            display_name="〽️ Image Ops Vignette",
            category="image/imageops", essentials_category="Image Tools",
            search_aliases=["vignette", "lens", "darken edges", "falloff"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("amount", default=0.5, min=0.0, max=1.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001),
                io.Float.Input("size", default=1.0, min=0.0, max=2.0, step=0.01, round=0.001, tooltip="Radius (in normalized frame units) where the vignette reaches full amount."),
                io.Float.Input("softness", default=0.6, min=0.01, max=2.0, step=0.01, round=0.001, tooltip="Falloff width. Larger values feather the edge further inward from size."),
                io.Float.Input("center_x", default=0.5, min=-1.0, max=2.0, step=0.01, round=0.001),
                io.Float.Input("center_y", default=0.5, min=-1.0, max=2.0, step=0.01, round=0.001),
                io.Color.Input("color", default="#000000", tooltip="Color the vignette darkens toward."),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], tooltip="Images/Video input.", display_name="Images/Video", optional=True, extra_dict={"forceInput": True}),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Mask.Output("mask", display_name="mask"),
                io.Video.Output("video", display_name="video", tooltip="Native VIDEO output. Carries the real audio/fps when a VIDEO (not a plain IMAGE batch) was connected."),
            ],
        )

    @classmethod
    def execute(
        cls,
        image=None,
        bypass=False,
        amount=0.5,
        size=1.0,
        softness=0.6,
        center_x=0.5,
        center_y=0.5,
        color="#000000",
        invert_mask=False,
        video=None,
        mask=None,
        **kwargs,
    ):
        source = _select_media_tensor(image, video, working_set=3)
        fps, audio, sample_rate = extract_video_fps_audio(image)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress()
        if isinstance(bypass, bool) and bypass:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_vignette")
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_vignette")
        if float(max(0.0, _scalar(amount))) <= 0.0:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_vignette")

        result = _apply_vignette(source, amount, size, softness, center_x, center_y, _scalar(color, str))
        result = _apply_mask_to_image(source, result, effect_mask) if effect_mask is not None else result
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask, media_to_video(result, fps, audio, sample_rate)), prefix="imageops_vignette")
