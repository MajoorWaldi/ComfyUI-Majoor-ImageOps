from __future__ import annotations

import torch

from ._helpers import (
    _apply_blur,
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
from .core.memory import check_budget
from .core.video_io import extract_video_fps_audio, media_to_video
from ._helpers import apply_per_frame_bypass


def _apply_bloom(source: torch.Tensor, threshold, intensity, radius: int) -> torch.Tensor:
    x = source.float()
    b = x.shape[0]
    device, dtype = x.device, x.dtype
    rgb = x[..., :3]

    threshold_t = _param_tensor(threshold, b, device, dtype)
    intensity_t = _param_tensor(intensity, b, device, dtype)

    bright = (rgb - threshold_t).clamp(min=0.0)
    if radius > 0:
        bright = _apply_blur(bright, radius, 0.0)
    # Additive, not screen: highlights can already exceed 1.0 on HDR sources and
    # a screen blend's (1 - x) term breaks down past that range.
    out_rgb = rgb + bright * intensity_t
    if x.shape[-1] > 3:
        return torch.cat([out_rgb, x[..., 3:].clamp(0.0, 1.0)], dim=-1)
    return out_rgb


class ImageOpsBloom(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsBloom",
            display_name="〽️ Image Ops Bloom",
            category="image/imageops", essentials_category="Image Tools",
            search_aliases=["bloom", "glow", "highlight glow", "lens"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("threshold", default=0.8, min=0.0, max=4.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001, tooltip="Brightness level above which pixels start to glow."),
                io.Float.Input("intensity", default=0.5, min=0.0, max=4.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001, tooltip="Strength of the added glow."),
                io.Int.Input("radius", default=12, min=0, max=128, step=1, tooltip="Gaussian blur radius of the glow, in pixels."),
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
        threshold=0.8,
        intensity=0.5,
        radius=12,
        invert_mask=False,
        video=None,
        mask=None,
        **kwargs,
    ):
        source = _select_media_tensor(image, video, working_set=6)
        fps, audio, sample_rate = extract_video_fps_audio(image)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress()
        if isinstance(bypass, bool) and bypass:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_bloom")
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_bloom")
        if float(max(0.0, _scalar(intensity))) <= 0.0:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_bloom")

        if source is not None:
            check_budget(int(source.shape[0]), int(source.shape[1]), int(source.shape[2]), int(source.shape[3]), multiplier=2.0, label="ImageOps Bloom", device=source.device)

        result = _apply_bloom(source, threshold, intensity, _scalar(radius, int))
        result = _apply_mask_to_image(source, result, effect_mask) if effect_mask is not None else result
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask, media_to_video(result, fps, audio, sample_rate)), prefix="imageops_bloom")
