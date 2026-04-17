from __future__ import annotations

import math
import logging
import os
from typing import Union

import numpy as np
import torch
from PIL import Image

from ._ops_constants import EPSILON, GAMMA_MAX, GAMMA_SAFE_MIN, LUMA_WEIGHTS

# Type alias for parameters that can be a scalar or a per-frame list/tuple.
ScalarOrList = Union[float, int, bool, list, tuple]


def _scalar(v: ScalarOrList, typ: type = float, index: int = 0):
    """Unwrap a value that may be a scalar or a list/tuple (ComfyUI batching).

    Handles inputs from nodes like RyanOnTheInside's FeatureToFloat that
    return a Python list of floats through a FLOAT output slot.

    Args:
        v: scalar, list, tuple, or nested list/tuple.
        typ: target type (float, int, bool).
        index: when *v* is a flat list pick this element (clamped to length).
    """
    if isinstance(v, (list, tuple)):
        # Flat list of scalars (e.g. [0.5, 1.0, 0.3] from FeatureToFloat)
        if v and not isinstance(v[0], (list, tuple)):
            idx = min(index, len(v) - 1)
            return typ(v[idx])
        # Nested – unwrap one level and recurse
        while isinstance(v, (list, tuple)):
            v = v[0]
    return typ(v)


def _param_tensor(v: ScalarOrList, batch: int, device="cpu", dtype: torch.dtype = torch.float32) -> torch.Tensor:
    """Convert a scalar or per-frame list into a [B,1,1,1] tensor for broadcasting.

    Supports FeatureToFloat-style lists aligned to image batch dimension.
    """
    if isinstance(v, (list, tuple)):
        flat = [float(x) if not isinstance(x, (list, tuple)) else float(x[0]) for x in v]
        if len(flat) < batch:
            flat = flat + [flat[-1]] * (batch - len(flat))
        t = torch.tensor(flat[:batch], device=device, dtype=dtype)
    else:
        t = torch.tensor([float(v)], device=device, dtype=dtype).expand(batch)
    return t.view(batch, 1, 1, 1)


def _has_list_param(*args) -> bool:
    """Return True if any argument is a list/tuple (per-frame parameter)."""
    return any(isinstance(a, (list, tuple)) for a in args)


# Constants shared across ImageOps nodes
logger = logging.getLogger(__name__)

MAX_IMAGE_DIMENSION = 16384
MAX_SCALE_DIMENSION = 8192

def _get_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return int(default)

LARGE_IMAGE_WARN_MB = _get_int_env("IMAGEOPS_LARGE_IMAGE_WARN_MB", 2048)

ALLOWED_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'
}
MEDIA_INPUT_TYPE = "IMAGE,VIDEO"
LARGE_BLUR_BOX_THRESHOLD = 32
BOX_BLUR_APPROX_PASSES = 3
ASPECT_RATIO_PRESETS = {
    "custom": None,
    "1:1": (1, 1),
    "3:4": (3, 4),
    "4:3": (4, 3),
    "16:9": (16, 9),
    "9:16": (9, 16),
}
CHANNEL_OPTIONS = ["Red", "Green", "Blue", "Alpha"]
COMP_BLEND_MODES = [
    "over",
    "add",
    "multiply",
    "screen",
    "overlay",
    "soft_light",
    "difference",
    "lighten",
    "darken",
    "color_dodge",
    "color_burn",
    "exclusion",
]


def _pil_to_tensor(img: Image.Image) -> torch.Tensor:
    if img.mode not in ("RGB", "RGBA"):
        bands = img.getbands() if hasattr(img, 'getbands') and img.getbands() else []
        has_alpha = "A" in bands or img.mode in ("RGBA", "LA", "PA")
        img = img.convert("RGBA" if has_alpha else "RGB")

    arr = np.array(img).astype(np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    return torch.from_numpy(arr).unsqueeze(0)


def _tensor_to_pil(image: torch.Tensor) -> Image.Image:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    t = image[0].detach().cpu().float().clamp(0, 1)
    arr = (t.numpy() * 255.0 + 0.5).astype(np.uint8)
    if arr.shape[-1] == 4:
        return Image.fromarray(arr, mode="RGBA")
    return Image.fromarray(arr[..., :3], mode="RGB")


def _apply_color_correct(image, brightness, contrast, gamma, saturation):
    x = image.float()
    B = x.shape[0]
    d, dt = x.device, x.dtype
    br = _param_tensor(brightness, B, d, dt)
    ct = _param_tensor(contrast, B, d, dt)
    gm = _param_tensor(gamma, B, d, dt).clamp(GAMMA_SAFE_MIN, GAMMA_MAX)
    st = _param_tensor(saturation, B, d, dt)
    x = x + br
    x = (x - 0.5) * ct + 0.5
    x = torch.clamp(x, 0, 1) ** (1.0 / gm)

    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr * rgb[..., 0] + lg * rgb[..., 1] + lb * rgb[..., 2]).unsqueeze(-1)
    rgb = luma + (rgb - luma) * st
    if x.shape[-1] == 4:
        x = torch.cat([rgb, x[..., 3:4]], dim=-1)
    else:
        x = rgb

    return x.clamp(0, 1)


def _srgb_to_linear(rgb: torch.Tensor) -> torch.Tensor:
    rgb = rgb.clamp(0.0, 1.0)
    return torch.where(
        rgb <= 0.04045,
        rgb / 12.92,
        ((rgb + 0.055) / 1.055).pow(2.4),
    )


def _linear_to_srgb(rgb: torch.Tensor) -> torch.Tensor:
    rgb = rgb.clamp(0.0, 1.0)
    return torch.where(
        rgb <= 0.0031308,
        rgb * 12.92,
        1.055 * rgb.pow(1.0 / 2.4) - 0.055,
    )


def _apply_temperature_linear(rgb: torch.Tensor, temperature: torch.Tensor) -> torch.Tensor:
    warm = temperature.clamp(min=0.0)
    cool = (-temperature).clamp(min=0.0)
    scales = torch.cat([
        1.0 + warm,
        1.0 + warm * 0.4,
        1.0 + cool,
    ], dim=-1)
    return rgb * scales


def _apply_tint_linear(rgb: torch.Tensor, tint: torch.Tensor) -> torch.Tensor:
    green = tint.clamp(min=0.0)
    magenta = (-tint).clamp(min=0.0)
    scales = torch.cat([
        1.0 + magenta * 0.5,
        1.0 + green,
        1.0 + magenta * 0.5,
    ], dim=-1)
    return rgb * scales


def _apply_hue_shift_rgb(rgb: torch.Tensor, hue_shift: torch.Tensor) -> torch.Tensor:
    hsv = _rgb_to_hsv(rgb.clamp(0.0, 1.0))
    hue = (hsv[..., 0] + hue_shift[..., 0]) % 1.0
    shifted = torch.stack([hue, hsv[..., 1], hsv[..., 2]], dim=-1)
    return _hsv_to_rgb(shifted)


def _linear_luma(rgb: torch.Tensor) -> torch.Tensor:
    weights = torch.tensor(LUMA_WEIGHTS, device=rgb.device, dtype=rgb.dtype).view(1, 1, 1, 3)
    return (rgb * weights).sum(dim=-1, keepdim=True)


def _apply_vibrance_linear(rgb: torch.Tensor, vibrance: torch.Tensor) -> torch.Tensor:
    amount = vibrance.clamp(min=-1.0, max=1.0)
    luma = _linear_luma(rgb)
    max_rgb = rgb.amax(dim=-1, keepdim=True)
    min_rgb = rgb.amin(dim=-1, keepdim=True)
    chroma = (max_rgb - min_rgb).clamp(0.0, 1.0)
    boost = 1.0 + amount * (1.0 - chroma)
    return (luma + (rgb - luma) * boost).clamp(0.0, 1.0)


def _wheel_tint_rgb(
    rgb: torch.Tensor,
    hue_deg: ScalarOrList,
    amount: ScalarOrList,
    mask: torch.Tensor,
) -> torch.Tensor:
    B = rgb.shape[0]
    d = rgb.device
    hue = _param_tensor(hue_deg, B, d, torch.float32) / 360.0
    sat = (_param_tensor(amount, B, d, torch.float32).abs() / 100.0).clamp(0.0, 1.0)
    hsv = torch.cat([
        torch.remainder(hue, 1.0),
        sat,
        torch.ones_like(sat),
    ], dim=-1)
    tint_rgb = _hsv_to_rgb(hsv).clamp(0.0, 1.0)
    tint_linear = _srgb_to_linear(tint_rgb).clamp(0.0, 1.0)
    influence = sat * mask
    scale = 1.0 + (tint_linear - 0.5) * influence * 0.85
    return (rgb * scale).clamp(0.0, 1.0)


def _apply_three_way_color_grade(
    rgb: torch.Tensor,
    shadows_hue: ScalarOrList,
    shadows_amount: ScalarOrList,
    midtones_hue: ScalarOrList,
    midtones_amount: ScalarOrList,
    highlights_hue: ScalarOrList,
    highlights_amount: ScalarOrList,
) -> torch.Tensor:
    luma = _linear_luma(rgb)
    shadow_mask = ((0.5 - luma) / 0.5).clamp(0.0, 1.0)
    shadow_mask = shadow_mask * shadow_mask
    highlight_mask = ((luma - 0.5) / 0.5).clamp(0.0, 1.0)
    highlight_mask = highlight_mask * highlight_mask
    mid_mask = (1.0 - shadow_mask - highlight_mask).clamp(0.0, 1.0)

    out = rgb
    out = _wheel_tint_rgb(out, shadows_hue, shadows_amount, shadow_mask)
    out = _wheel_tint_rgb(out, midtones_hue, midtones_amount, mid_mask)
    out = _wheel_tint_rgb(out, highlights_hue, highlights_amount, highlight_mask)
    return out.clamp(0.0, 1.0)


def _param_all_close(v: ScalarOrList, target: float, tolerance: float = 1e-6) -> bool:
    if isinstance(v, (list, tuple)):
        return all(_param_all_close(item, target, tolerance) for item in v)
    return abs(float(v) - target) <= tolerance


