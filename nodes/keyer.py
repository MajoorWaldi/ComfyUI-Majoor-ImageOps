import torch

from ._helpers import (
    EPSILON,
    LUMA_WEIGHTS,
    MEDIA_INPUT_TYPE,
    _blur_mask,
    _param_tensor,
    _prepare_effect_mask,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress


def _hex_to_rgb(value: str) -> tuple[float, float, float]:
    raw = str(value or "#00ff00").strip()
    if raw.startswith("#"):
        raw = raw[1:]
    if len(raw) == 3:
        raw = "".join(ch * 2 for ch in raw)
    if len(raw) != 6:
        raw = "00ff00"
    try:
        return tuple(int(raw[i : i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        return (0.0, 1.0, 0.0)


def _parse_key_colors(value) -> list[tuple[float, float, float]]:
    raw = str(value or "").strip()
    if not raw:
        return []
    try:
        import json

        parsed = json.loads(raw)
    except Exception:
        parsed = None
    if not isinstance(parsed, list):
        return []
    colors: list[tuple[float, float, float]] = []
    for item in parsed:
        if isinstance(item, str):
            colors.append(_hex_to_rgb(item))
    return colors


def _soft_threshold(distance: torch.Tensor, tolerance, softness, batch: int) -> torch.Tensor:
    tolerance_t = _param_tensor(tolerance, batch, distance.device, distance.dtype).view(batch, 1, 1).clamp(0.0, 1.0)
    softness_t = _param_tensor(softness, batch, distance.device, distance.dtype).view(batch, 1, 1).clamp(0.0, 1.0)
    edge0 = tolerance_t
    edge1 = (tolerance_t + softness_t).clamp_max(1.0)
    hard = (distance <= edge0).to(distance.dtype)
    t = ((edge1 - distance) / (edge1 - edge0).clamp_min(EPSILON)).clamp(0.0, 1.0)
    soft = t * t * (3.0 - 2.0 * t)
    return torch.where(softness_t > EPSILON, soft, hard).clamp(0.0, 1.0)


def _apply_matte_gain_and_blur(matte: torch.Tensor, gain, blur) -> torch.Tensor:
    batch = matte.shape[0]
    gain_t = _param_tensor(gain, batch, matte.device, matte.dtype).view(batch, 1, 1).clamp_min(0.0)
    boosted = (matte * gain_t).clamp(0.0, 1.0)

    blur_radius = int(max(0, round(_scalar(blur, float))))
    if blur_radius <= 0:
        return boosted
    sigma = max(EPSILON, blur_radius / 3.0)
    return _blur_mask(boosted, blur_radius, sigma, blur_type="gaussian").clamp(0.0, 1.0)


def _apply_keyer(
    image: torch.Tensor,
    mode="color",
    key_color="#00ff00",
    key_colors="",
    tolerance=0.25,
    softness=0.1,
    gain=1.0,
    blur=0.0,
    invert=False,
    mask=None,
) -> tuple[torch.Tensor, torch.Tensor]:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")

    source = image.float()
    batch = source.shape[0]
    rgb_for_key = source[..., :3].clamp(0.0, 1.0)
    mode_value = str(mode or "color").strip().lower()

    if mode_value in ("luma", "luminance"):
        weights = torch.tensor(LUMA_WEIGHTS, device=rgb_for_key.device, dtype=rgb_for_key.dtype)
        distance = (rgb_for_key * weights).sum(dim=-1).clamp(0.0, 1.0)
    else:
                colors = _parse_key_colors(key_colors)
                if not colors:
                    colors = [_hex_to_rgb(key_color)]
                targets = torch.tensor(colors, device=rgb_for_key.device, dtype=rgb_for_key.dtype).view(1, 1, 1, len(colors), 3)
                rgb_expanded = rgb_for_key.unsqueeze(-2)
                distance = torch.linalg.vector_norm(rgb_expanded - targets, dim=-1).amin(dim=-1) / (3.0 ** 0.5)

    matte = 1.0 - _soft_threshold(distance, tolerance, softness, batch)
    matte = _apply_matte_gain_and_blur(matte, gain, blur)
    if mask is not None:
        matte = matte * mask.to(device=source.device, dtype=source.dtype).clamp(0.0, 1.0)
    if _scalar(invert, bool):
        matte = 1.0 - matte

    if source.shape[-1] >= 4:
        alpha = (source[..., 3] * matte).unsqueeze(-1)
        out = torch.cat([source[..., :3], alpha, source[..., 4:]], dim=-1) if source.shape[-1] > 4 else torch.cat([source[..., :3], alpha], dim=-1)
    else:
        out = torch.cat([source[..., :3], matte.unsqueeze(-1)], dim=-1)
    return out.to(dtype=image.dtype), matte.to(dtype=image.dtype)


class ImageOpsKeyer(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsKeyer",
            display_name="〽️ ImageOps Keyer",
            category="image/imageops",
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Combo.Input("mode", options=["color", "luma"], default="color"),
                io.Color.Input("key_color", default="#00ff00"),
                io.String.Input("key_colors", default="", multiline=False),
                io.Float.Input("tolerance", default=0.25, min=0.0, max=1.0, step=0.01),
                io.Float.Input("softness", default=0.10, min=0.0, max=1.0, step=0.01),
                io.Float.Input("gain", default=1.0, min=0.0, max=4.0, step=0.01),
                io.Float.Input("blur", default=0.0, min=0.0, max=64.0, step=0.1),
                io.Boolean.Input("invert", default=False),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], optional=True, display_name="Images/Video", tooltip="Images/Video input. Accepts IMAGE batches and VIDEO frame sources."),
                io.Mask.Input("mask", optional=True, tooltip="Optional matte multiplied into the key."),
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
        mode: str = "color",
        key_color: str = "#00ff00",
        key_colors: str = "",
        tolerance: float = 0.25,
        softness: float = 0.1,
        gain: float = 1.0,
        blur: float = 0.0,
        invert: bool = False,
        invert_mask: bool = False,
        image=None,
        video=None,
        mask=None,
        unique_id=None,
        **_legacy
    ):
        source = _select_media_tensor(image, video)
        progress = start_progress(unique_id=unique_id)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        if _scalar(bypass, bool):
            alpha = source[..., 3] if source.shape[-1] >= 4 else torch.ones(source.shape[:3], device=source.device, dtype=source.dtype)
            progress.finish()
            return build_node_preview_result(source, (source, alpha), prefix="imageops_keyer")
        result, matte = _apply_keyer(source, mode, key_color, key_colors, tolerance, softness, gain, blur, invert, effect_mask)
        progress.finish()
        return build_node_preview_result(result, (result, matte), prefix="imageops_keyer")
