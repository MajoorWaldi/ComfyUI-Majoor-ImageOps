from __future__ import annotations

import torch

from ._helpers import (
    _apply_kernel_blur,
    _apply_mask_to_image,
    _coerce_mask_tensor,
    _coerce_media_to_tensor,
    _custom_shape_kernel2d,
    _param_tensor,
    _polygon_kernel2d,
    _prepare_effect_mask,
    _resize,
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

_BOKEH_SHAPES = ["circle", "hexagon", "octagon", "custom"]
_SHAPE_SIDES = {"circle": 0, "hexagon": 6, "octagon": 8}


def _shape_kernel(radius: int, shape: str, custom_luma: torch.Tensor | None) -> torch.Tensor:
    if shape == "custom" and custom_luma is not None:
        return _custom_shape_kernel2d(radius, custom_luma)
    return _polygon_kernel2d(radius, _SHAPE_SIDES.get(shape, 0))


def _fit_depth(depth: torch.Tensor, batch: int, height: int, width: int, device, dtype) -> torch.Tensor:
    # depth is already reduced to [B,H,W] by _coerce_mask_tensor.
    d = depth.unsqueeze(-1)
    if d.shape[1] != height or d.shape[2] != width:
        d = _resize(d, width, height)
    if d.shape[0] != batch:
        d = d[:1].expand(batch, -1, -1, -1) if d.shape[0] == 1 else d[:batch]
    return d.clamp(0.0, 1.0).to(device=device, dtype=dtype)


def _apply_defocus(
    source: torch.Tensor,
    depth: torch.Tensor,
    focus_distance,
    focus_range,
    max_blur_radius: int,
    num_layers: int,
    bokeh_shape: str,
    highlight_threshold,
    highlight_boost,
    custom_luma: torch.Tensor | None,
) -> torch.Tensor:
    x = source.float()
    b, h, w, c = x.shape
    device, dtype = x.device, x.dtype

    depth_t = _fit_depth(depth, b, h, w, device, dtype)
    focus_t = _param_tensor(focus_distance, b, device, dtype)
    range_t = _param_tensor(focus_range, b, device, dtype).clamp(0.0, 0.99)
    threshold_t = _param_tensor(highlight_threshold, b, device, dtype)
    boost_t = _param_tensor(highlight_boost, b, device, dtype).clamp(min=0.0)

    coc = (depth_t - focus_t).abs()
    coc = (coc - range_t).clamp(min=0.0) / (1.0 - range_t).clamp(min=1e-3)
    radius_field = (coc * max_blur_radius).clamp(0.0, float(max_blur_radius))

    layers = max(2, int(num_layers))
    layer_radii = [round(i * max_blur_radius / (layers - 1)) for i in range(layers)]
    highlight = (x[..., :3] - threshold_t).clamp(min=0.0) * boost_t

    blurred_layers = []
    for r in layer_radii:
        if r <= 0:
            blurred_layers.append(x)
            continue
        kernel = _shape_kernel(r, bokeh_shape, custom_luma)
        base = _apply_kernel_blur(x, kernel)
        glow = _apply_kernel_blur(highlight, kernel)
        base_rgb = base[..., :3] + glow * (r / max_blur_radius)
        layer = torch.cat([base_rgb, base[..., 3:]], dim=-1) if c > 3 else base_rgb
        blurred_layers.append(layer)

    step = max(1e-6, max_blur_radius / (layers - 1))
    pos = (radius_field / step).clamp(0.0, float(layers - 1))
    idx_lo = pos.floor().clamp(max=layers - 2).long()
    idx_hi = idx_lo + 1
    frac = (pos - idx_lo.float()).clamp(0.0, 1.0)

    stack = torch.stack(blurred_layers, dim=3)  # [B,H,W,L,C]
    idx_lo_exp = idx_lo.unsqueeze(3).expand(-1, -1, -1, 1, c)
    idx_hi_exp = idx_hi.unsqueeze(3).expand(-1, -1, -1, 1, c)
    lo_vals = torch.gather(stack, 3, idx_lo_exp).squeeze(3)
    hi_vals = torch.gather(stack, 3, idx_hi_exp).squeeze(3)
    out = lo_vals * (1.0 - frac) + hi_vals * frac

    if c > 3:
        out = torch.cat([out[..., :3], out[..., 3:].clamp(0.0, 1.0)], dim=-1)
    return out.to(device=device, dtype=dtype)


class ImageOpsDefocus(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsDefocus",
            display_name="〽️ Image Ops Defocus",
            category="image/imageops", essentials_category="Image Tools",
            search_aliases=["defocus", "bokeh", "depth of field", "dof", "depth blur", "lens blur"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("focus_distance", default=0.5, min=0.0, max=1.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001, tooltip="Depth value (0=near, 1=far by default) that stays in focus."),
                io.Float.Input("focus_range", default=0.05, min=0.0, max=0.99, step=0.01, round=0.001, tooltip="Depth thickness around focus_distance that stays sharp before blur ramps up."),
                io.Int.Input("max_blur_radius", default=24, min=0, max=128, step=1, tooltip="Bokeh disc radius in pixels at the depth extremes."),
                io.Int.Input("num_layers", default=8, min=2, max=32, step=1, tooltip="Depth slices blurred and interpolated between. Higher = smoother falloff, slower."),
                io.Combo.Input("bokeh_shape", options=_BOKEH_SHAPES, default="circle"),
                io.Float.Input("highlight_threshold", default=0.9, min=0.0, max=2.0, step=0.01, round=0.001, tooltip="Brightness above which pixels bloom into visible bokeh discs when blurred."),
                io.Float.Input("highlight_boost", default=1.5, min=0.0, max=8.0, step=0.1, round=0.001, tooltip="Strength of the bokeh highlight bloom."),
                io.Boolean.Input("invert_depth", default=False),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], tooltip="Images/Video input.", display_name="Images/Video", optional=True, extra_dict={"forceInput": True}),
                io.MultiType.Input("depth", types=[io.Image, io.Video], tooltip="Depth map (grayscale). Its luma drives the per-pixel blur amount.", optional=True, extra_dict={"forceInput": True}),
                io.MultiType.Input("shape_texture", types=[io.Image, io.Video], tooltip="Optional grayscale bokeh aperture shape, used when bokeh_shape is custom.", display_name="Shape Texture", optional=True, extra_dict={"forceInput": True}),
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
        focus_distance=0.5,
        focus_range=0.05,
        max_blur_radius=24,
        num_layers=8,
        bokeh_shape="circle",
        highlight_threshold=0.9,
        highlight_boost=1.5,
        invert_depth=False,
        invert_mask=False,
        video=None,
        depth=None,
        shape_texture=None,
        mask=None,
        **kwargs,
    ):
        source = _select_media_tensor(image, video)
        fps, audio, sample_rate = extract_video_fps_audio(image)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress()
        if isinstance(bypass, bool) and bypass:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_defocus")
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_defocus")

        depth_tensor = _coerce_media_to_tensor(depth, "depth") if depth is not None else None
        depth_mask = _coerce_mask_tensor(depth_tensor, device=source.device, dtype=source.dtype) if depth_tensor is not None else None
        if depth_mask is None or _scalar(max_blur_radius, int) <= 0:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask, media_to_video(source, fps, audio, sample_rate)), prefix="imageops_defocus")
        if _scalar(invert_depth, bool):
            depth_mask = 1.0 - depth_mask

        custom_luma = None
        shape_tensor = _coerce_media_to_tensor(shape_texture, "shape_texture") if shape_texture is not None else None
        if shape_tensor is not None:
            shape_mask = _coerce_mask_tensor(shape_tensor, device=source.device, dtype=source.dtype)
            custom_luma = shape_mask[0] if shape_mask is not None else None

        check_budget(int(source.shape[0]), int(source.shape[1]), int(source.shape[2]), int(source.shape[3]), multiplier=float(_scalar(num_layers, int)), label="ImageOps Defocus", device=source.device)

        result = _apply_defocus(
            source,
            depth_mask,
            focus_distance,
            focus_range,
            _scalar(max_blur_radius, int),
            _scalar(num_layers, int),
            _scalar(bokeh_shape, str),
            highlight_threshold,
            highlight_boost,
            custom_luma,
        )
        result = _apply_mask_to_image(source, result, effect_mask) if effect_mask is not None else result
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask, media_to_video(result, fps, audio, sample_rate)), prefix="imageops_defocus")