def _apply_color_adjust(
    image: torch.Tensor,
    temperature: ScalarOrList,
    tint: ScalarOrList,
    hue: ScalarOrList,
    brightness: ScalarOrList,
    contrast: ScalarOrList,
    saturation: ScalarOrList,
    vibrance: ScalarOrList,
    gamma: ScalarOrList,
    shadows_hue: ScalarOrList = 0.0,
    shadows_amount: ScalarOrList = 0.0,
    midtones_hue: ScalarOrList = 0.0,
    midtones_amount: ScalarOrList = 0.0,
    highlights_hue: ScalarOrList = 0.0,
    highlights_amount: ScalarOrList = 0.0,
) -> torch.Tensor:
    """Pure PyTorch color adjustment in linear RGB; alpha/extra channels pass through."""
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    if (
        _param_all_close(temperature, 0.0)
        and _param_all_close(tint, 0.0)
        and _param_all_close(hue, 0.0)
        and _param_all_close(brightness, 0.0)
        and _param_all_close(contrast, 0.0)
        and _param_all_close(saturation, 0.0)
        and _param_all_close(vibrance, 0.0)
        and _param_all_close(gamma, 1.0)
        and _param_all_close(shadows_amount, 0.0)
        and _param_all_close(midtones_amount, 0.0)
        and _param_all_close(highlights_amount, 0.0)
    ):
        return image

    x = image.float().clamp(0.0, 1.0)
    B = x.shape[0]
    C = x.shape[-1]
    d, dt = image.device, image.dtype

    brightness_t = 1.0 + _param_tensor(brightness, B, d, torch.float32) / 100.0
    contrast_t = 1.0 + _param_tensor(contrast, B, d, torch.float32) / 100.0
    saturation_t = 1.0 + _param_tensor(saturation, B, d, torch.float32) / 100.0
    temperature_t = _param_tensor(temperature, B, d, torch.float32) / 100.0
    tint_t = _param_tensor(tint, B, d, torch.float32) / 100.0
    vibrance_t = _param_tensor(vibrance, B, d, torch.float32) / 100.0
    hue_shift_t = _param_tensor(hue, B, d, torch.float32) / 360.0
    gamma_t = _param_tensor(gamma, B, d, torch.float32).clamp(GAMMA_SAFE_MIN, GAMMA_MAX)
    has_temperature = not _param_all_close(temperature, 0.0)
    has_tint = not _param_all_close(tint, 0.0)
    has_contrast = not _param_all_close(contrast, 0.0)
    has_saturation = not _param_all_close(saturation, 0.0)
    has_vibrance = not _param_all_close(vibrance, 0.0)
    has_hue = not _param_all_close(hue, 0.0)
    has_gamma = not _param_all_close(gamma, 1.0)
    has_three_way = (
        not _param_all_close(shadows_amount, 0.0)
        or not _param_all_close(midtones_amount, 0.0)
        or not _param_all_close(highlights_amount, 0.0)
    )

    rgb = _srgb_to_linear(x[..., :3])
    extra = x[..., 3:] if C > 3 else None

    rgb = (rgb * brightness_t).clamp(0.0, 1.0)
    if has_temperature:
        rgb = _apply_temperature_linear(rgb, temperature_t).clamp(0.0, 1.0)
    if has_tint:
        rgb = _apply_tint_linear(rgb, tint_t).clamp(0.0, 1.0)

    if has_contrast:
        mean_luma = _linear_luma(rgb).mean(dim=(1, 2), keepdim=True)
        rgb = (mean_luma + (rgb - mean_luma) * contrast_t).clamp(0.0, 1.0)

    if has_saturation:
        luma = _linear_luma(rgb)
        rgb = (luma + (rgb - luma) * saturation_t).clamp(0.0, 1.0)
    if has_vibrance:
        rgb = _apply_vibrance_linear(rgb, vibrance_t).clamp(0.0, 1.0)
    if has_hue:
        rgb = _apply_hue_shift_rgb(rgb, hue_shift_t).clamp(0.0, 1.0)
    if has_three_way:
        rgb = _apply_three_way_color_grade(
            rgb,
            shadows_hue,
            shadows_amount,
            midtones_hue,
            midtones_amount,
            highlights_hue,
            highlights_amount,
        )
    if has_gamma:
        rgb = rgb.pow(1.0 / gamma_t).clamp(0.0, 1.0)
    rgb = _linear_to_srgb(rgb)

    if extra is not None:
        return torch.cat([rgb, extra], dim=-1).to(device=d, dtype=dt)
    return rgb.to(device=d, dtype=dt)


def _apply_color_correct_reference(
    image: torch.Tensor,
    temperature: ScalarOrList,
    tint: ScalarOrList,
    hue: ScalarOrList,
    brightness: ScalarOrList,
    contrast: ScalarOrList,
    saturation: ScalarOrList,
    vibrance: ScalarOrList,
    gamma: ScalarOrList,
) -> torch.Tensor:
    return _apply_color_adjust(image, temperature, tint, hue, brightness, contrast, saturation, vibrance, gamma)


def _gaussian_kernel1d(radius, sigma):
    radius = int(max(0, radius))
    if radius == 0:
        return torch.tensor([1.0], dtype=torch.float32)
    sigma = float(max(EPSILON, sigma))
    xs = torch.arange(-radius, radius + 1, dtype=torch.float32)
    k = torch.exp(-(xs * xs) / (2.0 * sigma * sigma))
    return k / torch.sum(k)


def _gaussian_effective_radius(radius: int, sigma: float) -> int:
    radius = int(max(0, radius))
    sigma = float(max(0.0, sigma))
    sigma_radius = max(1, int(math.ceil(sigma * 4.0))) if sigma > 0.0 else 0
    if radius <= 0:
        return sigma_radius
    if sigma_radius <= 0:
        return radius
    return min(radius, sigma_radius)


