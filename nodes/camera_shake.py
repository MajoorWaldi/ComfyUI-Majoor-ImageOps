from __future__ import annotations

import math
import random

import torch

from ._helpers import (
    MEDIA_INPUT_TYPE,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from ._preview import build_node_preview_result
from ._progress import start_progress
from .transform import (
    _composite_fill,
    _make_fill_background,
    _normalize_fill_mode,
    _padding_mode_from_fill,
    _transform_batch_affine,
    _transform_mask_affine,
    _transform_masked_source,
)

_FILL_MODES = ["transparent", "mirror", "stretch", "expand", "color"]


def _smooth_random_series(count: int, amount: float, seed: int, smoothing: float) -> list[float]:
    rng = random.Random(int(seed))
    smooth = max(0.0, min(0.98, float(smoothing)))
    current = rng.uniform(-amount, amount)
    values = []
    for _ in range(max(0, count)):
        target = rng.uniform(-amount, amount)
        current = current * smooth + target * (1.0 - smooth)
        values.append(current)
    return values


def _resample_series(series: list[float], frequency: float) -> list[float]:
    freq = max(0.01, float(frequency))
    if abs(freq - 1.0) <= 1.0e-6:
        return series
    if not series:
        return series
    out = []
    last = len(series) - 1
    for frame in range(len(series)):
        pos = min(last, max(0.0, frame * freq))
        lo = int(math.floor(pos))
        hi = min(last, lo + 1)
        t = pos - lo
        out.append(series[lo] * (1.0 - t) + series[hi] * t)
    return out


def _shake_params(
    frames: int,
    translate_px: float,
    rotate_deg: float,
    zoom: float,
    seed: int,
    smoothing: float,
    shake_frequency: float,
) -> tuple[list[float], list[float], list[float], list[float]]:
    source_count = max(frames, int(math.ceil(frames * max(0.01, float(shake_frequency)))) + 2)
    tx = _resample_series(_smooth_random_series(source_count, float(translate_px), int(seed) + 11, smoothing), shake_frequency)[:frames]
    ty = _resample_series(_smooth_random_series(source_count, float(translate_px), int(seed) + 23, smoothing), shake_frequency)[:frames]
    rot = _resample_series(_smooth_random_series(source_count, float(rotate_deg), int(seed) + 37, smoothing), shake_frequency)[:frames]
    zoom_jitter = _resample_series(_smooth_random_series(source_count, float(zoom), int(seed) + 53, smoothing), shake_frequency)[:frames]
    scales = [max(0.01, 1.0 + value) for value in zoom_jitter]
    return tx, ty, rot, scales


def _all_near_zero(*values) -> bool:
    for value in values:
        if abs(float(_scalar(value))) > 1.0e-8:
            return False
    return True


class ImageOpsCameraShake:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "translate_px": ("FLOAT", {"default": 12.0, "min": 0.0, "max": 512.0, "step": 0.1}),
                "rotate_deg": ("FLOAT", {"default": 1.5, "min": 0.0, "max": 45.0, "step": 0.01}),
                "zoom": ("FLOAT", {"default": 0.03, "min": 0.0, "max": 1.0, "step": 0.001}),
                "smoothing": ("FLOAT", {"default": 0.65, "min": 0.0, "max": 0.98, "step": 0.01}),
                "shake_frequency": ("FLOAT", {"default": 1.0, "min": 0.05, "max": 8.0, "step": 0.05, "round": 0.001, "tooltip": "How quickly the camera shake target changes. 1 = one target per frame; lower is slower, higher is more nervous."}),
                "frame_length": ("INT", {"default": 24, "min": 1, "max": 4096, "step": 1, "tooltip": "Number of output frames when shaking a still image."}),
                "fps": ("FLOAT", {"default": 12.0, "min": 1.0, "max": 120.0, "step": 0.1, "round": 0.001}),
                "seed": ("INT", {"default": 12345, "min": 0, "max": 0xffffffffffffffff}),
                "filter": (["nearest", "bilinear", "bicubic"], {"default": "bilinear"}),
                "fill_mode": (_FILL_MODES, {"default": "mirror"}),
                "fill_color": ("COLOR", {"default": "#000000"}),
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
        translate_px=12.0,
        rotate_deg=1.5,
        zoom=0.03,
        smoothing=0.65,
        shake_frequency=1.0,
        frame_length=24,
        fps=12.0,
        seed=12345,
        filter="bilinear",
        fill_mode="mirror",
        fill_color="#000000",
        invert_mask=False,
        video=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        preview_fps = max(1.0, _scalar(fps, float))
        progress = start_progress(unique_id=unique_id)

        if _scalar(bypass, bool) or _all_near_zero(translate_px, rotate_deg, zoom):
            progress.finish()
            output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_camerashake", fps=preview_fps)

        frame_count = max(1, _scalar(frame_length, int))
        if frame_count > int(source.shape[0]):
            repeats = (frame_count + int(source.shape[0]) - 1) // max(1, int(source.shape[0]))
            source = source.repeat((repeats, 1, 1, 1))[:frame_count]
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)

        frames = int(source.shape[0])
        tx, ty, rot, scales = _shake_params(
            frames,
            _scalar(translate_px),
            _scalar(rotate_deg),
            _scalar(zoom),
            _scalar(seed, int),
            _scalar(smoothing),
            _scalar(shake_frequency),
        )
        safe_fill = _normalize_fill_mode(fill_mode)
        padding = _padding_mode_from_fill(safe_fill)

        if input_mask is not None:
            result, output_mask = _transform_masked_source(
                source,
                input_mask,
                filter,
                tx,
                ty,
                rot,
                scales,
                progress=progress,
                padding_mode=padding,
            )
            result = _composite_fill(result, output_mask, _make_fill_background(source, safe_fill, fill_color))
        else:
            progress.update_absolute(0, total=2)
            result = _transform_batch_affine(source, filter, tx, ty, rot, scales, padding_mode=padding)
            output_mask = _transform_mask_affine(
                output_mask_source,
                filter,
                tx,
                ty,
                rot,
                scales,
                source.device,
                source.dtype,
                padding_mode="zeros",
            )
            result = _composite_fill(result, output_mask, _make_fill_background(source, safe_fill, fill_color))
            if safe_fill != "transparent":
                output_mask = result[..., 3].clamp(0.0, 1.0) if result.shape[-1] >= 4 else torch.ones_like(output_mask)
        progress.finish()
        return build_node_preview_result(result, (result.clamp(0.0, 1.0), output_mask.clamp(0.0, 1.0)), prefix="imageops_camerashake", fps=preview_fps)
