from __future__ import annotations

import math

import torch

from ._helpers import _hex_to_rgb01, _scalar
from ._preview import build_node_preview_result

_NOISE_BASIS = ["perlin", "value", "white"]
_NOISE_FRACTAL_MODES = ["none", "fbm", "turbulence", "ridged"]
_EPSILON = 1.0e-6


def _fade(t: torch.Tensor) -> torch.Tensor:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def _lerp(a: torch.Tensor, b: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
    return a + (b - a) * t


def _make_generator(seed: int) -> torch.Generator:
    generator = torch.Generator(device="cpu")
    generator.manual_seed(int(seed) & 0xFFFFFFFFFFFFFFFF)
    return generator


def _perlin_noise(width: int, height: int, scale: float, offset_x: float, offset_y: float, seed: int) -> torch.Tensor:
    safe_scale = max(1.0, float(scale))
    xs = (torch.arange(width, dtype=torch.float32) + float(offset_x)) / safe_scale
    ys = (torch.arange(height, dtype=torch.float32) + float(offset_y)) / safe_scale

    xi = torch.floor(xs).to(torch.int64)
    yi = torch.floor(ys).to(torch.int64)
    xf = xs - xi.to(torch.float32)
    yf = ys - yi.to(torch.float32)
    xi = xi - int(xi.min().item())
    yi = yi - int(yi.min().item())

    grid_w = int(xi.max().item()) + 2
    grid_h = int(yi.max().item()) + 2
    angles = torch.rand((grid_h, grid_w), generator=_make_generator(seed), dtype=torch.float32) * (math.pi * 2.0)
    grad_x = torch.cos(angles)
    grad_y = torch.sin(angles)

    xi0 = xi.view(1, -1)
    yi0 = yi.view(-1, 1)
    xi1 = xi0 + 1
    yi1 = yi0 + 1

    dx0 = xf.view(1, -1)
    dy0 = yf.view(-1, 1)
    dx1 = dx0 - 1.0
    dy1 = dy0 - 1.0

    g00x = grad_x[yi0, xi0]
    g00y = grad_y[yi0, xi0]
    g10x = grad_x[yi0, xi1]
    g10y = grad_y[yi0, xi1]
    g01x = grad_x[yi1, xi0]
    g01y = grad_y[yi1, xi0]
    g11x = grad_x[yi1, xi1]
    g11y = grad_y[yi1, xi1]

    n00 = g00x * dx0 + g00y * dy0
    n10 = g10x * dx1 + g10y * dy0
    n01 = g01x * dx0 + g01y * dy1
    n11 = g11x * dx1 + g11y * dy1

    u = _fade(xf).view(1, -1)
    v = _fade(yf).view(-1, 1)
    nx0 = _lerp(n00, n10, u)
    nx1 = _lerp(n01, n11, u)
    return (_lerp(nx0, nx1, v) * 1.41421356237).clamp(-1.0, 1.0)


def _value_noise(width: int, height: int, scale: float, offset_x: float, offset_y: float, seed: int) -> torch.Tensor:
    safe_scale = max(1.0, float(scale))
    xs = (torch.arange(width, dtype=torch.float32) + float(offset_x)) / safe_scale
    ys = (torch.arange(height, dtype=torch.float32) + float(offset_y)) / safe_scale

    xi = torch.floor(xs).to(torch.int64)
    yi = torch.floor(ys).to(torch.int64)
    xf = xs - xi.to(torch.float32)
    yf = ys - yi.to(torch.float32)
    xi = xi - int(xi.min().item())
    yi = yi - int(yi.min().item())

    grid_w = int(xi.max().item()) + 2
    grid_h = int(yi.max().item()) + 2
    lattice = torch.rand((grid_h, grid_w), generator=_make_generator(seed), dtype=torch.float32) * 2.0 - 1.0

    xi0 = xi.view(1, -1)
    yi0 = yi.view(-1, 1)
    xi1 = xi0 + 1
    yi1 = yi0 + 1

    v00 = lattice[yi0, xi0]
    v10 = lattice[yi0, xi1]
    v01 = lattice[yi1, xi0]
    v11 = lattice[yi1, xi1]

    u = _fade(xf).view(1, -1)
    v = _fade(yf).view(-1, 1)
    nx0 = _lerp(v00, v10, u)
    nx1 = _lerp(v01, v11, u)
    return _lerp(nx0, nx1, v).clamp(-1.0, 1.0)


def _white_noise(width: int, height: int, seed: int) -> torch.Tensor:
    return torch.rand((height, width), generator=_make_generator(seed), dtype=torch.float32) * 2.0 - 1.0


def _basis_noise(
    basis: str,
    width: int,
    height: int,
    scale: float,
    offset_x: float,
    offset_y: float,
    seed: int,
) -> torch.Tensor:
    normalized = str(basis or "perlin").strip().lower()
    if normalized == "value":
        return _value_noise(width, height, scale, offset_x, offset_y, seed)
    if normalized == "white":
        return _white_noise(width, height, seed)
    return _perlin_noise(width, height, scale, offset_x, offset_y, seed)


def _synthesize_noise(
    basis: str,
    fractal_mode: str,
    width: int,
    height: int,
    scale: float,
    octaves: int,
    lacunarity: float,
    gain: float,
    offset_x: float,
    offset_y: float,
    seed: int,
) -> torch.Tensor:
    normalized_mode = str(fractal_mode or "none").strip().lower()
    if normalized_mode == "none":
        signed = _basis_noise(basis, width, height, scale, offset_x, offset_y, seed)
        return ((signed * 0.5) + 0.5).clamp(0.0, 1.0)

    total = torch.zeros((height, width), dtype=torch.float32)
    amplitude = 1.0
    amplitude_sum = 0.0
    current_scale = max(1.0, float(scale))
    safe_lacunarity = max(1.01, float(lacunarity))
    safe_gain = max(0.0, float(gain))

    for octave in range(max(1, int(octaves))):
        octave_seed = int(seed) + octave * 10007
        signed = _basis_noise(basis, width, height, current_scale, offset_x, offset_y, octave_seed)
        if normalized_mode == "turbulence":
            contribution = signed.abs()
        elif normalized_mode == "ridged":
            contribution = 1.0 - signed.abs()
        else:
            contribution = signed

        total = total + contribution * amplitude
        amplitude_sum += amplitude
        amplitude *= safe_gain
        current_scale = max(1.0, current_scale / safe_lacunarity)

    if amplitude_sum <= _EPSILON:
        return torch.zeros((height, width), dtype=torch.float32)

    total = total / amplitude_sum
    if normalized_mode == "fbm":
        return ((total * 0.5) + 0.5).clamp(0.0, 1.0)
    return total.clamp(0.0, 1.0)


def _apply_tone(gray: torch.Tensor, contrast: float, invert: bool) -> torch.Tensor:
    toned = ((gray - 0.5) * float(contrast)) + 0.5
    toned = toned.clamp(0.0, 1.0)
    if invert:
        toned = 1.0 - toned
    return toned.clamp(0.0, 1.0)


def _normalize_gray(gray: torch.Tensor) -> torch.Tensor:
    min_v = float(gray.min().item())
    max_v = float(gray.max().item())
    if max_v - min_v <= _EPSILON:
        return torch.zeros_like(gray)
    return ((gray - min_v) / (max_v - min_v)).clamp(0.0, 1.0)


def _colorize(gray: torch.Tensor, low_color: str, high_color: str) -> torch.Tensor:
    low = torch.tensor(_hex_to_rgb01(low_color), dtype=torch.float32).view(1, 1, 3)
    high = torch.tensor(_hex_to_rgb01(high_color), dtype=torch.float32).view(1, 1, 3)
    return low + gray.unsqueeze(-1) * (high - low)


class ImageOpsNoise:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "generate"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 64}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 64}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 256, "step": 1}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2147483647, "step": 1}),
                "seed_step": ("INT", {"default": 1, "min": 0, "max": 1048576, "step": 1}),
                "basis": (_NOISE_BASIS, {"default": "perlin"}),
                "fractal_mode": (_NOISE_FRACTAL_MODES, {"default": "fbm"}),
                "scale": ("FLOAT", {"default": 160.0, "min": 1.0, "max": 4096.0, "step": 1.0, "round": 0.01}),
                "octaves": ("INT", {"default": 5, "min": 1, "max": 12, "step": 1}),
                "lacunarity": ("FLOAT", {"default": 2.0, "min": 1.01, "max": 4.0, "step": 0.01, "round": 0.001}),
                "gain": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.01, "round": 0.001}),
                "offset_x": ("FLOAT", {"default": 0.0, "min": -65536.0, "max": 65536.0, "step": 1.0, "round": 0.01}),
                "offset_y": ("FLOAT", {"default": 0.0, "min": -65536.0, "max": 65536.0, "step": 1.0, "round": 0.01}),
                "frame_offset_x": ("FLOAT", {"default": 0.0, "min": -4096.0, "max": 4096.0, "step": 0.5, "round": 0.01}),
                "frame_offset_y": ("FLOAT", {"default": 0.0, "min": -4096.0, "max": 4096.0, "step": 0.5, "round": 0.01}),
                "contrast": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 4.0, "step": 0.01, "round": 0.001}),
                "invert": ("BOOLEAN", {"default": False}),
                "low_color": ("STRING", {"default": "#000000"}),
                "high_color": ("STRING", {"default": "#FFFFFF"}),
            }
        }

    def generate(
        self,
        width=1024,
        height=1024,
        batch_size=1,
        seed=0,
        seed_step=1,
        basis="perlin",
        fractal_mode="fbm",
        scale=160.0,
        octaves=5,
        lacunarity=2.0,
        gain=0.5,
        offset_x=0.0,
        offset_y=0.0,
        frame_offset_x=0.0,
        frame_offset_y=0.0,
        contrast=1.0,
        invert=False,
        low_color="#000000",
        high_color="#FFFFFF",
    ):
        target_w = max(1, _scalar(width, int))
        target_h = max(1, _scalar(height, int))
        frame_count = max(1, _scalar(batch_size, int))

        masks = []
        images = []
        for frame_index in range(frame_count):
            frame_seed = _scalar(seed, int, index=frame_index) + frame_index * _scalar(seed_step, int, index=frame_index)
            frame_gray = _synthesize_noise(
                basis=basis,
                fractal_mode=fractal_mode,
                width=target_w,
                height=target_h,
                scale=_scalar(scale, float, index=frame_index),
                octaves=_scalar(octaves, int, index=frame_index),
                lacunarity=_scalar(lacunarity, float, index=frame_index),
                gain=_scalar(gain, float, index=frame_index),
                offset_x=_scalar(offset_x, float, index=frame_index) + frame_index * _scalar(frame_offset_x, float, index=frame_index),
                offset_y=_scalar(offset_y, float, index=frame_index) + frame_index * _scalar(frame_offset_y, float, index=frame_index),
                seed=frame_seed,
            )
            frame_gray = _normalize_gray(frame_gray)
            frame_gray = _apply_tone(
                frame_gray,
                contrast=_scalar(contrast, float, index=frame_index),
                invert=_scalar(invert, bool, index=frame_index),
            )
            masks.append(frame_gray.unsqueeze(0))
            images.append(_colorize(frame_gray, low_color=low_color, high_color=high_color).unsqueeze(0))

        mask = torch.cat(masks, dim=0).clamp(0.0, 1.0)
        image = torch.cat(images, dim=0).clamp(0.0, 1.0)
        return build_node_preview_result(image, (image, mask), prefix="imageops_noise")
