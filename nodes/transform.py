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
from ._progress import start_progress
from ._preview import build_node_preview_result


def _resample_from_filter(filter_mode, index: int = 0):
    normalized = _scalar(filter_mode, str, index=index).strip().lower()
    _RESAMPLE_MAP = {
        "nearest": Image.NEAREST,
        "bilinear": Image.BILINEAR,
        "bicubic": Image.BICUBIC,
    }
    if normalized not in _RESAMPLE_MAP:
        logger.warning(f"ImageOpsTransform: unknown filter mode '{normalized}', falling back to bilinear")
    return _RESAMPLE_MAP.get(normalized, Image.BILINEAR)


def _mask_to_pil(mask_frame: torch.Tensor) -> Image.Image:
    array = (mask_frame.detach().cpu().float().clamp(0, 1).numpy() * 255.0 + 0.5).astype("uint8")
    return Image.fromarray(array, mode="L")


def _pil_to_mask(pil: Image.Image, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    arr = np.asarray(pil, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0).to(device=device, dtype=dtype)


def _transform_masked_source(source, input_mask, filter_mode, translate_x, translate_y, rotate_deg, scale, expand, progress=None):
    if source.shape[0] != input_mask.shape[0]:
        raise ValueError(
            f"ImageOpsTransform: source batch ({source.shape[0]}) and mask batch ({input_mask.shape[0]}) "
            f"must match. Broadcasting would produce incorrect per-frame transforms."
        )
    premult_rgb = source[..., :3].float().clamp(0.0, 1.0) * input_mask.unsqueeze(-1)
    processed_rgb = []
    processed_mask = []
    processed_alpha = []

    for fi, pil in enumerate(_tensor_batch_to_pil_list(premult_rgb)):
        tx, ty = _scalar(translate_x, index=fi), _scalar(translate_y, index=fi)
        rd, sc = _scalar(rotate_deg, index=fi), _scalar(scale, index=fi)
        ex = _scalar(expand, bool, index=fi)
        processed_rgb.append(_pil_to_tensor(_transform_frame(pil, _resample_from_filter(filter_mode, fi), tx, ty, rd, sc, ex))[..., :3])
        if progress is not None:
            progress.update()

    for idx in range(input_mask.shape[0]):
        tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
        rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
        pil_mask = _mask_to_pil(input_mask[idx])
        ex = _scalar(expand, bool, index=idx)
        processed_mask.append(_pil_to_mask(_transform_frame(pil_mask, _resample_from_filter(filter_mode, idx), tx, ty, rd, sc, ex), source.device, source.dtype))
        if progress is not None:
            progress.update()

    if source.shape[-1] >= 4:
        for idx in range(source.shape[0]):
            tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
            rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
            pil_alpha = _mask_to_pil(source[idx, ..., 3])
            ex = _scalar(expand, bool, index=idx)
            processed_alpha.append(_pil_to_mask(_transform_frame(pil_alpha, _resample_from_filter(filter_mode, idx), tx, ty, rd, sc, ex), source.device, source.dtype))
            if progress is not None:
                progress.update()

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
    expand = _scalar(expand, bool)
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
        working = working.rotate(-rotate_deg, resample=resample, expand=expand)
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
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, translate_x=0, translate_y=0, rotate_deg=0.0, scale=1.0, filter="bilinear", expand=False, invert_mask=False, video=None, mask=None, unique_id=None):
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_transform")

        def _is_noop_param(value, kind="float"):
            if isinstance(value, (list, tuple)):
                for idx in range(len(value)):
                    current = _scalar(value, bool if kind == "bool" else float, index=idx) if kind == "bool" else _scalar(value, index=idx)
                    if kind == "bool":
                        if bool(current):
                            return False
                    elif kind == "int":
                        if abs(int(round(float(current)))) > 0:
                            return False
                    else:
                        if abs(float(current)) > EPSILON:
                            return False
                return True
            current = _scalar(value, bool) if kind == "bool" else _scalar(value)
            if kind == "bool":
                return not bool(current)
            if kind == "int":
                return abs(int(round(float(current)))) == 0
            return abs(float(current)) <= EPSILON

        no_translate = _is_noop_param(translate_x, "int") and _is_noop_param(translate_y, "int")
        no_rotate = _is_noop_param(rotate_deg, "float")
        unit_scale = _is_noop_param(_scalar(scale) - 1.0 if not isinstance(scale, (list, tuple)) else [(_scalar(scale, index=i) - 1.0) for i in range(len(scale))], "float")
        no_expand = _is_noop_param(expand, "bool")
        if no_translate and no_rotate and unit_scale and no_expand:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_transform")

        if input_mask is not None:
            total_steps = int(source.shape[0]) + int(input_mask.shape[0]) + (int(source.shape[0]) if source.shape[-1] >= 4 else 0)
            progress.update_absolute(0, total=max(1, total_steps))
            result, output_mask = _transform_masked_source(
                source,
                input_mask,
                filter,
                translate_x,
                translate_y,
                rotate_deg,
                scale,
                expand,
                progress=progress,
            )
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")

        progress.update_absolute(0, total=max(1, int(source.shape[0]) + int(output_mask_source.shape[0])))
        processed_frames = []
        processed_masks = []
        for fi, pil in enumerate(_tensor_batch_to_pil_list(source)):
            tx, ty = _scalar(translate_x, index=fi), _scalar(translate_y, index=fi)
            rd, sc = _scalar(rotate_deg, index=fi), _scalar(scale, index=fi)
            ex = _scalar(expand, bool, index=fi)
            processed_frames.append(_pil_to_tensor(_transform_frame(pil, _resample_from_filter(filter, fi), tx, ty, rd, sc, ex)))
            progress.update()

        for idx in range(output_mask_source.shape[0]):
            tx, ty = _scalar(translate_x, index=idx), _scalar(translate_y, index=idx)
            rd, sc = _scalar(rotate_deg, index=idx), _scalar(scale, index=idx)
            pil_mask = _mask_to_pil(output_mask_source[idx])
            ex = _scalar(expand, bool, index=idx)
            transformed_mask = _transform_frame(pil_mask, _resample_from_filter(filter, idx), tx, ty, rd, sc, ex)
            processed_masks.append(_pil_to_mask(transformed_mask, source.device, source.dtype))
            progress.update()

        if not processed_frames:
            raise ValueError("ImageOpsTransform received an empty image batch.")

        result = torch.cat(processed_frames, dim=0).to(device=source.device, dtype=source.dtype)
        output_mask = torch.cat(processed_masks, dim=0).to(device=source.device, dtype=source.dtype)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_transform")
