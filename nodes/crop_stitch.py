import json

import torch

from ._helpers import MEDIA_INPUT_TYPE, _alpha_mask_from_image, _coerce_media_to_tensor, _prepare_mask_tensor, _resize, _scalar
from ._preview import build_node_preview_result
from ._progress import start_progress
from .core.batch import match_batch


def _parse_bbox_frames(crop_bbox):
    if crop_bbox is None:
        return []
    payload = crop_bbox
    if isinstance(payload, (list, tuple)):
        payload = payload[0] if payload else None
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8", errors="ignore")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            return []
    if not isinstance(payload, dict):
        return []
    frames = payload.get("frames")
    if isinstance(frames, list):
        return [frame for frame in frames if isinstance(frame, dict)]
    bbox = payload.get("bbox")
    return [bbox] if isinstance(bbox, dict) else []


def _bbox_from_frame(frame, source_w: int, source_h: int):
    try:
        x = int(round(float(frame.get("x", 0))))
        y = int(round(float(frame.get("y", 0))))
        w = int(round(float(frame.get("width", source_w))))
        h = int(round(float(frame.get("height", source_h))))
    except (TypeError, ValueError):
        return None
    w = max(1, min(source_w, w))
    h = max(1, min(source_h, h))
    x = max(0, min(source_w - w, x))
    y = max(0, min(source_h - h, y))
    return x, y, w, h


def _bbox_from_mask(mask: torch.Tensor, frame_index: int, source_w: int, source_h: int):
    frame = mask[frame_index].detach() > 0.001
    ys, xs = torch.where(frame)
    if xs.numel() == 0 or ys.numel() == 0:
        return 0, 0, source_w, source_h
    x0 = int(xs.min().item())
    x1 = int(xs.max().item()) + 1
    y0 = int(ys.min().item())
    y1 = int(ys.max().item()) + 1
    return x0, y0, max(1, x1 - x0), max(1, y1 - y0)


def _blur_mask(mask: torch.Tensor, feather: int) -> torch.Tensor:
    radius = max(0, int(feather))
    if radius <= 0:
        return mask
    kernel = radius * 2 + 1
    x = mask.unsqueeze(1)
    x = torch.nn.functional.avg_pool2d(x, kernel_size=kernel, stride=1, padding=radius)
    return x.squeeze(1).clamp(0.0, 1.0)


def _match_channels(image: torch.Tensor, channels: int) -> torch.Tensor:
    current = int(image.shape[-1])
    if current == channels:
        return image
    if current > channels:
        return image[..., :channels]
    pad = torch.zeros((*image.shape[:-1], channels - current), device=image.device, dtype=image.dtype)
    if channels >= 4 and current < 4:
        pad[..., min(3 - current, pad.shape[-1] - 1)] = 1.0
    return torch.cat([image, pad], dim=-1)


class ImageOpsCropStitch:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original": (MEDIA_INPUT_TYPE, {"tooltip": "Original image/video before Resize/Crop.", "display_name": "Original"}),
                "crop": (MEDIA_INPUT_TYPE, {"tooltip": "Edited cropped image/video to stitch back.", "display_name": "Edited Crop"}),
                "bypass": ("BOOLEAN", {"default": False}),
                "feather": ("INT", {"default": 0, "min": 0, "max": 128, "step": 1, "tooltip": "Softens the crop mask edge before compositing."}),
            },
            "optional": {
                "crop_mask": ("MASK", {"tooltip": "Source-space mask from ImageOps Resize/Crop.", "display_name": "Crop Mask"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, original, crop, bypass=False, feather=0, crop_mask=None, crop_bbox=None, unique_id=None):
        original = _coerce_media_to_tensor(original, "original").float().clamp(0.0, 1.0)
        crop = _coerce_media_to_tensor(crop, "crop").float().clamp(0.0, 1.0)
        progress = start_progress(unique_id=unique_id)

        if _scalar(bypass, bool):
            output_mask = _alpha_mask_from_image(original)
            progress.finish()
            return build_node_preview_result(original, (original, output_mask), prefix="imageops_crop_stitch")

        original, crop = match_batch(
            original, crop,
            name_a="original", name_b="crop",
            policy="hold_last",
        )
        batch = int(original.shape[0])
        source_h = int(original.shape[1])
        source_w = int(original.shape[2])

        prepared_mask = _prepare_mask_tensor(
            crop_mask,
            batch=batch,
            height=source_h,
            width=source_w,
            device=original.device,
            dtype=original.dtype,
        )
        bbox_frames = _parse_bbox_frames(crop_bbox)

        out = original.clone()
        stitch_mask = torch.zeros((batch, source_h, source_w), device=original.device, dtype=original.dtype)

        for index in range(batch):
            if bbox_frames:
                bbox = _bbox_from_frame(bbox_frames[min(index, len(bbox_frames) - 1)], source_w, source_h)
            else:
                if prepared_mask is None:
                    bbox = (0, 0, source_w, source_h)
                else:
                    bbox = _bbox_from_mask(prepared_mask, index, source_w, source_h)
            if bbox is None:
                bbox = (0, 0, source_w, source_h)
            x, y, w, h = bbox
            resized_crop = _resize(crop[index:index + 1], w, h, mode="bicubic", antialias=True)[0]

            if prepared_mask is None:
                region_mask = torch.ones((h, w), device=original.device, dtype=original.dtype)
            else:
                region_mask = prepared_mask[index:index + 1, y:y + h, x:x + w]
                region_mask = _resize(region_mask.unsqueeze(-1), w, h, mode="bilinear", antialias=True)[0, ..., 0]
            if resized_crop.shape[-1] >= 4:
                region_mask = (region_mask * resized_crop[..., 3].clamp(0.0, 1.0)).clamp(0.0, 1.0)
            resized_crop = _match_channels(resized_crop, int(out.shape[-1]))

            stitch_mask[index, y:y + h, x:x + w] = torch.maximum(stitch_mask[index, y:y + h, x:x + w], region_mask)
            blend = region_mask.unsqueeze(-1)
            out[index, y:y + h, x:x + w, :] = (
                out[index, y:y + h, x:x + w, :] * (1.0 - blend) + resized_crop.to(out.dtype) * blend
            )

        stitch_mask = _blur_mask(stitch_mask, _scalar(feather, int))
        if _scalar(feather, int) > 0:
            blend = stitch_mask.unsqueeze(-1)
            # Re-apply feather globally so softened edges blend with untouched original.
            out = original * (1.0 - blend) + out * blend

        progress.finish()
        return build_node_preview_result(out.clamp(0.0, 1.0), (out.clamp(0.0, 1.0), stitch_mask.clamp(0.0, 1.0)), prefix="imageops_crop_stitch")
