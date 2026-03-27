from __future__ import annotations

import torch
import torch.nn.functional as F

from ._helpers import (
    EPSILON,
    LUMA_WEIGHTS,
    MEDIA_INPUT_TYPE,
    _alpha_mask_from_image,
    _coerce_media_to_tensor,
    _extract_channel_mask,
    _match_image_to_reference,
    _prepare_effect_mask,
    _prepare_mask_tensor,
    _scalar,
    _select_media_tensor,
)
from ._progress import start_progress
from ._preview import build_node_preview_result

_DISTORT_MAP_SOURCES = ["source_channel", "displacement_channel", "mask"]
_DISTORT_CHANNELS = ["Red", "Green", "Blue", "Alpha", "Luma"]
_DISTORT_FILTERS = ["nearest", "bilinear", "bicubic"]
_DISTORT_EDGE_MODES = ["border", "reflection", "zeros"]


def _extract_map_channel(image: torch.Tensor, channel: str) -> torch.Tensor:
    normalized = str(channel or "Red").strip().lower()
    if normalized == "luma":
        if image.shape[-1] >= 3:
            lr, lg, lb = LUMA_WEIGHTS
            return (
                image[..., 0].float() * lr
                + image[..., 1].float() * lg
                + image[..., 2].float() * lb
            ).clamp(0.0, 1.0)
        return image[..., 0].float().clamp(0.0, 1.0)
    return _extract_channel_mask(image, channel)


def _neutral_map(reference: torch.Tensor, centered_map) -> torch.Tensor:
    frames = []
    for frame_index in range(reference.shape[0]):
        value = 0.5 if _scalar(centered_map, bool, index=frame_index) else 0.0
        frames.append(
            torch.full(
                (1, reference.shape[1], reference.shape[2]),
                float(value),
                device=reference.device,
                dtype=reference.dtype,
            )
        )
    return torch.cat(frames, dim=0)


def _resolve_distortion_maps(
    source: torch.Tensor,
    map_source,
    x_channel,
    y_channel,
    centered_map,
    displacement=None,
    mask=None,
):
    prepared_mask = _prepare_mask_tensor(
        mask,
        batch=source.shape[0],
        height=source.shape[1],
        width=source.shape[2],
        device=source.device,
        dtype=source.dtype,
    )
    x_frames = []
    y_frames = []
    preview_mask_frames = []
    mask_source_frames: list[bool] = []

    for frame_index in range(source.shape[0]):
        normalized = _scalar(map_source, str, index=frame_index).strip().lower()
        frame_source = source[frame_index:frame_index + 1]
        frame_displacement = displacement[frame_index:frame_index + 1] if displacement is not None else None

        if normalized == "mask":
            mask_source_frames.append(True)
            if prepared_mask is None:
                neutral = _neutral_map(frame_source, centered_map=_scalar(centered_map, bool, index=frame_index))
                x_frames.append(neutral)
                y_frames.append(neutral)
                preview_mask_frames.append(None)
            else:
                frame_mask = prepared_mask[frame_index:frame_index + 1]
                x_frames.append(frame_mask)
                y_frames.append(frame_mask)
                preview_mask_frames.append(frame_mask)
            continue

        mask_source_frames.append(False)
        driver = frame_source
        if normalized == "displacement_channel" and frame_displacement is not None:
            driver = frame_displacement
        x_frames.append(
            _extract_map_channel(driver, _scalar(x_channel, str, index=frame_index)).to(device=source.device, dtype=source.dtype)
        )
        y_frames.append(
            _extract_map_channel(driver, _scalar(y_channel, str, index=frame_index)).to(device=source.device, dtype=source.dtype)
        )
        preview_mask_frames.append(None)

    preview_mask = None
    if any(frame is not None for frame in preview_mask_frames):
        preview_mask = torch.zeros(
            (source.shape[0], source.shape[1], source.shape[2]),
            device=source.device,
            dtype=source.dtype,
        )
        for frame_index, frame in enumerate(preview_mask_frames):
            if frame is not None:
                preview_mask[frame_index:frame_index + 1] = frame

    return torch.cat(x_frames, dim=0), torch.cat(y_frames, dim=0), preview_mask, mask_source_frames


