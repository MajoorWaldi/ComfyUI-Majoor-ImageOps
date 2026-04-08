import torch

from ._helpers import (
    MEDIA_INPUT_TYPE,
    _apply_blur,
    _apply_mask_to_image,
    _coerce_media_to_tensor,
    _expand_image_batch,
    _prepare_mask_tensor,
    _resize,
    _scalar,
)
from ._preview import build_node_preview_result
from ._progress import start_progress


_ORIGINAL_REGION_MODES = ["black_is_original", "white_is_original"]


def _normalize_original_region(value: str) -> str:
    normalized = str(value or "black_is_original").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized in ("white", "white_is_original", "mask_white", "original_white"):
        return "white_is_original"
    return "black_is_original"


def _match_channels(image: torch.Tensor, channels: int) -> torch.Tensor:
    current = int(image.shape[-1])
    target = max(1, int(channels))
    if current == target:
        return image
    if current > target:
        return image[..., :target]

    extras = torch.ones(
        (*image.shape[:3], target - current),
        device=image.device,
        dtype=image.dtype,
    )
    return torch.cat([image, extras], dim=-1)


def _mask_bbox(mask_frame: torch.Tensor, threshold: float = 0.5) -> tuple[int, int, int, int] | None:
    coords = torch.nonzero(mask_frame > threshold, as_tuple=False)
    if coords.numel() == 0:
        return None
    y0 = int(coords[:, 0].min().item())
    y1 = int(coords[:, 0].max().item()) + 1
    x0 = int(coords[:, 1].min().item())
    x1 = int(coords[:, 1].max().item()) + 1
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def _place_original_frames(outpainted: torch.Tensor, original: torch.Tensor, preserve_mask: torch.Tensor) -> torch.Tensor:
    placed = outpainted.clone()
    channels = int(outpainted.shape[-1])
    for frame_index in range(int(outpainted.shape[0])):
        bbox = _mask_bbox(preserve_mask[frame_index])
        if bbox is None:
            continue
        x0, y0, x1, y1 = bbox
        target_w = max(1, x1 - x0)
        target_h = max(1, y1 - y0)
        patch = original[frame_index:frame_index + 1]
        if int(patch.shape[1]) != target_h or int(patch.shape[2]) != target_w:
            patch = _resize(patch, target_w, target_h, mode="bicubic", antialias=True)
        patch = _match_channels(patch, channels).to(device=placed.device, dtype=placed.dtype)
        placed[frame_index:frame_index + 1, y0:y1, x0:x1, :] = patch
    return placed.clamp(0.0, 1.0)


def _stitch_from_padout_context(stitcher: dict, outpainted: torch.Tensor, feather_radius=0, invert_mask=False) -> tuple[torch.Tensor, torch.Tensor]:
    if not isinstance(stitcher, dict):
        raise ValueError("ImageOps PadOut Stitch expected a PadOut stitcher object.")

    canvas = stitcher.get("canvas_image")
    mask = stitcher.get("outpaint_mask")
    if not torch.is_tensor(canvas) or not torch.is_tensor(mask):
        raise ValueError("ImageOps PadOut Stitch received an invalid PadOut stitcher object.")

    result = outpainted.float().clamp(0.0, 1.0)
    canvas = canvas.float().clamp(0.0, 1.0).to(device=result.device, dtype=result.dtype)

    batch = max(int(result.shape[0]), int(canvas.shape[0]))
    result = _expand_image_batch(result, batch)
    canvas = _expand_image_batch(canvas, batch).to(device=result.device, dtype=result.dtype)

    if int(result.shape[1]) != int(canvas.shape[1]) or int(result.shape[2]) != int(canvas.shape[2]):
        result = _resize(result, int(canvas.shape[2]), int(canvas.shape[1]), mode="bicubic", antialias=True)
    result = _match_channels(result, int(canvas.shape[-1]))

    outpaint_mask = _prepare_mask_tensor(
        mask,
        batch=batch,
        height=int(canvas.shape[1]),
        width=int(canvas.shape[2]),
        device=result.device,
        dtype=result.dtype,
    )
    if outpaint_mask is None:
        outpaint_mask = torch.zeros((batch, int(canvas.shape[1]), int(canvas.shape[2])), device=result.device, dtype=result.dtype)

    output_mask = (1.0 - outpaint_mask).clamp(0.0, 1.0) if _scalar(invert_mask, bool) else outpaint_mask.clamp(0.0, 1.0)

    composite_mask = outpaint_mask
    radius = max(0, _scalar(feather_radius, int))
    if radius > 0:
        composite_mask = _apply_blur(
            outpaint_mask.unsqueeze(-1),
            radius,
            max(1.0, radius / 3.0),
        )[..., 0].clamp(0.0, 1.0)

    return _apply_mask_to_image(canvas, result, composite_mask).clamp(0.0, 1.0), output_mask


