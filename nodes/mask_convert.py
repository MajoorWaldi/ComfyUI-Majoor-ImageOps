import torch

from ._helpers import (
    EPSILON,
    LUMA_WEIGHTS,
    MEDIA_INPUT_TYPE,
    _apply_blur,
    _coerce_mask_tensor,
    _has_list_param,
    _mask_to_preview_image,
    _param_tensor,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress


def _mask_source_channel(image: torch.Tensor, source: str) -> torch.Tensor:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")

    normalized = str(source or "auto").strip().lower().replace("-", "_").replace(" ", "_")
    if image.shape[-1] >= 4:
        alpha = image[..., 3].float().clamp(0.0, 1.0)
        if normalized == "alpha":
            return alpha
        if normalized == "auto" and float((alpha.max() - alpha.min()).detach().cpu().item()) > 1e-6:
            return alpha
        if normalized == "auto" and float((1.0 - alpha).abs().max().detach().cpu().item()) > 1e-6:
            return alpha
    elif normalized == "alpha":
        return torch.ones((image.shape[0], image.shape[1], image.shape[2]), device=image.device, dtype=image.dtype)

    rgb = image[..., :3].float().clamp(0.0, 1.0)
    if normalized in ("red", "r"):
        return rgb[..., 0]
    if normalized in ("green", "g"):
        return rgb[..., 1]
    if normalized in ("blue", "b"):
        return rgb[..., 2]
    if normalized in ("max_rgb", "max", "value", "v"):
        return rgb.max(dim=-1).values
    if normalized in ("min_rgb", "min"):
        return rgb.min(dim=-1).values
    if normalized in ("saturation", "sat", "chroma"):
        max_rgb = rgb.max(dim=-1).values
        min_rgb = rgb.min(dim=-1).values
        return torch.where(max_rgb > EPSILON, (max_rgb - min_rgb) / max_rgb.clamp_min(EPSILON), torch.zeros_like(max_rgb))

    weights = torch.tensor(LUMA_WEIGHTS, device=rgb.device, dtype=rgb.dtype)
    return (rgb * weights).sum(dim=-1).clamp(0.0, 1.0)


def _apply_mask_points(mask: torch.Tensor, black_point, white_point) -> torch.Tensor:
    batch = mask.shape[0]
    black = _param_tensor(black_point, batch, mask.device, mask.dtype).view(batch, 1, 1)
    white = _param_tensor(white_point, batch, mask.device, mask.dtype).view(batch, 1, 1)
    white = torch.maximum(white, black + EPSILON)
    return ((mask - black) / (white - black)).clamp(0.0, 1.0)


def _antialias_mask(mask: torch.Tensor, antialias_radius) -> torch.Tensor:
    radius_value = float(_scalar(antialias_radius))
    if radius_value <= 0.0:
        return mask
    radius = max(1, int(round(radius_value)))
    sigma = max(0.2, radius_value * 0.5)
    return _apply_blur(mask.unsqueeze(-1), radius, sigma).squeeze(-1).clamp(0.0, 1.0)


def _image_to_mask(
    image: torch.Tensor,
    mask_source="auto",
    black_point=0.0,
    white_point=1.0,
    antialias_radius=0.0,
) -> torch.Tensor:
    if _has_list_param(mask_source, black_point, white_point, antialias_radius):
        return torch.cat([
            _image_to_mask(
                image[i:i + 1],
                _scalar(mask_source, str, index=i),
                _scalar(black_point, index=i),
                _scalar(white_point, index=i),
                _scalar(antialias_radius, index=i),
            )
            for i in range(image.shape[0])
        ], dim=0)

    mask = _mask_source_channel(image, mask_source)
    mask = _antialias_mask(mask, antialias_radius)
    return _apply_mask_points(mask, black_point, white_point).clamp(0.0, 1.0)


class ImageOpsMaskConvert(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsMaskConvert",
            display_name="〽️ ImageOps Mask Convert",
            category="image/imageops",
            search_aliases=['mask convert', 'mask', 'matte', 'alpha', 'luma matte', 'image to mask', 'mask to image'], inputs=[
                io.Boolean.Input("reverse", default=False, label_on="image -> mask", label_off="mask -> image"),
                io.Combo.Input("mask_source", options=["auto", "luma", "max_rgb", "saturation", "red", "green", "blue", "alpha"], default="auto"),
                io.Float.Input("black_point", default=0.0, min=0.0, max=1.0, step=0.01),
                io.Float.Input("white_point", default=1.0, min=0.0, max=1.0, step=0.01),
                io.Float.Input("antialias_radius", default=0.0, min=0.0, max=4.0, step=0.1),
                io.MultiType.Input("image", types=[io.Image, io.Video], optional=True, display_name="Images/Video", tooltip="Images/Video input used when reverse is enabled."),
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
        reverse: bool = False,
        mask_source: str = "auto",
        black_point: float = 0.0,
        white_point: float = 1.0,
        antialias_radius: float = 0.0,
        image=None,
        video=None,
        mask=None,
        unique_id=None,
    ):
        progress = start_progress(unique_id=unique_id)

        if _scalar(reverse, bool):
            source = _select_media_tensor(image, video)
            output_mask = _image_to_mask(source, mask_source, black_point, white_point, antialias_radius)
            output_image = _mask_to_preview_image(output_mask, device=source.device, dtype=source.dtype)
        else:
            output_mask = _coerce_mask_tensor(mask)
            if output_mask is None:
                raise ValueError("ImageOps Mask Convert requires a mask input when reverse is disabled.")
            output_image = _mask_to_preview_image(output_mask)

        progress.finish()
        return build_node_preview_result(output_image, (output_image, output_mask), prefix="imageops_mask_convert")
