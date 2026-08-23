from __future__ import annotations

import torch

from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_mask_to_image,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress

_BLEND_MODES = ["add", "overlay", "soft_light"]


def _grain_noise_like(source: torch.Tensor, seed: int, monochrome: bool, animated: bool) -> torch.Tensor:
    batch, height, width, channels = source.shape
    rgb_channels = min(3, channels)
    if monochrome:
        frames = []
        for index in range(batch):
            frame_seed = int(seed) + (index if animated else 0)
            generator = torch.Generator(device="cpu").manual_seed(frame_seed)
            noise = torch.rand((1, height, width, 1), generator=generator, dtype=torch.float32) - 0.5
            frames.append(noise.expand(1, height, width, rgb_channels))
        grain = torch.cat(frames, dim=0)
    else:
        frames = []
        for index in range(batch):
            frame_seed = int(seed) + (index if animated else 0)
            generator = torch.Generator(device="cpu").manual_seed(frame_seed)
            frames.append(torch.rand((1, height, width, rgb_channels), generator=generator, dtype=torch.float32) - 0.5)
        grain = torch.cat(frames, dim=0)
    return grain.to(device=source.device, dtype=source.dtype)


def _soft_light(base: torch.Tensor, top: torch.Tensor) -> torch.Tensor:
    curve = torch.where(
        base <= 0.25,
        ((16.0 * base - 12.0) * base + 4.0) * base,
        torch.sqrt(base),
    )
    return torch.where(
        top <= 0.5,
        base - (1.0 - 2.0 * top) * base * (1.0 - base),
        base + (2.0 * top - 1.0) * (curve - base),
    )


def _apply_synthetic_grain(source: torch.Tensor, amount, seed: int, monochrome: bool, animated: bool, blend_mode: str) -> torch.Tensor:
    if source is None:
        raise ValueError("image is None")
    if source.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(source.shape)}")
    x = source.float()
    rgb = x[..., :3]
    batch = int(x.shape[0])
    amount_t = torch.tensor(float(max(0.0, _scalar(amount))), device=x.device, dtype=x.dtype).view(1, 1, 1, 1)
    if amount_t.item() <= 0.0:
        return source
    grain = _grain_noise_like(x, int(seed), bool(monochrome), bool(animated)) * amount_t
    mode = str(blend_mode or "add").strip().lower().replace("-", "_").replace(" ", "_")
    if mode == "overlay":
        top = (0.5 + grain).clamp(0.0, 1.0)
        blended = torch.where(
            rgb <= 0.5,
            2.0 * rgb * top,
            1.0 - 2.0 * (1.0 - rgb) * (1.0 - top),
        )
        out_rgb = rgb * (1.0 - amount_t.clamp(0.0, 1.0)) + blended * amount_t.clamp(0.0, 1.0)
    elif mode == "soft_light":
        top = (0.5 + grain).clamp(0.0, 1.0)
        blended = _soft_light(rgb, top)
        out_rgb = rgb * (1.0 - amount_t.clamp(0.0, 1.0)) + blended * amount_t.clamp(0.0, 1.0)
    else:
        out_rgb = rgb + grain
    if x.shape[-1] > 3:
        return torch.cat([out_rgb, x[..., 3:].clamp(0.0, 1.0)], dim=-1).to(device=source.device, dtype=source.dtype)
    return out_rgb.to(device=source.device, dtype=source.dtype)


class ImageOpsGrain(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsGrain",
            display_name="〽️ ImageOps Grain",
            category="image/imageops",
            search_aliases=['grain', 'film grain', 'noise grain', 'texture'], inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("amount", default=0.08, min=0.0, max=1.0, step=0.001),
                io.Combo.Input("blend_mode", options=_BLEND_MODES, default="add"),
                io.Boolean.Input("monochrome", default=True),
                io.Boolean.Input("animated", default=True),
                io.Int.Input("frame_length", default=1, min=1, max=256, step=1, tooltip="Number of output frames when animating grain over a still image."),
                io.Float.Input("fps", default=12.0, min=1.0, max=120.0, step=0.1),
                io.Int.Input("seed", default=12345, min=0, max=0xffffffffffffffff),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], optional=True, display_name="Images/Video", tooltip="Images/Video input."),
                io.Mask.Input("mask", optional=True),
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
        amount: float = 0.08,
        blend_mode: str = "add",
        monochrome: bool = True,
        animated: bool = True,
        frame_length: int = 1,
        fps: float = 12.0,
        seed: int = 12345,
        invert_mask: bool = False,
        image=None,
        video=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video)
        preview_fps = max(1.0, _scalar(fps, float))
        progress = start_progress(unique_id=unique_id)

        if isinstance(bypass, bool) and bypass:
            progress.finish()
            output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_grain", fps=preview_fps)
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_grain", fps=preview_fps)
        if float(max(0.0, _scalar(amount))) <= 0.0:
            progress.finish()
            output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_grain", fps=preview_fps)

        frame_count = max(1, _scalar(frame_length, int))
        if _scalar(animated, bool) and frame_count > int(source.shape[0]):
            repeats = (frame_count + int(source.shape[0]) - 1) // max(1, int(source.shape[0]))
            source = source.repeat((repeats, 1, 1, 1))[:frame_count]
            
        from .core.memory import check_budget
        if source is not None:
            check_budget(int(source.shape[0]), int(source.shape[1]), int(source.shape[2]), int(source.shape[3]), multiplier=2.0, label='ImageOps Grain')
            
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        processed = _apply_synthetic_grain(
            source,
            amount,
            _scalar(seed, int),
            _scalar(monochrome, bool),
            _scalar(animated, bool),
            blend_mode,
        )
        result = _apply_mask_to_image(source, processed, effect_mask) if effect_mask is not None else processed
        from ._helpers import apply_per_frame_bypass
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_grain", fps=preview_fps)