def _box_blur_radii_for_gaussian(radius: int, sigma: float, passes: int = BOX_BLUR_APPROX_PASSES) -> tuple[int, ...]:
    radius = int(max(0, radius))
    passes = int(max(1, passes))
    if radius <= 0:
        return tuple(0 for _ in range(passes))

    kernel = _gaussian_kernel1d(radius, sigma)
    xs = torch.arange(-radius, radius + 1, dtype=kernel.dtype)
    variance = torch.sum(kernel * xs * xs).item()
    if variance <= EPSILON:
        return tuple(0 for _ in range(passes))

    effective_sigma = math.sqrt(max(0.0, variance))
    ideal_width = math.sqrt((12.0 * effective_sigma * effective_sigma / passes) + 1.0)
    lower_width = max(1, int(math.floor(ideal_width)))
    if lower_width % 2 == 0:
        lower_width -= 1
    lower_width = max(1, lower_width)
    upper_width = lower_width + 2

    numerator = (
        12.0 * effective_sigma * effective_sigma
        - passes * lower_width * lower_width
        - 4.0 * passes * lower_width
        - 3.0 * passes
    )
    denominator = -4.0 * lower_width - 4.0
    lower_count = int(round(numerator / denominator)) if abs(denominator) > EPSILON else passes
    lower_count = max(0, min(passes, lower_count))

    radii = []
    for index in range(passes):
        width = lower_width if index < lower_count else upper_width
        radii.append(min(radius, max(0, width // 2)))
    return tuple(radii)


def _box_blur1d_nchw(x: torch.Tensor, radius: int, dim: int) -> torch.Tensor:
    radius = int(max(0, radius))
    if radius <= 0:
        return x

    kernel_size = radius * 2 + 1
    accum_dtype = torch.float32 if x.dtype in (torch.float16, torch.bfloat16) else x.dtype

    if dim == -1:
        pad_mode = "reflect" if x.shape[-1] > radius else "replicate"
        padded = torch.nn.functional.pad(x, (radius, radius, 0, 0), mode=pad_mode)
        cumsum = padded.cumsum(dim=-1, dtype=accum_dtype)
        prefix = torch.cat([torch.zeros_like(cumsum[..., :1]), cumsum], dim=-1)
        return (prefix[..., kernel_size:] - prefix[..., :-kernel_size]) / float(kernel_size)

    if dim == -2:
        pad_mode = "reflect" if x.shape[-2] > radius else "replicate"
        padded = torch.nn.functional.pad(x, (0, 0, radius, radius), mode=pad_mode)
        cumsum = padded.cumsum(dim=-2, dtype=accum_dtype)
        prefix = torch.cat([torch.zeros_like(cumsum[:, :, :1, :]), cumsum], dim=-2)
        return (prefix[:, :, kernel_size:, :] - prefix[:, :, :-kernel_size, :]) / float(kernel_size)

    raise ValueError(f"Unsupported blur dimension: {dim}")


def _apply_box_blur_approx(image: torch.Tensor, radius: int, sigma: float) -> torch.Tensor:
    radii = _box_blur_radii_for_gaussian(radius, sigma)
    if not any(radii):
        return image

    x = image.permute(0, 3, 1, 2).contiguous()
    for box_radius in radii:
        if box_radius <= 0:
            continue
        x = _box_blur1d_nchw(x, box_radius, -1)
        x = _box_blur1d_nchw(x, box_radius, -2)
    return x.permute(0, 2, 3, 1).contiguous().clamp(0, 1)


def _apply_blur(image, radius, sigma):
    if _has_list_param(radius, sigma):
        return torch.cat([
            _apply_blur(image[i:i+1], _scalar(radius, int, index=i), _scalar(sigma, index=i))
            for i in range(image.shape[0])
        ], dim=0)
    radius = int(max(0, _scalar(radius, int)))
    raw_sigma = float(_scalar(sigma))
    effective_radius = _gaussian_effective_radius(radius, raw_sigma)
    if effective_radius <= 0:
        return image
    sigma = float(max(EPSILON, raw_sigma))
    if effective_radius > LARGE_BLUR_BOX_THRESHOLD:
        return _apply_box_blur_approx(image, effective_radius, sigma)
    radius = effective_radius
    k = _gaussian_kernel1d(radius, sigma).to(device=image.device, dtype=image.dtype)
    if k.numel() == 1:
        return image

    x = image.permute(0, 3, 1, 2).contiguous()
    _, C, _, _ = x.shape

    kx = k.view(1, 1, 1, -1).repeat(C, 1, 1, 1)
    ky = k.view(1, 1, -1, 1).repeat(C, 1, 1, 1)

    pad = int(radius)
    pad_mode_x = "reflect" if x.shape[-1] > pad else "replicate"
    x = torch.nn.functional.pad(x, (pad, pad, 0, 0), mode=pad_mode_x)
    x = torch.nn.functional.conv2d(x, kx, groups=C)
    pad_mode_y = "reflect" if x.shape[-2] > pad else "replicate"
    x = torch.nn.functional.pad(x, (0, 0, pad, pad), mode=pad_mode_y)
    x = torch.nn.functional.conv2d(x, ky, groups=C)

    return x.permute(0, 2, 3, 1).contiguous().clamp(0, 1)


def _coerce_media_to_tensor(media, input_name="media"):
    if media is None:
        return None

    if torch.is_tensor(media):
        if media.dim() != 4:
            raise TypeError(
                f"ImageOps {input_name} input expects IMAGE/VIDEO frames shaped [B,H,W,C], "
                f"got tensor {tuple(media.shape)}."
            )
        return media

    if isinstance(media, dict) and "samples" in media:
        raise TypeError(
            f"ImageOps {input_name} input does not accept LATENT data. "
            f"Decode it to IMAGE first, or connect a VIDEO input that can expose frames."
        )

    get_components = getattr(media, "get_components", None)
    if callable(get_components):
        components = get_components()
        images = getattr(components, "images", None)
        if not torch.is_tensor(images):
            raise TypeError(
                f"ImageOps {input_name} VIDEO input did not expose frames as a tensor."
            )
        if images.dim() != 4:
            raise TypeError(
                f"ImageOps {input_name} VIDEO input expects frames shaped [B,H,W,C], "
                f"got {tuple(images.shape)}."
            )
        return images

    raise TypeError(
        f"ImageOps {input_name} input only supports IMAGE frame batches or VIDEO inputs exposing frame components, "
        f"got {type(media).__name__}."
    )


def _select_media_tensor(image, video):
    errors = []
    for input_name, media in (("video", video), ("image", image)):
        if media is None:
            continue
        try:
            tensor = _coerce_media_to_tensor(media, input_name=input_name)
        except TypeError as exc:
            errors.append(str(exc))
            continue
        if tensor is not None:
            return tensor

    if errors:
        raise TypeError(errors[0])

    raise ValueError("ImageOps nodes require either an image or video input.")


def _expand_mask_batch(mask: torch.Tensor, target_batch: int) -> torch.Tensor:
    if mask.shape[0] == target_batch:
        return mask
    if mask.shape[0] == 1:
        return mask.expand(target_batch, -1, -1)
    reps = math.ceil(target_batch / mask.shape[0])
    return mask.repeat(reps, 1, 1)[:target_batch]


def _reduce_4d_to_3d(m: torch.Tensor) -> torch.Tensor:
    """Reduce a 4D tensor to 3D (B,H,W) for use as a mask."""
    if m.shape[1] == 1:
        return m[:, 0]                          # (B,1,H,W) → (B,H,W)
    if m.shape[-1] == 1:
        return m[..., 0]                        # (B,H,W,1) → (B,H,W)
    if m.shape[-1] >= 3:
        # Multi-channel BHWC image used as mask – convert RGB to luma (ignore alpha)
        lw = torch.tensor(LUMA_WEIGHTS, device=m.device, dtype=m.dtype)
        return (m[..., :3] * lw).sum(dim=-1)
    return m.mean(dim=-1)                       # Unknown layout – average channels


def _prepare_mask_tensor(mask, batch, height, width, device, dtype):
    if mask is None:
        return None
    m = mask
    if not torch.is_tensor(m):
        try:
            m = torch.tensor(m, dtype=torch.float32, device=device)
        except (RuntimeError, TypeError, ValueError) as e:
            logger.warning("Mask tensor conversion failed: %s", e)
            return None
    else:
        m = m.to(device=device)

    if m.dim() == 4:
        m = _reduce_4d_to_3d(m)

    if m.dim() == 2:
        m = m.unsqueeze(0)
    elif m.dim() not in (3,):
        m = m.reshape(-1, m.shape[-2], m.shape[-1])

    if m.shape[0] == 0:
        return None

    m = _expand_mask_batch(m, batch)
    if m.shape[1] != height or m.shape[2] != width:
        m = torch.nn.functional.interpolate(
            m.unsqueeze(1),
            size=(height, width),
            mode="bilinear",
            align_corners=False,
        ).squeeze(1)
    if m.device != device or m.dtype != dtype:
        m = m.to(device=device, dtype=dtype)
    return torch.clamp(m, 0.0, 1.0)


def _coerce_mask_tensor(mask, device=None, dtype=torch.float32):
    if mask is None:
        return None
    m = mask
    if not torch.is_tensor(m):
        try:
            m = torch.tensor(m, dtype=dtype, device=device)
        except (RuntimeError, TypeError, ValueError) as e:
            logger.warning("Mask tensor conversion failed: %s", e)
            return None
    else:
        kwargs = {}
        if device is not None:
            kwargs["device"] = device
        if dtype is not None:
            kwargs["dtype"] = dtype
        m = m.to(**kwargs) if kwargs else m

    if m.dim() == 4:
        m = _reduce_4d_to_3d(m)
    if m.dim() == 2:
        m = m.unsqueeze(0)
    elif m.dim() != 3:
        m = m.reshape(-1, m.shape[-2], m.shape[-1])
    if m.shape[0] == 0:
        return None
    return torch.clamp(m, 0.0, 1.0)


def _prepare_effect_mask(mask, reference, invert_mask=False):
    if reference is None:
        raise ValueError("reference is None")
    prepared = _prepare_mask_tensor(
        mask,
        batch=reference.shape[0],
        height=reference.shape[1],
        width=reference.shape[2],
        device=reference.device,
        dtype=reference.dtype,
    )
    if prepared is None:
        return None
    if isinstance(invert_mask, (list, tuple)):
        prepared = prepared.clone()
        for frame_index in range(prepared.shape[0]):
            if _scalar(invert_mask, bool, index=frame_index):
                prepared[frame_index:frame_index + 1] = 1.0 - prepared[frame_index:frame_index + 1]
    elif _scalar(invert_mask, bool):
        prepared = 1.0 - prepared
    return torch.clamp(prepared, 0.0, 1.0)


def _resolve_mask_output_source(mask, reference, invert_mask=False):
    if reference is None:
        raise ValueError("reference is None")
    prepared = _prepare_effect_mask(mask, reference, invert_mask=invert_mask)
    if prepared is None:
        prepared = _alpha_mask_from_image(reference)
        if isinstance(invert_mask, (list, tuple)):
            prepared = prepared.clone()
            for frame_index in range(prepared.shape[0]):
                if _scalar(invert_mask, bool, index=frame_index):
                    prepared[frame_index:frame_index + 1] = 1.0 - prepared[frame_index:frame_index + 1]
        elif _scalar(invert_mask, bool):
            prepared = 1.0 - prepared
    return torch.clamp(prepared, 0.0, 1.0)


def _alpha_mask_from_image(image):
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    if image.shape[-1] >= 4:
        return image[..., 3].float().clamp(0.0, 1.0)
    return torch.ones(
        (image.shape[0], image.shape[1], image.shape[2]),
        device=image.device,
        dtype=image.dtype,
    )


def _extract_channel_mask(image: torch.Tensor, channel: str) -> torch.Tensor:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    if isinstance(channel, (list, tuple)):
        return torch.cat([
            _extract_channel_mask(image[i:i+1], _scalar(channel, str, index=i))
            for i in range(image.shape[0])
        ], dim=0)

    normalized = str(channel or "Red").strip().lower()
    if normalized == "green":
        index = 1
    elif normalized == "blue":
        index = 2
    elif normalized == "alpha":
        return _alpha_mask_from_image(image)
    else:
        index = 0

    max_index = image.shape[-1] - 1
    index = max(0, min(index, max_index))
    return image[..., index].float().clamp(0.0, 1.0)


def _channel_mask_to_image(mask: torch.Tensor, reference: torch.Tensor) -> torch.Tensor:
    if mask is None:
        raise ValueError("mask is None")
    rgb = mask.unsqueeze(-1).expand(-1, -1, -1, 3)
    if reference.shape[-1] >= 4:
        return torch.cat([rgb, mask.unsqueeze(-1)], dim=-1).to(device=reference.device, dtype=reference.dtype)
    return rgb.to(device=reference.device, dtype=reference.dtype)


def _mask_to_preview_image(mask: torch.Tensor, device=None, dtype=torch.float32) -> torch.Tensor:
    prepared = _coerce_mask_tensor(mask, device=device, dtype=dtype)
    if prepared is None:
        raise ValueError("mask is None")
    rgb = prepared.unsqueeze(-1).expand(-1, -1, -1, 3)
    return rgb.to(device=prepared.device, dtype=prepared.dtype).clamp(0.0, 1.0)


def _blur_mask(mask: torch.Tensor, radius, sigma):
    if mask is None:
        return None
    x = mask.unsqueeze(-1)
    y = _apply_blur(x, radius, sigma)
    return y[..., 0].clamp(0.0, 1.0)


def _unpremultiply_rgb_by_mask(rgb: torch.Tensor, mask: torch.Tensor | None) -> torch.Tensor:
    if rgb is None:
        raise ValueError("rgb is None")
    x = rgb.float().clamp(0.0, 1.0)
    matte = _prepare_mask_tensor(
        mask,
        batch=x.shape[0],
        height=x.shape[1],
        width=x.shape[2],
        device=x.device,
        dtype=x.dtype,
    )
    if matte is None:
        return x
    alpha = matte.unsqueeze(-1).clamp(0.0, 1.0)
    safe_alpha = torch.where(alpha > EPSILON, alpha, torch.ones_like(alpha))
    straight = torch.where(alpha > EPSILON, x / safe_alpha, torch.zeros_like(x))
    return straight.clamp(0.0, 1.0)


def _apply_blur_with_mask_pair(image: torch.Tensor, mask: torch.Tensor, radius, sigma):
    if image is None:
        raise ValueError("image is None")
    prepared_mask = _prepare_mask_tensor(
        mask,
        batch=image.shape[0],
        height=image.shape[1],
        width=image.shape[2],
        device=image.device,
        dtype=image.dtype,
    )
    if prepared_mask is None:
        raise ValueError("mask is None")

    source = image.float().clamp(0.0, 1.0)
    premult_rgb = source[..., :3] * prepared_mask.unsqueeze(-1)
    blurred_rgb = _apply_blur(premult_rgb, radius, sigma)[..., :3]
    blurred_mask = _blur_mask(prepared_mask, radius, sigma)
    rgb = _unpremultiply_rgb_by_mask(blurred_rgb, blurred_mask)

    if source.shape[-1] >= 4:
        alpha = _apply_blur(source[..., 3:4], radius, sigma)
        result = torch.cat([rgb, alpha], dim=-1)
    else:
        result = rgb

    return result.clamp(0.0, 1.0), blurred_mask.clamp(0.0, 1.0)


def _clamp_mask(mask: torch.Tensor, min_v: float, max_v: float):
    if mask is None:
        return None
    x = mask.unsqueeze(-1)
    y = _apply_clamp(x, min_v, max_v)
    return y[..., 0].clamp(0.0, 1.0)


def _apply_mask_to_image(original, processed, mask):
    if mask is None:
        return processed
    if original.shape[0] != processed.shape[0]:
        if original.shape[0] == 1:
            original = original.expand(processed.shape[0], -1, -1, -1)
        else:
            reps = math.ceil(processed.shape[0] / original.shape[0])
            original = original.repeat(reps, 1, 1, 1)[:processed.shape[0]]

    if original.shape[1] != processed.shape[1] or original.shape[2] != processed.shape[2]:
        original = torch.nn.functional.interpolate(
            original.permute(0, 3, 1, 2).contiguous(),
            size=(processed.shape[1], processed.shape[2]),
            mode="bilinear",
            align_corners=False,
        ).permute(0, 2, 3, 1).contiguous()

    original = original.to(device=processed.device, dtype=processed.dtype)
    mask_tensor = _prepare_mask_tensor(
        mask,
        batch=processed.shape[0],
        height=processed.shape[1],
        width=processed.shape[2],
        device=processed.device,
        dtype=processed.dtype,
    )
    if mask_tensor is None:
        return processed
    if torch.all(mask_tensor >= 1.0 - EPSILON):
        return processed

    weight = mask_tensor.unsqueeze(-1)
    if original.shape[-1] >= 4 or processed.shape[-1] >= 4:
        original_rgba = _ensure_rgba(original.float().clamp(0.0, 1.0))
        processed_rgba = _ensure_rgba(processed.float().clamp(0.0, 1.0))
        blended = _unpremultiply_rgba(
            _premultiply_rgba(original_rgba) * (1.0 - weight)
            + _premultiply_rgba(processed_rgba) * weight
        ).clamp(0.0, 1.0)
        if processed.shape[-1] >= 4 or original.shape[-1] >= 4:
            return blended.to(device=processed.device, dtype=processed.dtype)
        return blended[..., :3].to(device=processed.device, dtype=processed.dtype)
    return (original * (1.0 - weight) + processed * weight).to(device=processed.device, dtype=processed.dtype)


def _match_image_to_reference(image: torch.Tensor, reference: torch.Tensor) -> torch.Tensor:
    if image.shape[0] != reference.shape[0]:
        if image.shape[0] == 1:
            image = image.expand(reference.shape[0], -1, -1, -1)
        else:
            reps = math.ceil(reference.shape[0] / image.shape[0])
            image = image.repeat(reps, 1, 1, 1)[:reference.shape[0]]

    if image.shape[1] != reference.shape[1] or image.shape[2] != reference.shape[2]:
        image = torch.nn.functional.interpolate(
            image.permute(0, 3, 1, 2).contiguous(),
            size=(reference.shape[1], reference.shape[2]),
            mode="bilinear",
            align_corners=False,
        ).permute(0, 2, 3, 1).contiguous()

    return image.to(device=reference.device, dtype=reference.dtype)

# =========================
# Extra ops (v5)
# =========================

def _apply_levels(image: torch.Tensor, in_min, in_max, gamma, out_min, out_max):
    x = image.float()
    B = x.shape[0]
    d, dt = x.device, x.dtype
    p_in_min = _param_tensor(in_min, B, d, dt)
    p_in_max = _param_tensor(in_max, B, d, dt)
    p_out_min = _param_tensor(out_min, B, d, dt)
    p_out_max = _param_tensor(out_max, B, d, dt)
    g_vals = _param_tensor(gamma, B, d, dt).clamp(GAMMA_SAFE_MIN, GAMMA_MAX)
    denom = (p_in_max - p_in_min).clamp(min=EPSILON)
    y = ((x - p_in_min) / denom).clamp(0.0, 1.0)
    y = y ** (1.0 / g_vals)
    y = p_out_min + y * (p_out_max - p_out_min)
    return y.clamp(0.0, 1.0)

def _rgb_to_hsv(rgb: torch.Tensor):
    # rgb: [...,3] in [0,1]
    r, g, b = rgb[...,0], rgb[...,1], rgb[...,2]
    maxc = torch.max(rgb, dim=-1).values
    minc = torch.min(rgb, dim=-1).values
    v = maxc
    delta = maxc - minc
    s = torch.where(maxc > EPSILON, delta / (maxc + EPSILON), torch.zeros_like(maxc))
    # hue
    rc = (maxc - r) / (delta + EPSILON)
    gc = (maxc - g) / (delta + EPSILON)
    bc = (maxc - b) / (delta + EPSILON)
    h = torch.zeros_like(maxc)
    h = torch.where((maxc == r) & (delta > EPSILON), (bc - gc), h)
    h = torch.where((maxc == g) & (delta > EPSILON), (2.0 + rc - bc), h)
    h = torch.where((maxc == b) & (delta > EPSILON), (4.0 + gc - rc), h)
    h = (h / 6.0) % 1.0
    return torch.stack([h, s, v], dim=-1)

def _hsv_to_rgb(hsv: torch.Tensor):
    h, s, v = hsv[...,0], hsv[...,1], hsv[...,2]
    h6 = (h % 1.0) * 6.0
    i = torch.floor(h6).to(torch.int64)
    f = h6 - i.float()
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i_mod = i % 6
    r = torch.where(i_mod == 0, v, torch.where(i_mod == 1, q, torch.where(i_mod == 2, p, torch.where(i_mod == 3, p, torch.where(i_mod == 4, t, v)))))
    g = torch.where(i_mod == 0, t, torch.where(i_mod == 1, v, torch.where(i_mod == 2, v, torch.where(i_mod == 3, q, torch.where(i_mod == 4, p, p)))))
    b = torch.where(i_mod == 0, p, torch.where(i_mod == 1, p, torch.where(i_mod == 2, t, torch.where(i_mod == 3, v, torch.where(i_mod == 4, v, q)))))
    return torch.stack([r, g, b], dim=-1)

def _apply_huesat(image: torch.Tensor, hue_deg, saturation, value):
    x = image.float()
    B = x.shape[0]
    rgb = x[..., :3].clamp(0,1)
    hsv = _rgb_to_hsv(rgb)
    hd = _param_tensor(hue_deg, B, x.device, x.dtype).view(B, 1, 1)
    st = _param_tensor(saturation, B, x.device, x.dtype).view(B, 1, 1)
    vl = _param_tensor(value, B, x.device, x.dtype).view(B, 1, 1)
    hue = (hsv[...,0] + (hd / 360.0)) % 1.0
    sat = (hsv[...,1] * st).clamp(0.0, 4.0)
    val = (hsv[...,2] * vl).clamp(0.0, 4.0)
    rgb2 = _hsv_to_rgb(torch.stack([hue, sat, val], dim=-1)).clamp(0,1)
    if x.shape[-1] == 4:
        x = torch.cat([rgb2, x[...,3:4]], dim=-1)
    else:
        x = rgb2
    return x.clamp(0,1)

def _apply_invert(image: torch.Tensor, invert_alpha: bool = False):
    x = image.float()
    if x.shape[-1] == 4:
        rgb = 1.0 - x[..., :3]
        a = (1.0 - x[..., 3:4]) if invert_alpha else x[..., 3:4]
        return torch.cat([rgb, a], dim=-1).clamp(0,1)
    return (1.0 - x).clamp(0,1)

def _apply_clamp(image: torch.Tensor, min_v, max_v):
    x = image.float()
    B = x.shape[0]
    lo = _param_tensor(min_v, B, x.device, x.dtype)
    hi = _param_tensor(max_v, B, x.device, x.dtype)
    lo, hi = torch.min(lo, hi), torch.max(lo, hi)
    return torch.max(torch.min(x, hi), lo).clamp(0, 1)

def _apply_sharpen(image: torch.Tensor, amount, radius, sigma, threshold):
    if _has_list_param(amount, radius, sigma, threshold):
        return torch.cat([
            _apply_sharpen(image[i:i+1],
                           _scalar(amount, index=i), _scalar(radius, int, index=i),
                           _scalar(sigma, index=i), _scalar(threshold, index=i))
            for i in range(image.shape[0])
        ], dim=0)
    x = image.float().clamp(0,1)
    if _scalar(amount) == 0.0 or _scalar(radius, int) <= 0:
        return x
    blurred = _apply_blur(x, _scalar(radius, int), _scalar(max(EPSILON, _scalar(sigma))))
    diff = x - blurred
    if _scalar(threshold) > 0:
        m = diff.abs().mean(dim=-1, keepdim=True)
        diff = torch.where(m >= _scalar(threshold), diff, torch.zeros_like(diff))
    y = (x + diff * _scalar(amount)).clamp(0,1)
    return y

def _apply_edge_detect(image: torch.Tensor, strength: float):
    """Sobel edge magnitude on luma. Output is grayscale RGB (alpha passthrough)."""
    x = image.float().clamp(0, 1)
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    l = (lr * rgb[..., 0] + lg * rgb[..., 1] + lb * rgb[..., 2]).clamp(0, 1)  # [B,H,W]
    l = l.unsqueeze(1)  # [B,1,H,W]

    kx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=torch.float32, device=x.device).view(1, 1, 3, 3)
    ky = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=torch.float32, device=x.device).view(1, 1, 3, 3)

    pad = torch.nn.functional.pad(l, (1, 1, 1, 1), mode="reflect")
    gx = torch.nn.functional.conv2d(pad, kx)
    gy = torch.nn.functional.conv2d(pad, ky)

    s_t = _param_tensor(strength, x.shape[0], x.device, x.dtype).view(x.shape[0], 1, 1, 1)
    mag = torch.sqrt(gx * gx + gy * gy) * s_t
    mag = mag.clamp(0, 1)

    out_rgb = mag.repeat(1, 3, 1, 1).permute(0, 2, 3, 1).contiguous()
    if x.shape[-1] == 4:
        return torch.cat([out_rgb, x[..., 3:4]], dim=-1).clamp(0, 1)
    return out_rgb.clamp(0, 1)

def _resize_merge_foreground(image: torch.Tensor, out_w: int, out_h: int) -> torch.Tensor:
    if image.shape[-1] == 4:
        return _resize_premultiplied_rgba(image, out_w, out_h)
    return _resize(image, out_w, out_h, mode="bicubic", antialias=True)


def _fit_merge_foreground(image: torch.Tensor, reference: torch.Tensor, fit_mode: str = "stretch") -> torch.Tensor:
    if image.shape[0] != reference.shape[0]:
        if image.shape[0] == 1:
            image = image.expand(reference.shape[0], -1, -1, -1)
        else:
            reps = math.ceil(reference.shape[0] / image.shape[0])
            image = image.repeat(reps, 1, 1, 1)[:reference.shape[0]]

    image = image.to(device=reference.device, dtype=reference.dtype)
    target_h = int(reference.shape[1])
    target_w = int(reference.shape[2])
    source_h = int(image.shape[1])
    source_w = int(image.shape[2])
    if source_h == target_h and source_w == target_w:
        return image

    normalized = str(fit_mode or "stretch").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in ("stretch", "scale", "resize", "fit_exact"):
        return _resize_merge_foreground(image, target_w, target_h)

    add_fit_alpha = image.shape[-1] == 3 and normalized in ("contain", "fit", "letterbox", "pad", "none", "center", "original")
    if normalized in ("none", "center", "original"):
        scaled = image
    else:
        scale = min(target_w / max(1, source_w), target_h / max(1, source_h))
        if normalized in ("cover", "fill", "crop"):
            scale = max(target_w / max(1, source_w), target_h / max(1, source_h))
        scaled_w = max(1, int(round(source_w * scale)))
        scaled_h = max(1, int(round(source_h * scale)))
        scaled = _resize_merge_foreground(image, scaled_w, scaled_h)

    out_channels = 4 if add_fit_alpha else scaled.shape[-1]
    out = torch.zeros((scaled.shape[0], target_h, target_w, out_channels), device=reference.device, dtype=reference.dtype)
    src_h = int(scaled.shape[1])
    src_w = int(scaled.shape[2])
    dst_x0 = max(0, (target_w - src_w) // 2)
    dst_y0 = max(0, (target_h - src_h) // 2)
    src_x0 = max(0, (src_w - target_w) // 2)
    src_y0 = max(0, (src_h - target_h) // 2)
    copy_w = min(target_w, src_w)
    copy_h = min(target_h, src_h)
    cropped = scaled[:, src_y0:src_y0 + copy_h, src_x0:src_x0 + copy_w, :]
    out[:, dst_y0:dst_y0 + copy_h, dst_x0:dst_x0 + copy_w, :scaled.shape[-1]] = cropped
    if add_fit_alpha:
        out[:, dst_y0:dst_y0 + copy_h, dst_x0:dst_x0 + copy_w, 3:4] = 1.0
    return out


def _normalize_merge_mode(mode: str) -> str:
    normalized = str(mode or "over").strip().lower().replace("-", "_").replace(" ", "_")
    return "over" if normalized == "normal" else normalized


def _blend_merge_rgb(base_rgb: torch.Tensor, top_rgb: torch.Tensor, mode: str) -> torch.Tensor:
    normalized = _normalize_merge_mode(mode)
    if normalized in ("over", "normal"):
        return top_rgb
    if normalized == "subtract":
        return (base_rgb - top_rgb).clamp(0.0, 1.0)
    if normalized == "vivid_light":
        burn = _blend_merge_rgb(base_rgb, (top_rgb * 2.0).clamp(0.0, 1.0), "color_burn")
        dodge = _blend_merge_rgb(base_rgb, (top_rgb * 2.0 - 1.0).clamp(0.0, 1.0), "color_dodge")
        return torch.where(top_rgb <= 0.5, burn, dodge).clamp(0.0, 1.0)
    if normalized == "pin_light":
        return torch.where(
            top_rgb <= 0.5,
            torch.minimum(base_rgb, (top_rgb * 2.0).clamp(0.0, 1.0)),
            torch.maximum(base_rgb, (top_rgb * 2.0 - 1.0).clamp(0.0, 1.0)),
        ).clamp(0.0, 1.0)
    if normalized == "hard_mix":
        vivid = _blend_merge_rgb(base_rgb, top_rgb, "vivid_light")
        return torch.where(vivid < 0.5, torch.zeros_like(vivid), torch.ones_like(vivid))
    return _blend_rgb(base_rgb, top_rgb, normalized).clamp(0.0, 1.0)


def _apply_merge(a: torch.Tensor, b: torch.Tensor, mode: str, mix, foreground_fit="stretch", blend_space="linear"):
    # a,b: [B,H,W,C]
    a = a.float().clamp(0,1)
    b = b.float().clamp(0,1)
    if b.shape[0] != a.shape[0]:
        if b.shape[0] == 1:
            b = b.expand(a.shape[0], -1, -1, -1)
        else:
            reps = math.ceil(a.shape[0] / b.shape[0])
            b = b.repeat(reps, 1, 1, 1)[:a.shape[0]]
    if _has_list_param(mode, mix, foreground_fit, blend_space):
        return torch.cat([
            _apply_merge(
                a[i:i+1],
                b[i:i+1],
                _scalar(mode, str, index=i),
                _scalar(mix, index=i),
                _scalar(foreground_fit, str, index=i),
                _scalar(blend_space, str, index=i),
            )
            for i in range(a.shape[0])
        ], dim=0)
    b = _fit_merge_foreground(b, a, foreground_fit)
    mode = _normalize_merge_mode(mode)
    m = _param_tensor(mix, a.shape[0], a.device, a.dtype)
    ar_srgb, br_srgb = a[..., :3], b[..., :3]
    linear = str(blend_space or "linear").strip().lower() in ("linear", "lin", "gamma_1", "gamma_1_0")
    ar = _srgb_to_linear(ar_srgb) if linear else ar_srgb
    br = _srgb_to_linear(br_srgb) if linear else br_srgb

    if mode == "over":
        # if b has alpha, over a
        if b.shape[-1] == 4:
            ba = b[...,3:4].clamp(0,1)
            out = br*ba + ar*(1.0-ba)
        else:
            out = br
    else:
        out = _blend_merge_rgb(ar, br, mode)
        if b.shape[-1] == 4:
            ba = b[..., 3:4].clamp(0, 1)
            out = out * ba + ar * (1.0 - ba)
    out = out.clamp(0,1)
    out = ar*(1.0-m) + out*m
    out = _linear_to_srgb(out) if linear else out

    if a.shape[-1] == 4:
        aa = a[...,3:4]
        if b.shape[-1] == 4 and mode == "over":
            ba = b[...,3:4].clamp(0,1)
            merged_alpha = ba + aa*(1.0-ba)
            ao = aa*(1.0-m) + merged_alpha*m
        else:
            ao = aa
        return torch.cat([out, ao], dim=-1).clamp(0,1)
    return out.clamp(0,1)

def _dilate_erode_mask(mask: torch.Tensor, radius: int, op: str):
    if mask is None:
        return None
    m = mask.float()
    if m.dim() == 3:
        m = m.unsqueeze(1)  # [B,1,H,W]
    elif m.dim() == 2:
        m = m.unsqueeze(0).unsqueeze(0)
    else:
        m = m.reshape(-1, 1, m.shape[-2], m.shape[-1])

    if _has_list_param(radius):
        frames = []
        for i in range(m.shape[0]):
            ri = _scalar(radius, int, index=i)
            ri = max(0, ri)
            if ri == 0:
                frames.append(m[i:i+1, 0, :, :])
                continue
            ki = 2 * ri + 1
            if str(op).lower().startswith("dil"):
                frames.append(torch.nn.functional.max_pool2d(m[i:i+1], kernel_size=ki, stride=1, padding=ri)[:, 0, :, :])
            else:
                frames.append(-torch.nn.functional.max_pool2d(-m[i:i+1], kernel_size=ki, stride=1, padding=ri)[:, 0, :, :])
        return torch.cat(frames, dim=0).clamp(0, 1)
    r = _scalar(max(0, _scalar(radius, int)), int)
    if r == 0:
        return m[:,0,:,:]
    k = 2*r + 1
    if str(op).lower().startswith("dil"):
        out = torch.nn.functional.max_pool2d(m, kernel_size=k, stride=1, padding=r)
    else:
        out = -torch.nn.functional.max_pool2d(-m, kernel_size=k, stride=1, padding=r)
    return out[:,0,:,:].clamp(0,1)

def _apply_glow(image: torch.Tensor, threshold, radius, sigma, intensity):
    if _has_list_param(threshold, radius, sigma, intensity):
        return torch.cat([
            _apply_glow(image[i:i+1],
                         _scalar(threshold, index=i), _scalar(radius, int, index=i),
                         _scalar(sigma, index=i), _scalar(intensity, index=i))
            for i in range(image.shape[0])
        ], dim=0)
    x = image.float().clamp(0,1)
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr*rgb[...,0] + lg*rgb[...,1] + lb*rgb[...,2]).unsqueeze(-1)
    mask = (luma - _scalar(threshold)).clamp(0,1)
    glow = rgb * mask
    glow4 = torch.cat([glow, torch.ones_like(mask)], dim=-1) if x.shape[-1]==4 else glow
    glow_blur = _apply_blur(glow4, _scalar(radius, int), _scalar(max(EPSILON, _scalar(sigma))))
    g_rgb = glow_blur[..., :3]
    out_rgb = (rgb + g_rgb * _scalar(intensity)).clamp(0,1)
    if x.shape[-1]==4:
        return torch.cat([out_rgb, x[...,3:4]], dim=-1)
    return out_rgb

def _crop_pad(image: torch.Tensor, x: int, y: int, w: int, h: int, pad: int, pad_mode: str):
    # image [B,H,W,C]
    B,H,W,C = image.shape
    x0 = _scalar(x, int); y0 = _scalar(y, int); w = _scalar(w, int); h = _scalar(h, int); pad = _scalar(pad, int)
    x1 = x0 + w; y1 = y0 + h
    # pad as needed
    left = max(0, -x0); top = max(0, -y0); right = max(0, x1 - W); bottom = max(0, y1 - H)
    x0c = max(0, x0); y0c = max(0, y0); x1c = min(W, x1); y1c = min(H, y1)
    cropped = image[:, y0c:y1c, x0c:x1c, :]
    if left or top or right or bottom:
        t = cropped.permute(0,3,1,2).contiguous()
        mode = str(pad_mode).lower()
        if mode not in ("reflect","replicate","constant"):
            mode = "reflect"
        if mode == "replicate":
            mode = "replicate"
        elif mode == "constant":
            mode = "constant"
        else:
            mode = "reflect"
        t = torch.nn.functional.pad(t, (left,right,top,bottom), mode=mode)
        cropped = t.permute(0,2,3,1).contiguous()
    if pad>0:
        t = cropped.permute(0,3,1,2).contiguous()
        t = torch.nn.functional.pad(t, (pad,pad,pad,pad), mode="reflect")
        cropped = t.permute(0,2,3,1).contiguous()
    return cropped

def _resize(image: torch.Tensor, out_w: int, out_h: int, mode: str = "bilinear", antialias: bool = False):
    x = image.permute(0,3,1,2).contiguous()
    resize_mode = str(mode or "bilinear").lower()
    if resize_mode not in ("nearest", "bilinear", "bicubic"):
        resize_mode = "bilinear"
    kwargs = {
        "size": (int(out_h), int(out_w)),
        "mode": resize_mode,
    }
    if resize_mode in ("bilinear", "bicubic"):
        kwargs["align_corners"] = False
        if antialias:
            kwargs["antialias"] = True
    try:
        x = torch.nn.functional.interpolate(x, **kwargs)
    except TypeError:
        kwargs.pop("antialias", None)
        x = torch.nn.functional.interpolate(x, **kwargs)
    return x.permute(0,2,3,1).contiguous().clamp(0,1)


def _premultiply_rgba(image: torch.Tensor) -> torch.Tensor:
    rgba = _ensure_rgba(image.float().clamp(0.0, 1.0))
    alpha = rgba[..., 3:4].clamp(0.0, 1.0)
    return torch.cat([rgba[..., :3] * alpha, alpha], dim=-1).clamp(0.0, 1.0)


def _unpremultiply_rgba(image: torch.Tensor) -> torch.Tensor:
    rgba = _ensure_rgba(image.float().clamp(0.0, 1.0))
    alpha = rgba[..., 3:4].clamp(0.0, 1.0)
    safe_alpha = torch.where(alpha > EPSILON, alpha, torch.ones_like(alpha))
    rgb = torch.where(alpha > EPSILON, rgba[..., :3] / safe_alpha, torch.zeros_like(rgba[..., :3]))
    return torch.cat([rgb.clamp(0.0, 1.0), alpha], dim=-1)


def _resize_premultiplied_rgba(image: torch.Tensor, out_w: int, out_h: int) -> torch.Tensor:
    return _unpremultiply_rgba(_resize(_premultiply_rgba(image), out_w, out_h))


def _rotate_premultiplied_rgba(image: torch.Tensor, rotate_deg) -> torch.Tensor:
    angle = float(_scalar(rotate_deg))
    if abs(angle) <= EPSILON:
        return image
    device = image.device
    dtype = image.dtype
    premult = _premultiply_rgba(image)
    frames = []
    for pil in _tensor_batch_to_pil_list(premult.float().clamp(0.0, 1.0)):
        frames.append(_pil_to_tensor(pil.rotate(-angle, resample=Image.BICUBIC, expand=True)))
    return _unpremultiply_rgba(torch.cat(frames, dim=0).to(device=device, dtype=dtype).clamp(0.0, 1.0))


def _apply_external_mask_to_rgba(image: torch.Tensor, mask: torch.Tensor | None) -> torch.Tensor:
    rgba = _ensure_rgba(image.float().clamp(0.0, 1.0))
    if mask is None:
        return rgba
    prepared_mask = _prepare_mask_tensor(
        mask,
        batch=rgba.shape[0],
        height=rgba.shape[1],
        width=rgba.shape[2],
        device=rgba.device,
        dtype=rgba.dtype,
    )
    if prepared_mask is None:
        return rgba
    if torch.all(prepared_mask >= 1.0 - EPSILON):
        return rgba
    matte = prepared_mask.unsqueeze(-1).clamp(0.0, 1.0)
    rgba[..., 3:4] = rgba[..., 3:4] * matte
    return rgba.clamp(0.0, 1.0)

def _resolve_aspect_ratio(aspect_ratio: str, out_w: int, out_h: int) -> float:
    preset = ASPECT_RATIO_PRESETS.get(str(aspect_ratio).lower() if isinstance(aspect_ratio, str) else str(aspect_ratio))
    if preset is not None:
        return float(preset[0]) / float(max(1, preset[1]))
    return float(max(1, out_w)) / float(max(1, out_h))

def _compute_crop_box(source_w: int, source_h: int, aspect_ratio: str, out_w: int, out_h: int,
                      center_x: float = 0.5, center_y: float = 0.5, scale: float = 1.0):
    src_w = max(1, _scalar(source_w, int))
    src_h = max(1, _scalar(source_h, int))
    target_ratio = max(EPSILON, _resolve_aspect_ratio(aspect_ratio, out_w, out_h))
    src_ratio = float(src_w) / float(max(1, src_h))

    if abs(src_ratio - target_ratio) <= EPSILON:
        base_w = src_w
        base_h = src_h
    elif src_ratio > target_ratio:
        base_h = src_h
        base_w = max(1, min(src_w, int(round(src_h * target_ratio))))
    else:
        base_w = src_w
        base_h = max(1, min(src_h, int(round(src_w / target_ratio))))

    safe_scale = _scalar(max(0.05, min(1.0, _scalar(scale))))
    crop_w = max(1, min(src_w, int(round(base_w * safe_scale))))
    crop_h = max(1, min(src_h, int(round(base_h * safe_scale))))

    safe_center_x = _scalar(max(0.0, min(1.0, _scalar(center_x))))
    safe_center_y = _scalar(max(0.0, min(1.0, _scalar(center_y))))
    center_px = safe_center_x * float(src_w)
    center_py = safe_center_y * float(src_h)

    min_cx = crop_w / 2.0
    max_cx = float(src_w) - crop_w / 2.0
    min_cy = crop_h / 2.0
    max_cy = float(src_h) - crop_h / 2.0

    if max_cx < min_cx:
        center_px = float(src_w) / 2.0
    else:
        center_px = min(max(center_px, min_cx), max_cx)
    if max_cy < min_cy:
        center_py = float(src_h) / 2.0
    else:
        center_py = min(max(center_py, min_cy), max_cy)

    crop_x = int(round(center_px - crop_w / 2.0))
    crop_y = int(round(center_py - crop_h / 2.0))
    crop_x = max(0, min(src_w - crop_w, crop_x))
    crop_y = max(0, min(src_h - crop_h, crop_y))
    return crop_x, crop_y, crop_w, crop_h

def _apply_center_crop_resize(image: torch.Tensor, out_w: int, out_h: int, aspect_ratio: str):
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")

    target_w = max(1, _scalar(out_w, int))
    target_h = max(1, _scalar(out_h, int))
    target_ratio = max(EPSILON, _resolve_aspect_ratio(aspect_ratio, target_w, target_h))

    _, src_h, src_w, _ = image.shape
    src_ratio = float(src_w) / float(max(1, src_h))

    if abs(src_ratio - target_ratio) <= EPSILON:
        crop_w = src_w
        crop_h = src_h
    elif src_ratio > target_ratio:
        crop_h = src_h
        crop_w = max(1, min(src_w, int(round(src_h * target_ratio))))
    else:
        crop_w = src_w
        crop_h = max(1, min(src_h, int(round(src_w / target_ratio))))

    crop_x = max(0, (src_w - crop_w) // 2)
    crop_y = max(0, (src_h - crop_h) // 2)
    cropped = image[:, crop_y:crop_y + crop_h, crop_x:crop_x + crop_w, :]
    return _resize(cropped, target_w, target_h, mode="bicubic", antialias=True)

def _apply_interactive_crop_resize(image: torch.Tensor, out_w, out_h, aspect_ratio: str,
                                   center_x=0.5, center_y=0.5, scale=1.0,
                                   resize_mode: str = "bicubic", antialias: bool = True):
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")

    if _has_list_param(out_w, out_h, aspect_ratio, center_x, center_y, scale):
        return torch.cat([
            _apply_interactive_crop_resize(
                image[i:i+1],
                _scalar(out_w, int, index=i), _scalar(out_h, int, index=i),
                _scalar(aspect_ratio, str, index=i),
                center_x=_scalar(center_x, index=i),
                center_y=_scalar(center_y, index=i),
                scale=_scalar(scale, index=i),
                resize_mode=resize_mode,
                antialias=antialias,
            )
            for i in range(image.shape[0])
        ], dim=0)

    target_w = max(1, _scalar(out_w, int))
    target_h = max(1, _scalar(out_h, int))
    _, src_h, src_w, _ = image.shape
    crop_x, crop_y, crop_w, crop_h = _compute_crop_box(
        src_w,
        src_h,
        aspect_ratio,
        target_w,
        target_h,
        center_x=center_x,
        center_y=center_y,
        scale=scale,
    )
    cropped = image[:, crop_y:crop_y + crop_h, crop_x:crop_x + crop_w, :]
    return _resize(cropped, target_w, target_h, mode=resize_mode, antialias=antialias)


def _apply_interactive_crop_resize_with_mask_pair(image: torch.Tensor, mask: torch.Tensor, out_w: int, out_h: int,
                                                  aspect_ratio: str, center_x: float = 0.5,
                                                  center_y: float = 0.5, scale: float = 1.0):
    if image is None:
        raise ValueError("image is None")
    prepared_mask = _prepare_mask_tensor(
        mask,
        batch=image.shape[0],
        height=image.shape[1],
        width=image.shape[2],
        device=image.device,
        dtype=image.dtype,
    )
    if prepared_mask is None:
        raise ValueError("mask is None")

    source = image.float().clamp(0.0, 1.0)
    cropped_mask = _apply_interactive_crop_resize(
        prepared_mask.unsqueeze(-1),
        out_w,
        out_h,
        aspect_ratio,
        center_x=center_x,
        center_y=center_y,
        scale=scale,
        resize_mode="bilinear",
        antialias=True,
    )[..., 0].clamp(0.0, 1.0)

    premult_rgb = _apply_interactive_crop_resize(
        source[..., :3] * prepared_mask.unsqueeze(-1),
        out_w,
        out_h,
        aspect_ratio,
        center_x=center_x,
        center_y=center_y,
        scale=scale,
        resize_mode="bicubic",
        antialias=True,
    )[..., :3]
    rgb = _unpremultiply_rgb_by_mask(premult_rgb, cropped_mask)

    if source.shape[-1] >= 4:
        alpha = _apply_interactive_crop_resize(
            source[..., 3:4],
            out_w,
            out_h,
            aspect_ratio,
            center_x=center_x,
            center_y=center_y,
            scale=scale,
            resize_mode="bilinear",
            antialias=True,
        )
        result = torch.cat([rgb, alpha], dim=-1)
    else:
        result = rgb

    return result.clamp(0.0, 1.0), cropped_mask


def _apply_crop_reformat(image: torch.Tensor, x: int, y: int, crop_w: int, crop_h: int, pad: int, pad_mode: str,
                         out_w: int, out_h: int, mode: str):
    x0 = _crop_pad(image, x, y, crop_w, crop_h, pad, pad_mode)
    mode = str(mode).lower()
    if out_w <= 0 or out_h <= 0:
        return x0
    if mode == "stretch":
        return _resize(x0, out_w, out_h, mode="bicubic", antialias=True)
    # fit/fill keep aspect
    B,H,W,C = x0.shape
    scale_fit = min(out_w / max(1,W), out_h / max(1,H))
    scale_fill = max(out_w / max(1,W), out_h / max(1,H))
    s = scale_fit if mode == "fit" else scale_fill
    nw = max(1, int(round(W*s))); nh = max(1, int(round(H*s)))
    xr = _resize(x0, nw, nh, mode="bicubic", antialias=True)
    if mode == "fit":
        # letterbox to out size
        pad_x = max(0, out_w - nw); pad_y = max(0, out_h - nh)
        left = pad_x//2; right = pad_x - left
        top = pad_y//2; bottom = pad_y - top
        t = xr.permute(0,3,1,2).contiguous()
        t = torch.nn.functional.pad(t, (left,right,top,bottom), mode="constant", value=0.0)
        out = t.permute(0,2,3,1).contiguous()
        return out[:, :out_h, :out_w, :].clamp(0,1)
    else:
        # crop center to out size
        y0c = max(0, (nh - out_h)//2)
        x0c = max(0, (nw - out_w)//2)
        return xr[:, y0c:y0c+out_h, x0c:x0c+out_w, :].clamp(0,1)

def _apply_lumakey(image: torch.Tensor, low, high, softness):
    x = image.float().clamp(0,1)
    B = x.shape[0]
    d, dt = x.device, x.dtype
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr*rgb[...,0] + lg*rgb[...,1] + lb*rgb[...,2]).clamp(0,1)  # [B,H,W]
    p_low = _param_tensor(low, B, d, dt).view(B, 1, 1)
    p_high = _param_tensor(high, B, d, dt).view(B, 1, 1)
    p_soft = _param_tensor(softness, B, d, dt).view(B, 1, 1).clamp(min=0.0)
    low1 = p_low - p_soft
    low2 = p_low + p_soft
    high1 = p_high - p_soft
    high2 = p_high + p_soft
    def smoothstep(a, b, t):
        t = ((t - a) / (b - a + EPSILON)).clamp(0, 1)
        return t * t * (3 - 2 * t)
    m_low = smoothstep(low1, low2, luma)
    m_high = 1.0 - smoothstep(high1, high2, luma)
    mask = (m_low * m_high).clamp(0, 1)
    return mask

def _tensor_batch_to_pil_list(images: torch.Tensor):
    if images is None:
        raise ValueError("images is None")
    if images.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(images.shape)}")
    out = []
    b = int(images.shape[0])
    for i in range(b):
        t = images[i:i+1, ...]
        out.append(_tensor_to_pil(t))
    return out


def _hex_to_rgb01(color: str):
    text = str(color or "#000000").strip()
    if text.startswith("#"):
        text = text[1:]
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) != 6 or not all(c in "0123456789abcdefABCDEF" for c in text):
        logger.warning("Invalid hex color '%s'; falling back to black", color)
        text = "000000"
    try:
        return tuple(int(text[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.0, 0.0, 0.0)


def _ensure_rgba(image: torch.Tensor) -> torch.Tensor:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    if image.shape[-1] >= 4:
        return image[..., :4]
    rgb = image[..., :3]
    alpha = torch.ones((*rgb.shape[:3], 1), device=rgb.device, dtype=rgb.dtype)
    return torch.cat([rgb, alpha], dim=-1)


def _expand_image_batch(image: torch.Tensor, target_batch: int) -> torch.Tensor:
    if image.shape[0] == target_batch:
        return image
    if image.shape[0] == 1:
        return image.expand(target_batch, -1, -1, -1)
    reps = math.ceil(target_batch / image.shape[0])
    return image.repeat(reps, 1, 1, 1)[:target_batch]


def _resize_mask(mask: torch.Tensor, out_w: int, out_h: int) -> torch.Tensor:
    if mask is None:
        raise ValueError("mask is None")
    target_w = max(1, _scalar(out_w, int))
    target_h = max(1, _scalar(out_h, int))
    x = mask.unsqueeze(1)
    x = torch.nn.functional.interpolate(
        x,
        size=(target_h, target_w),
        mode="bilinear",
        align_corners=False,
    )
    return x.squeeze(1).contiguous().clamp(0.0, 1.0)


def _soft_light_curve(x: torch.Tensor) -> torch.Tensor:
    return torch.where(
        x <= 0.25,
        ((16.0 * x - 12.0) * x + 4.0) * x,
        torch.sqrt(x.clamp(0.0, 1.0)),
    )


def _blend_rgb(base_rgb: torch.Tensor, top_rgb: torch.Tensor, mode: str) -> torch.Tensor:
    normalized = str(mode or "over").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in ("over", "normal"):
        return top_rgb
    if normalized == "add":
        return (base_rgb + top_rgb).clamp(0.0, 1.0)
    if normalized == "multiply":
        return (base_rgb * top_rgb).clamp(0.0, 1.0)
    if normalized == "screen":
        return (1.0 - (1.0 - base_rgb) * (1.0 - top_rgb)).clamp(0.0, 1.0)
    if normalized == "overlay":
        return torch.where(
            base_rgb <= 0.5,
            2.0 * base_rgb * top_rgb,
            1.0 - 2.0 * (1.0 - base_rgb) * (1.0 - top_rgb),
        ).clamp(0.0, 1.0)
    if normalized == "soft_light":
        return torch.where(
            top_rgb <= 0.5,
            base_rgb - (1.0 - 2.0 * top_rgb) * base_rgb * (1.0 - base_rgb),
            base_rgb + (2.0 * top_rgb - 1.0) * (_soft_light_curve(base_rgb) - base_rgb),
        ).clamp(0.0, 1.0)
    if normalized == "difference":
        return (base_rgb - top_rgb).abs().clamp(0.0, 1.0)
    if normalized == "color_dodge":
        return torch.where(
            top_rgb >= 1.0 - EPSILON,
            torch.ones_like(base_rgb),
            (base_rgb / (1.0 - top_rgb).clamp(min=EPSILON)).clamp(0.0, 1.0),
        )
    if normalized == "color_burn":
        return torch.where(
            top_rgb <= EPSILON,
            torch.zeros_like(base_rgb),
            (1.0 - ((1.0 - base_rgb) / top_rgb.clamp(min=EPSILON))).clamp(0.0, 1.0),
        )
    if normalized == "exclusion":
        return (base_rgb + top_rgb - 2.0 * base_rgb * top_rgb).clamp(0.0, 1.0)
    if normalized in ("lighten", "max"):
        return torch.maximum(base_rgb, top_rgb).clamp(0.0, 1.0)
    if normalized in ("darken", "min"):
        return torch.minimum(base_rgb, top_rgb).clamp(0.0, 1.0)
    return top_rgb.clamp(0.0, 1.0)


def _make_comp_canvas(batch: int, height: int, width: int, device, dtype, background_color: str = "#000000") -> torch.Tensor:
    canvas = torch.empty((batch, height, width, 4), device=device, dtype=dtype)
    rgb = torch.tensor(
        _hex_to_rgb01(background_color),
        device=device,
        dtype=dtype,
    )
    canvas[..., :3] = rgb
    canvas[..., 3] = 0.0
    return canvas


def _compute_comp_rect(output_w: int, output_h: int, source_w: int, source_h: int,
                       center_x: float, center_y: float, scale: float):
    draw_w = max(1, int(round(max(1, _scalar(source_w, int)) * max(0.05, _scalar(scale)))))
    draw_h = max(1, int(round(max(1, _scalar(source_h, int)) * max(0.05, _scalar(scale)))))
    left = int(round(_scalar(center_x) * float(max(1, _scalar(output_w, int))) - draw_w / 2.0))
    top = int(round(_scalar(center_y) * float(max(1, _scalar(output_h, int))) - draw_h / 2.0))
    return left, top, draw_w, draw_h


def _solve_homography_batch(src_points: torch.Tensor, dst_points: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    batch = int(dst_points.shape[0])
    dtype = src_points.dtype
    device = src_points.device
    A = torch.zeros((batch, 8, 8), dtype=dtype, device=device)
    b = torch.zeros((batch, 8), dtype=dtype, device=device)

    x = src_points[:, 0].view(1, 4).expand(batch, 4)
    y = src_points[:, 1].view(1, 4).expand(batch, 4)
    u = dst_points[:, :, 0]
    v = dst_points[:, :, 1]

    A[:, 0::2, 0] = x
    A[:, 0::2, 1] = y
    A[:, 0::2, 2] = 1.0
    A[:, 0::2, 6] = -u * x
    A[:, 0::2, 7] = -u * y
    b[:, 0::2] = u

    A[:, 1::2, 3] = x
    A[:, 1::2, 4] = y
    A[:, 1::2, 5] = 1.0
    A[:, 1::2, 6] = -v * x
    A[:, 1::2, 7] = -v * y
    b[:, 1::2] = v

    try:
        solved, info = torch.linalg.solve_ex(A, b)
        valid = info.eq(0)
    except (AttributeError, RuntimeError):
        try:
            solved = torch.linalg.solve(A, b)
            valid = torch.ones((batch,), device=device, dtype=torch.bool)
        except RuntimeError:
            solved = torch.matmul(torch.linalg.pinv(A), b.unsqueeze(-1)).squeeze(-1)
            valid = torch.isfinite(solved).all(dim=1)

    H = torch.zeros((batch, 3, 3), dtype=dtype, device=device)
    H[:, 0, 0] = solved[:, 0]
    H[:, 0, 1] = solved[:, 1]
    H[:, 0, 2] = solved[:, 2]
    H[:, 1, 0] = solved[:, 3]
    H[:, 1, 1] = solved[:, 4]
    H[:, 1, 2] = solved[:, 5]
    H[:, 2, 0] = solved[:, 6]
    H[:, 2, 1] = solved[:, 7]
    H[:, 2, 2] = 1.0

    valid = valid & torch.isfinite(H).flatten(1).all(dim=1)
    identity = torch.eye(3, dtype=dtype, device=device).expand(batch, 3, 3)
    H = torch.where(valid.view(batch, 1, 1), H, identity)
    return H, valid


def _invert_homography_batch(H: torch.Tensor, valid: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    batch = int(H.shape[0])
    try:
        Hinv, info = torch.linalg.inv_ex(H)
        valid = valid & info.eq(0)
    except (AttributeError, RuntimeError):
        try:
            Hinv = torch.linalg.inv(H)
        except RuntimeError:
            Hinv = torch.linalg.pinv(H)
    valid = valid & torch.isfinite(Hinv).flatten(1).all(dim=1)
    identity = torch.eye(3, dtype=H.dtype, device=H.device).expand(batch, 3, 3)
    Hinv = torch.where(valid.view(batch, 1, 1), Hinv, identity)
    return Hinv, valid


def _build_projective_grid(height: int, width: int, src_h: int, src_w: int, Hinv: torch.Tensor):
    batch = int(Hinv.shape[0])
    device = Hinv.device
    dtype = Hinv.dtype
    ys = torch.linspace(0.0, float(max(0, height - 1)), max(1, int(height)), device=device, dtype=dtype)
    xs = torch.linspace(0.0, float(max(0, width - 1)), max(1, int(width)), device=device, dtype=dtype)
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")
    denom = Hinv[:, 2, 0].view(batch, 1, 1) * xx + Hinv[:, 2, 1].view(batch, 1, 1) * yy + Hinv[:, 2, 2].view(batch, 1, 1)
    safe_sign = torch.where(denom < 0.0, -torch.ones_like(denom), torch.ones_like(denom))
    denom = torch.where(torch.abs(denom) < 1e-8, safe_sign * 1e-8, denom)
    src_x = (Hinv[:, 0, 0].view(batch, 1, 1) * xx + Hinv[:, 0, 1].view(batch, 1, 1) * yy + Hinv[:, 0, 2].view(batch, 1, 1)) / denom
    src_y = (Hinv[:, 1, 0].view(batch, 1, 1) * xx + Hinv[:, 1, 1].view(batch, 1, 1) * yy + Hinv[:, 1, 2].view(batch, 1, 1)) / denom
    norm_x = (src_x / float(max(1, src_w - 1))) * 2.0 - 1.0 if src_w > 1 else torch.zeros_like(src_x)
    norm_y = (src_y / float(max(1, src_h - 1))) * 2.0 - 1.0 if src_h > 1 else torch.zeros_like(src_y)
    grid = torch.stack([norm_x, norm_y], dim=-1)
    inside = (src_x >= 0.0) & (src_x <= float(max(0, src_w - 1))) & (src_y >= 0.0) & (src_y <= float(max(0, src_h - 1)))
    return grid, inside.unsqueeze(-1).to(dtype=dtype)


def _resolve_comp_layer_points(output_w: int, output_h: int, source_w: int, source_h: int,
                               center_x, center_y, scale, rotate_deg,
                               tl_x=None, tl_y=None, tr_x=None, tr_y=None, bl_x=None, bl_y=None, br_x=None, br_y=None,
                               device=None, dtype=None) -> torch.Tensor:
    max_x = float(max(1, output_w - 1))
    max_y = float(max(1, output_h - 1))
    explicit = all(value is not None for value in (tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y))
    if explicit:
        values = [
            [_scalar(tl_x) * max_x, _scalar(tl_y) * max_y],
            [_scalar(tr_x) * max_x, _scalar(tr_y) * max_y],
            [_scalar(bl_x) * max_x, _scalar(bl_y) * max_y],
            [_scalar(br_x) * max_x, _scalar(br_y) * max_y],
        ]
        return torch.tensor(values, device=device, dtype=dtype)

    _, _, draw_w, draw_h = _compute_comp_rect(output_w, output_h, source_w, source_h, center_x, center_y, scale)
    center_px = _scalar(center_x) * float(max(1, output_w))
    center_py = _scalar(center_y) * float(max(1, output_h))
    angle = math.radians(float(_scalar(rotate_deg)))
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)

    def _corner(local_x: float, local_y: float) -> tuple[float, float]:
        return (
            center_px + local_x * cos_a - local_y * sin_a,
            center_py + local_x * sin_a + local_y * cos_a,
        )

    half_w = draw_w / 2.0
    half_h = draw_h / 2.0
    return torch.tensor([
        _corner(-half_w, -half_h),
        _corner(half_w, -half_h),
        _corner(-half_w, half_h),
        _corner(half_w, half_h),
    ], device=device, dtype=dtype)


def _warp_comp_layer_to_canvas(source: torch.Tensor, out_h: int, out_w: int, dst_points: torch.Tensor) -> torch.Tensor:
    batch = int(source.shape[0])
    source_h = int(source.shape[1])
    source_w = int(source.shape[2])
    src_points = torch.tensor(
        [[0.0, 0.0], [float(max(0, source_w - 1)), 0.0], [0.0, float(max(0, source_h - 1))], [float(max(0, source_w - 1)), float(max(0, source_h - 1))]],
        device=source.device,
        dtype=source.dtype,
    )
    H, valid = _solve_homography_batch(src_points, dst_points.view(batch, 4, 2))
    Hinv, valid = _invert_homography_batch(H, valid)
    grid, inside = _build_projective_grid(out_h, out_w, source_h, source_w, Hinv)
    premult = _premultiply_rgba(source).permute(0, 3, 1, 2).contiguous()
    warped = torch.nn.functional.grid_sample(premult, grid, mode="bilinear", padding_mode="zeros", align_corners=True)
    result = _unpremultiply_rgba(warped.permute(0, 2, 3, 1).contiguous()).clamp(0.0, 1.0)
    alpha = result[..., 3:4] * inside
    result[..., 3:4] = alpha.clamp(0.0, 1.0)
    return result.clamp(0.0, 1.0)


def _composite_comp_layer(canvas: torch.Tensor, image: torch.Tensor, mask: torch.Tensor | None,
                          mode: str, opacity, center_x, center_y, scale, rotate_deg=0.0,
                          tl_x=None, tl_y=None, tr_x=None, tr_y=None, bl_x=None, bl_y=None, br_x=None, br_y=None) -> torch.Tensor:
    if canvas is None:
        raise ValueError("canvas is None")
    if image is None:
        raise ValueError("image is None")

    if _has_list_param(opacity, center_x, center_y, scale, rotate_deg, tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y):
        batch = canvas.shape[0]
        source = _ensure_rgba(_expand_image_batch(image.float().clamp(0.0, 1.0), batch))
        source = _apply_external_mask_to_rgba(source, mask)
        for i in range(batch):
            canvas[i:i+1] = _composite_comp_layer(
                canvas[i:i+1], source[i:i+1], None, mode,
                _scalar(opacity, index=i), _scalar(center_x, index=i),
                _scalar(center_y, index=i), _scalar(scale, index=i), _scalar(rotate_deg, index=i),
                _scalar(tl_x, index=i) if tl_x is not None else None,
                _scalar(tl_y, index=i) if tl_y is not None else None,
                _scalar(tr_x, index=i) if tr_x is not None else None,
                _scalar(tr_y, index=i) if tr_y is not None else None,
                _scalar(bl_x, index=i) if bl_x is not None else None,
                _scalar(bl_y, index=i) if bl_y is not None else None,
                _scalar(br_x, index=i) if br_x is not None else None,
                _scalar(br_y, index=i) if br_y is not None else None,
            )
        return canvas

    batch, out_h, out_w, _ = canvas.shape
    source = _ensure_rgba(_expand_image_batch(image.float().clamp(0.0, 1.0), batch))
    source = _apply_external_mask_to_rgba(source, mask)
    source_h = int(source.shape[1])
    source_w = int(source.shape[2])
    has_quad = all(value is not None for value in (tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y))
    if has_quad:
        dst_points = _resolve_comp_layer_points(
            out_w, out_h, source_w, source_h,
            center_x, center_y, scale, rotate_deg,
            tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y,
            device=source.device,
            dtype=source.dtype,
        ).unsqueeze(0).expand(batch, -1, -1)
        warped = _warp_comp_layer_to_canvas(source, out_h, out_w, dst_points)
        alpha_region = (warped[..., 3:4] * _scalar(max(0.0, min(1.0, _scalar(opacity))))).clamp(0.0, 1.0)
        blended_rgb = _blend_rgb(canvas[..., :3], warped[..., :3], mode)
        out_rgb = canvas[..., :3] * (1.0 - alpha_region) + blended_rgb * alpha_region
        out_alpha = alpha_region + canvas[..., 3:4] * (1.0 - alpha_region)
        canvas[...] = torch.cat([out_rgb, out_alpha], dim=-1).clamp(0.0, 1.0)
        return canvas

    _, _, draw_w, draw_h = _compute_comp_rect(out_w, out_h, source_w, source_h, center_x, center_y, scale)
    center_px = _scalar(center_x) * float(max(1, out_w))
    center_py = _scalar(center_y) * float(max(1, out_h))

    rotated_source = _rotate_premultiplied_rgba(_resize_premultiplied_rgba(source, draw_w, draw_h), rotate_deg)
    place_h = int(rotated_source.shape[1])
    place_w = int(rotated_source.shape[2])
    left = int(round(center_px - place_w / 2.0))
    top = int(round(center_py - place_h / 2.0))

    x0 = max(0, left)
    y0 = max(0, top)
    x1 = min(out_w, left + place_w)
    y1 = min(out_h, top + place_h)
    if x1 <= x0 or y1 <= y0:
        return canvas

    effective_alpha = rotated_source[..., 3]

    effective_alpha = (effective_alpha * _scalar(max(0.0, min(1.0, _scalar(opacity))))).clamp(0.0, 1.0)
    src_x0 = x0 - left
    src_y0 = y0 - top
    src_x1 = src_x0 + (x1 - x0)
    src_y1 = src_y0 + (y1 - y0)

    dst_region = canvas[:, y0:y1, x0:x1, :]
    src_region = rotated_source[:, src_y0:src_y1, src_x0:src_x1, :3]
    alpha_region = effective_alpha[:, src_y0:src_y1, src_x0:src_x1].unsqueeze(-1)

    blended_rgb = _blend_rgb(dst_region[..., :3], src_region, mode)
    out_rgb = dst_region[..., :3] * (1.0 - alpha_region) + blended_rgb * alpha_region
    out_alpha = alpha_region + dst_region[..., 3:4] * (1.0 - alpha_region)
    canvas[:, y0:y1, x0:x1, :] = torch.cat([out_rgb, out_alpha], dim=-1).clamp(0.0, 1.0)
    return canvas
