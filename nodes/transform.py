import numpy as np
import torch
from PIL import Image

from ._helpers import (
    MEDIA_INPUT_TYPE,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _pil_to_tensor,
    _select_media_tensor,
    _tensor_batch_to_pil_list,
    _unpremultiply_rgb_by_mask,
    EPSILON,
    LARGE_IMAGE_WARN_MB,
    MAX_SCALE_DIMENSION,
    _scalar,
    logger,
)
from ._preview import build_node_preview_result


def _mask_to_pil(mask_frame: torch.Tensor) -> Image.Image:
    array = (mask_frame.detach().cpu().float().clamp(0, 1).numpy() * 255.0 + 0.5).astype("uint8")
    return Image.fromarray(array, mode="L")


def _pil_to_mask(pil: Image.Image, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    arr = np.asarray(pil, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0).to(device=device, dtype=dtype)


def _transform_masked_source(source, input_mask, resample, translate_x, translate_y, rotate_deg, scale, expand):
    premult_rgb = source[..., :3].float().clamp(0.0, 1.0) * input_mask.unsqueeze(-1)
    processed_rgb = []
    processed_mask = []
    processed_alpha = []

    for fi, pil in enumerate(_tensor_batch_to_pil_list(premult_rgb)):
        tx, ty = _scalar(translate_x, index=fi), _scalar(translate_y, index=fi)
        rd, sc = _scalar(rotate_deg, index=fi), _scalar(scale, index=fi)
        processed_rgb.append(_pil_to_tensor(_transform_frame(pil, resample, tx, ty, rd, sc, expand))[..., :3])

    for idx in range(input_mask.shape[0]):
        tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
        rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
        pil_mask = _mask_to_pil(input_mask[idx])
        processed_mask.append(_pil_to_mask(_transform_frame(pil_mask, resample, tx, ty, rd, sc, expand), source.device, source.dtype))

    if source.shape[-1] >= 4:
        for idx in range(source.shape[0]):
            tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
            rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
            pil_alpha = _mask_to_pil(source[idx, ..., 3])
            processed_alpha.append(_pil_to_mask(_transform_frame(pil_alpha, resample, tx, ty, rd, sc, expand), source.device, source.dtype))

    if not processed_rgb:
        raise ValueError("ImageOpsTransform received an empty image batch.")

    output_mask = torch.cat(processed_mask, dim=0).to(device=source.device, dtype=source.dtype)
    rgb = _unpremultiply_rgb_by_mask(
        torch.cat(processed_rgb, dim=0).to(device=source.device, dtype=source.dtype),
        output_mask,
    )
    if processed_alpha:
        alpha = torch.cat(processed_alpha, dim=0).unsqueeze(-1).to(device=source.device, dtype=source.dtype)
        result = torch.cat([rgb, alpha], dim=-1)
    else:
        result = rgb
    return result.clamp(0.0, 1.0), output_mask.clamp(0.0, 1.0)


def _transform_frame(pil, resample, translate_x, translate_y, rotate_deg, scale, expand):
    """Transform a single PIL image. All params must be scalars (unwrapped by caller)."""
    base_w, base_h = pil.size
    working = pil

    scale = _scalar(scale)
    translate_x = _scalar(translate_x)
    translate_y = _scalar(translate_y)
    rotate_deg = _scalar(rotate_deg)
    if abs(scale - 1.0) > EPSILON:
        nw, nh = max(1, int(round(base_w * scale))), max(1, int(round(base_h * scale)))
        if nw > MAX_SCALE_DIMENSION or nh > MAX_SCALE_DIMENSION:
            logger.error(f"Scaled dimensions ({nw}x{nh}) exceed maximum ({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION})")
            raise ValueError(
                f"Resulting image size ({nw}x{nh}) would exceed maximum allowed dimensions "
                f"({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION}). "
                f"Original: {base_w}x{base_h}, Scale: {scale:.2f}"
            )

        estimated_mb = (nw * nh * 4) / (1024 * 1024)
        if estimated_mb > float(LARGE_IMAGE_WARN_MB):
            logger.warning(f"Large image allocation: {nw}x{nh} (~{estimated_mb:.1f} MB) > {LARGE_IMAGE_WARN_MB} MB")

        working = working.resize((nw, nh), resample=resample)

    if abs(rotate_deg) > EPSILON:
        # Match compositor conventions used in Nuke/UI overlays: positive values rotate clockwise.
        working = working.rotate(-rotate_deg, resample=resample, expand=_scalar(expand, bool))
        rw, rh = working.size
        if rw > MAX_SCALE_DIMENSION or rh > MAX_SCALE_DIMENSION:
            logger.error(f"Rotated dimensions ({rw}x{rh}) exceed maximum")
            raise ValueError(f"Rotated image size ({rw}x{rh}) exceeds maximum ({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION})")

    mode = working.mode
    if mode == "RGBA":
        bg = (0, 0, 0, 0)
    elif mode == "RGB":
        bg = (0, 0, 0)
    else:
        bg = 0
    output = Image.new(mode, (base_w, base_h), bg)
    paste_x = int(round((base_w - working.size[0]) / 2.0 + translate_x))
    paste_y = int(round((base_h - working.size[1]) / 2.0 + translate_y))
    if mode == "RGBA":
        output.paste(working, (paste_x, paste_y), working)
    else:
        output.paste(working, (paste_x, paste_y))
    return output


class ImageOpsTransform:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "translate_x": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "translate_y": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "rotate_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 8.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "filter": (["nearest", "bilinear", "bicubic"],),
                "expand": ("BOOLEAN", {"default": False}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, bypass=False, translate_x=0, translate_y=0, rotate_deg=0.0, scale=1.0, filter="bilinear", expand=False, invert_mask=False, video=None, mask=None):
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        if _scalar(bypass, bool):
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_transform")

        resample = {
            "nearest": Image.NEAREST,
            "bilinear": Image.BILINEAR,
            "bicubic": Image.BICUBIC,
        }.get(filter, Image.BILINEAR)

        if input_mask is not None:
            result, output_mask = _transform_masked_source(
                source,
                input_mask,
                resample,
                translate_x,
                translate_y,
                rotate_deg,
                scale,
                expand,
            )
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")

        processed_frames = []
        processed_masks = []
        for fi, pil in enumerate(_tensor_batch_to_pil_list(source)):
            tx, ty = _scalar(translate_x, index=fi), _scalar(translate_y, index=fi)
            rd, sc = _scalar(rotate_deg, index=fi), _scalar(scale, index=fi)
            processed_frames.append(_pil_to_tensor(_transform_frame(pil, resample, tx, ty, rd, sc, expand)))

        for idx in range(output_mask_source.shape[0]):
            tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
            rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
            pil_mask = _mask_to_pil(output_mask_source[idx])
            transformed_mask = _transform_frame(pil_mask, resample, tx, ty, rd, sc, expand)
            processed_masks.append(_pil_to_mask(transformed_mask, source.device, source.dtype))

        if not processed_frames:
            raise ValueError("ImageOpsTransform received an empty image batch.")

        result = torch.cat(processed_frames, dim=0).to(device=source.device, dtype=source.dtype)
        output_mask = torch.cat(processed_masks, dim=0).to(device=source.device, dtype=source.dtype)
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")