class ImageOpsPadOutStitch:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "outpainted": (MEDIA_INPUT_TYPE, {"tooltip": "Image returned by the outpainting / image edit node.", "display_name": "Outpainted"}),
                "bypass": ("BOOLEAN", {"default": False}),
                "original_region": (_ORIGINAL_REGION_MODES, {
                    "default": "black_is_original",
                    "tooltip": "Fallback mode when no PadOut stitcher is connected. Use black_is_original for PadOut's default mask.",
                }),
                "feather_radius": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": 256,
                    "step": 1,
                    "tooltip": "Softens the edge where the original image is restored.",
                }),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "stitcher": ("IMAGEOPS_PADOUT_STITCHER", {"tooltip": "Stitcher output from ImageOps PadOut.", "display_name": "PadOut Stitcher"}),
                "original": (MEDIA_INPUT_TYPE, {"tooltip": "Fallback source media before ImageOps PadOut.", "display_name": "Original"}),
                "padout_mask": ("MASK", {"tooltip": "Fallback mask output from ImageOps PadOut.", "display_name": "PadOut Mask"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        outpainted,
        bypass=False,
        original_region="black_is_original",
        feather_radius=0,
        invert_mask=False,
        stitcher=None,
        original=None,
        padout_mask=None,
        unique_id=None,
    ):
        progress = start_progress(total=3, unique_id=unique_id)
        result = _coerce_media_to_tensor(outpainted, "outpainted").float().clamp(0.0, 1.0)

        if stitcher is not None:
            stitched, output_mask = _stitch_from_padout_context(
                stitcher,
                result,
                feather_radius=feather_radius,
                invert_mask=invert_mask,
            )
            progress.finish()
            if _scalar(bypass, bool):
                return build_node_preview_result(result, (result, output_mask), prefix="imageops_padout_stitch")
            return build_node_preview_result(stitched, (stitched, output_mask), prefix="imageops_padout_stitch")

        if original is None or padout_mask is None:
            raise ValueError("ImageOps PadOut Stitch requires either a PadOut stitcher input or both original and padout_mask fallback inputs.")

        source = _coerce_media_to_tensor(original, "original").float().clamp(0.0, 1.0)

        batch = max(int(result.shape[0]), int(source.shape[0]))
        result = _expand_image_batch(result, batch)
        source = _expand_image_batch(source, batch).to(device=result.device, dtype=result.dtype)

        raw_mask = _prepare_mask_tensor(
            padout_mask,
            batch=batch,
            height=int(result.shape[1]),
            width=int(result.shape[2]),
            device=result.device,
            dtype=result.dtype,
        )
        if raw_mask is None:
            output_mask = torch.ones((batch, int(result.shape[1]), int(result.shape[2])), device=result.device, dtype=result.dtype)
            if not _scalar(invert_mask, bool):
                output_mask = torch.zeros_like(output_mask)
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_padout_stitch")
        progress.update()

        region_mode = _normalize_original_region(_scalar(original_region, str))
        preserve_mask = raw_mask if region_mode == "white_is_original" else 1.0 - raw_mask
        preserve_mask = preserve_mask.clamp(0.0, 1.0)
        outpaint_mask = (1.0 - preserve_mask).clamp(0.0, 1.0)
        output_mask = (1.0 - outpaint_mask).clamp(0.0, 1.0) if _scalar(invert_mask, bool) else outpaint_mask

        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_padout_stitch")

        placed = _place_original_frames(result, source, preserve_mask)
        progress.update()

        composite_mask = preserve_mask
        radius = max(0, _scalar(feather_radius, int))
        if radius > 0:
            composite_mask = _apply_blur(
                preserve_mask.unsqueeze(-1),
                radius,
                max(1.0, radius / 3.0),
            )[..., 0].clamp(0.0, 1.0)

        stitched = _apply_mask_to_image(result, placed, composite_mask).clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(stitched, (stitched, output_mask), prefix="imageops_padout_stitch")
