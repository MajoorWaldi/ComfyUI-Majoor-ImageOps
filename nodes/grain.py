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
        torch.sqrt(base.clamp(0.0, 1.0)),
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
    x = source.float().clamp(0.0, 1.0)
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
    out_rgb = out_rgb.clamp(0.0, 1.0)
    if x.shape[-1] > 3:
        return torch.cat([out_rgb, x[..., 3:]], dim=-1).to(device=source.device, dtype=source.dtype)
    return out_rgb.to(device=source.device, dtype=source.dtype)


class ImageOpsGrain:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "amount": ("FLOAT", {"default": 0.08, "min": 0.0, "max": 1.0, "step": 0.001}),
                "blend_mode": (_BLEND_MODES, {"default": "add"}),
                "monochrome": ("BOOLEAN", {"default": True}),
                "animated": ("BOOLEAN", {"default": True}),
                "frame_length": ("INT", {"default": 1, "min": 1, "max": 256, "step": 1, "tooltip": "Number of output frames when animating grain over a still image."}),
                "fps": ("FLOAT", {"default": 12.0, "min": 1.0, "max": 120.0, "step": 0.1, "round": 0.001}),
                "seed": ("INT", {"default": 12345, "min": 0, "max": 0xffffffffffffffff}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        image=None,
        bypass=False,
        amount=0.08,
        blend_mode="add",
        monochrome=True,
        animated=True,
        frame_length=1,
        fps=12.0,
        seed=12345,
        invert_mask=False,
        video=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video)
        preview_fps = max(1.0, _scalar(fps, float))
        progress = start_progress(unique_id=unique_id)

        if _scalar(bypass, bool) or float(max(0.0, _scalar(amount))) <= 0.0:
            progress.finish()
            output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_grain", fps=preview_fps)

        frame_count = max(1, _scalar(frame_length, int))
        if _scalar(animated, bool) and frame_count > int(source.shape[0]):
            repeats = (frame_count + int(source.shape[0]) - 1) // max(1, int(source.shape[0]))
            source = source.repeat((repeats, 1, 1, 1))[:frame_count]
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
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_grain", fps=preview_fps)