def _warp_image(
    source: torch.Tensor,
    x_map: torch.Tensor,
    y_map: torch.Tensor,
    strength_x,
    strength_y,
    centered_map,
    invert_map,
    filter_mode,
    edge_mode,
    progress=None,
) -> torch.Tensor:
    image = source.float().permute(0, 3, 1, 2).contiguous()
    warped_frames = []
    height = int(source.shape[1])
    width = int(source.shape[2])
    base_y, base_x = torch.meshgrid(
        torch.linspace(-1.0, 1.0, height, device=source.device, dtype=source.dtype),
        torch.linspace(-1.0, 1.0, width, device=source.device, dtype=source.dtype),
        indexing="ij",
    )
    width_norm = 2.0 / float(max(1, width - 1))
    height_norm = 2.0 / float(max(1, height - 1))

    for frame_index in range(source.shape[0]):
        frame_x = x_map[frame_index].float().clamp(0.0, 1.0)
        frame_y = y_map[frame_index].float().clamp(0.0, 1.0)
        if _scalar(invert_map, bool, index=frame_index):
            frame_x = 1.0 - frame_x
            frame_y = 1.0 - frame_y
        if _scalar(centered_map, bool, index=frame_index):
            frame_x = frame_x * 2.0 - 1.0
            frame_y = frame_y * 2.0 - 1.0

        dx = frame_x * float(_scalar(strength_x, index=frame_index))
        dy = frame_y * float(_scalar(strength_y, index=frame_index))
        safe_filter = _scalar(filter_mode, str, index=frame_index).strip().lower()
        if safe_filter not in ("nearest", "bilinear", "bicubic"):
            safe_filter = "bilinear"
        safe_edge_mode = _scalar(edge_mode, str, index=frame_index).strip().lower()
        if safe_edge_mode not in ("border", "reflection", "zeros"):
            safe_edge_mode = "border"
        grid = torch.stack(
            [
                (base_x - dx * width_norm),
                (base_y - dy * height_norm),
            ],
            dim=-1,
        ).unsqueeze(0)

        warped = F.grid_sample(
            image[frame_index:frame_index + 1],
            grid,
            mode=safe_filter,
            padding_mode=safe_edge_mode,
            align_corners=True,
        )
        warped_frames.append(warped)
        if progress is not None:
            progress.update()

    return (
        torch.cat(warped_frames, dim=0)
        .permute(0, 2, 3, 1)
        .contiguous()
        .clamp(0.0, 1.0)
        .to(device=source.device, dtype=source.dtype)
    )


