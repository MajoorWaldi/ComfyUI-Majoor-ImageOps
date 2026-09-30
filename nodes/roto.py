from __future__ import annotations

import torch

from ._helpers import _scalar, _select_media_tensor
from comfy_api.latest import io
from ._progress import start_progress
from ._preview import build_node_preview_result
from .core.memory import check_budget
from .core.roto import is_animated, parse_shapes, render_matte
from .core.video_io import extract_video_fps_audio, media_to_video


class ImageOpsRoto(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsRoto",
            display_name="〽️ ImageOps Roto",
            category="image/imageops", essentials_category="Image Tools",
            search_aliases=["roto", "rotoscope", "bezier", "spline", "shape", "mask", "matte", "nuke"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("feather", default=0.0, min=0.0, max=512.0, step=0.5, round=0.01, tooltip="Gaussian feather applied to the final matte, in pixels."),
                io.Float.Input("expand", default=0.0, min=-512.0, max=512.0, step=0.5, round=0.01, tooltip="Grow (positive) or shrink (negative) every shape, in pixels."),
                io.Float.Input("opacity", default=1.0, min=0.0, max=1.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001),
                io.Boolean.Input("invert", default=False),
                io.Int.Input("frame_offset", default=0, min=-1000000, max=1000000, step=1, tooltip="Keyframes are looked up at batch index + frame_offset."),
                io.Combo.Input("view", options=["overlay", "matte", "result"], default="overlay", tooltip="Live preview only: source with matte tint, the matte alone, or the source cut by the matte."),
                io.Int.Input("width", default=1024, min=64, max=8192, step=1, tooltip="Matte size when no image is connected."),
                io.Int.Input("height", default=1024, min=64, max=8192, step=1, tooltip="Matte size when no image is connected."),
                io.String.Input("shapes", default="", multiline=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], tooltip="Images/Video input.", display_name="Images/Video", optional=True, extra_dict={"forceInput": True}),
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
        bypass=False,
        feather=0.0,
        expand=0.0,
        opacity=1.0,
        invert=False,
        frame_offset=0,
        view="overlay",
        width=1024,
        height=1024,
        shapes="",
        image=None,
        video=None,
        **kwargs,
    ):
        progress = start_progress()
        if image is not None or video is not None:
            source = _select_media_tensor(image, video)
            fps, audio, sample_rate = extract_video_fps_audio(image if image is not None else video)
        else:
            source = torch.zeros((1, _scalar(height, int), _scalar(width, int), 3), dtype=torch.float32)
            fps, audio, sample_rate = 24.0, None, 44100
        batch, target_h, target_w = int(source.shape[0]), int(source.shape[1]), int(source.shape[2])

        if _scalar(bypass, bool):
            progress.finish()
            mask = torch.zeros((batch, target_h, target_w), device=source.device, dtype=source.dtype)
            return build_node_preview_result(source, (source, mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_roto")

        check_budget(batch, target_h, target_w, 4, multiplier=2.0, label="ImageOps Roto", device=source.device)

        parsed = parse_shapes(shapes)
        options = dict(
            expand=_scalar(expand, float),
            feather=_scalar(feather, float),
            opacity=_scalar(opacity, float),
            invert=_scalar(invert, bool),
        )
        offset = _scalar(frame_offset, int)
        frames = batch if is_animated(parsed) else 1
        mattes = [render_matte(parsed, index + offset, target_w, target_h, **options) for index in range(frames)]
        matte = torch.stack(mattes).to(device=source.device, dtype=source.dtype)
        if frames < batch:
            matte = matte.expand(batch, -1, -1)

        if image is None and video is None:
            result = matte.unsqueeze(-1).expand(-1, -1, -1, 3).contiguous()
        else:
            alpha = matte.unsqueeze(-1)
            if source.shape[-1] >= 4:
                alpha = alpha * source[..., 3:4]
            result = torch.cat([source[..., :3], alpha], dim=-1)
        progress.finish()
        return build_node_preview_result(result, (result, matte, media_to_video(result, fps, audio, sample_rate)), prefix="imageops_roto")