class ImageOpsDistort:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "map_source": (_DISTORT_MAP_SOURCES, {"default": "source_channel"}),
                "x_channel": (_DISTORT_CHANNELS, {"default": "Red"}),
                "y_channel": (_DISTORT_CHANNELS, {"default": "Green"}),
                "strength_x": ("FLOAT", {"default": 40.0, "min": -2048.0, "max": 2048.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "strength_y": ("FLOAT", {"default": 40.0, "min": -2048.0, "max": 2048.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "centered_map": ("BOOLEAN", {"default": True}),
                "invert_map": ("BOOLEAN", {"default": False}),
                "filter": (_DISTORT_FILTERS, {"default": "bilinear"}),
                "edge_mode": (_DISTORT_EDGE_MODES, {"default": "border"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Source image/video to distort.", "forceInput": True, "display_name": "Images/Video"}),
                "displacement": (MEDIA_INPUT_TYPE, {"tooltip": "Optional displacement image/video when map_source is displacement_channel.", "display_name": "Displacement"}),
                "mask": ("MASK", {"tooltip": "Used as the distortion map when map_source is mask, otherwise acts as an effect mask."}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        image=None,
        bypass=False,
        map_source="source_channel",
        x_channel="Red",
        y_channel="Green",
        strength_x=40.0,
        strength_y=40.0,
        centered_map=True,
        invert_map=False,
        filter="bilinear",
        edge_mode="border",
        invert_mask=False,
        video=None,
        displacement=None,
        mask=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        displacement_tensor = None
        if displacement is not None:
            displacement_tensor = _coerce_media_to_tensor(displacement, "displacement").float().clamp(0.0, 1.0)
            displacement_tensor = _match_image_to_reference(displacement_tensor, source)

        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)

        x_map, y_map, driver_preview_mask, mask_source_frames = _resolve_distortion_maps(
            source,
            map_source=map_source,
            x_channel=x_channel,
            y_channel=y_channel,
            centered_map=centered_map,
            displacement=displacement_tensor,
            mask=mask,
        )
        apply_effect_mask = effect_mask.clone() if effect_mask is not None else None
        if apply_effect_mask is not None:
            for frame_index, is_mask_source in enumerate(mask_source_frames):
                if is_mask_source:
                    apply_effect_mask[frame_index:frame_index + 1] = 1.0

        if _scalar(bypass, bool):
            progress = start_progress(unique_id=unique_id)
            output_mask = _alpha_mask_from_image(source)
            if effect_mask is not None:
                for frame_index, is_mask_source in enumerate(mask_source_frames):
                    if not is_mask_source:
                        output_mask[frame_index:frame_index + 1] = effect_mask[frame_index:frame_index + 1].clamp(0.0, 1.0)
            if driver_preview_mask is not None:
                preview_mask = driver_preview_mask.clone()
                for frame_index, is_mask_source in enumerate(mask_source_frames):
                    if is_mask_source and _scalar(invert_map, bool, index=frame_index):
                        preview_mask[frame_index:frame_index + 1] = 1.0 - preview_mask[frame_index:frame_index + 1]
                for frame_index, is_mask_source in enumerate(mask_source_frames):
                    if is_mask_source:
                        output_mask[frame_index:frame_index + 1] = preview_mask[frame_index:frame_index + 1].clamp(0.0, 1.0)
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_distort")

        progress = start_progress(total=max(1, int(source.shape[0])), unique_id=unique_id)
        result = _warp_image(
            source,
            x_map=x_map,
            y_map=y_map,
            strength_x=strength_x,
            strength_y=strength_y,
            centered_map=centered_map,
            invert_map=invert_map,
            filter_mode=filter,
            edge_mode=edge_mode,
            progress=progress,
        )

        if apply_effect_mask is not None:
            result = source * (1.0 - apply_effect_mask.unsqueeze(-1)) + result * apply_effect_mask.unsqueeze(-1)
        output_mask = _alpha_mask_from_image(result)
        if effect_mask is not None:
            for frame_index, is_mask_source in enumerate(mask_source_frames):
                if not is_mask_source:
                    output_mask[frame_index:frame_index + 1] = effect_mask[frame_index:frame_index + 1].clamp(0.0, 1.0)
        if driver_preview_mask is not None:
            preview_mask = driver_preview_mask.clone()
            for frame_index, is_mask_source in enumerate(mask_source_frames):
                if is_mask_source and _scalar(invert_map, bool, index=frame_index):
                    preview_mask[frame_index:frame_index + 1] = 1.0 - preview_mask[frame_index:frame_index + 1]
            for frame_index, is_mask_source in enumerate(mask_source_frames):
                if is_mask_source:
                    output_mask[frame_index:frame_index + 1] = preview_mask[frame_index:frame_index + 1].clamp(0.0, 1.0)

        progress.finish()
        return build_node_preview_result(result.clamp(0.0, 1.0), (result.clamp(0.0, 1.0), output_mask), prefix="imageops_distort")
