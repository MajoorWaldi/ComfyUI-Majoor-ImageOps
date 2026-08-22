from __future__ import annotations
from comfy_api.latest import io
import json
import re
from typing import Any
import torch
from ._helpers import MEDIA_INPUT_TYPE, _resize, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress
_JOIN_FIT_MODES = ['strict', 'resize_to_first', 'pad_to_max']

def _sorted_clip_inputs(inputs: dict[str, Any]) -> list[tuple[int, Any]]:
    clips: list[tuple[int, Any]] = []
    legacy = [('image_a', 1), ('image_b', 2)]
    for key, index in legacy:
        if inputs.get(key) is not None:
            clips.append((index, inputs[key]))
    for key, value in inputs.items():
        if value is None or not isinstance(key, str):
            continue
        match = re.fullmatch('image_(\\d+)', key)
        if match:
            clips.append((int(match.group(1)), value))
    dedup: dict[int, Any] = {}
    for index, value in clips:
        dedup[index] = value
    return sorted(dedup.items(), key=lambda item: item[0])

def _parse_trims(trims_json: str | dict | list | None) -> dict[int, tuple[int, int]]:
    if isinstance(trims_json, (dict, list)):
        parsed = trims_json
    else:
        raw = str(trims_json or '').strip()
        if not raw:
            parsed = {}
        else:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {}
    source = parsed.get('clips', []) if isinstance(parsed, dict) else parsed
    trims: dict[int, tuple[int, int]] = {}
    if not isinstance(source, list):
        return trims
    for entry in source:
        if not isinstance(entry, dict):
            continue
        slot = str(entry.get('slot') or '')
        match = re.search('(\\d+)$', slot)
        if not match:
            continue
        start_raw = entry.get('start', 0)
        end_raw = entry.get('end', -1)
        start = int(0 if start_raw is None else start_raw)
        end = int(-1 if end_raw is None else end_raw)
        trims[int(match.group(1))] = (start, end)
    return trims

def _trim_clip(source: torch.Tensor, start: int, end: int) -> torch.Tensor:
    count = int(source.shape[0])
    if count <= 0:
        return source
    actual_start = max(0, min(int(start), count - 1))
    actual_end = count - 1 if int(end) < 0 else max(0, min(int(end), count - 1))
    if actual_end < actual_start:
        actual_start, actual_end = (actual_end, actual_start)
    return source[actual_start:actual_end + 1]

def _coerce_channels(tensor: torch.Tensor, target_channels: int) -> torch.Tensor:
    batch, h, w, channels = tensor.shape
    if channels == target_channels:
        return tensor
    if target_channels >= 3 and channels == 1:
        rgb = tensor.expand(-1, -1, -1, 3)
        if target_channels == 4:
            alpha = torch.ones((batch, h, w, 1), device=tensor.device, dtype=tensor.dtype)
            return torch.cat([rgb, alpha], dim=-1)
        return rgb
    if target_channels == 4 and channels == 3:
        alpha = torch.ones((batch, h, w, 1), device=tensor.device, dtype=tensor.dtype)
        return torch.cat([tensor, alpha], dim=-1)
    if target_channels == 3 and channels == 4:
        return tensor[..., :3]
    if channels < target_channels:
        padding = torch.zeros((batch, h, w, target_channels - channels), device=tensor.device, dtype=tensor.dtype)
        if target_channels >= 4 and channels <= 3:
            padding[..., -1] = 1.0
        return torch.cat([tensor, padding], dim=-1)
    return tensor[..., :target_channels]

def _pad_to_size(source: torch.Tensor, target_w: int, target_h: int) -> torch.Tensor:
    batch, source_h, source_w, channels = source.shape
    if source_w == target_w and source_h == target_h:
        return source
    out = torch.zeros((batch, target_h, target_w, channels), device=source.device, dtype=source.dtype)
    if channels >= 4:
        out[..., 3] = 1.0
    left = max(0, (target_w - source_w) // 2)
    top = max(0, (target_h - source_h) // 2)
    out[:, top:top + source_h, left:left + source_w, :] = source
    return out

def _align_pair(image_a: torch.Tensor, image_b: torch.Tensor, fit_mode: str) -> tuple[torch.Tensor, torch.Tensor]:
    a_h, a_w = (int(image_a.shape[1]), int(image_a.shape[2]))
    b_h, b_w = (int(image_b.shape[1]), int(image_b.shape[2]))
    if a_w == b_w and a_h == b_h:
        return (image_a, image_b)
    mode = str(fit_mode or 'strict').strip().lower()
    if mode == 'resize_to_first':
        return (image_a, _resize(image_b, a_w, a_h, mode='bicubic', antialias=True))
    if mode == 'pad_to_max':
        target_w = max(a_w, b_w)
        target_h = max(a_h, b_h)
        return (_pad_to_size(image_a, target_w, target_h), _pad_to_size(image_b, target_w, target_h))
    raise ValueError(f'ImageOps Append requires matching dimensions in strict mode. image_a is {a_w}x{a_h}, image_b is {b_w}x{b_h}. Use resize_to_first or pad_to_max to align them.')

class ImageOpsAppend(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsAppend', display_name='〽️ Image Ops Append', category='image/imageops', inputs=[io.Boolean.Input('bypass', default=False), io.String.Input('fit_mode', default='strict', tooltip='How to align two clips before concatenating their frame batches.'), io.String.Input('trims_json', default='{"version":1,"clips":[]}', multiline=False, tooltip='Managed by the Append preview controls.'), io.MultiType.Input('image_1', types=[io.Image, io.Video], display_name='Images/Video 1', optional=True), io.MultiType.Input('image_2', types=[io.Image, io.Video], display_name='Images/Video 2', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Int.Output('frame_count', display_name='frame_count'), io.Int.Output('width', display_name='width'), io.Int.Output('height', display_name='height')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, bypass=False, fit_mode='strict', trims_json='{"version":1,"clips":[]}', unique_id=None, **inputs):
        from .core.media import ImageOpsMedia
        progress = start_progress(unique_id=unique_id)
        clips = _sorted_clip_inputs(inputs)
        if not clips:
            raise ValueError('ImageOps Append needs at least one connected image/video input.')
        trims = _parse_trims(trims_json)
        tensors: list[torch.Tensor] = []
        clip_metadata: list[dict[str, int]] = []
        has_media = False
        fps = 24.0
        audio_list = []
        for clip_index, value in clips:
            is_media = isinstance(value, ImageOpsMedia)
            if is_media:
                if not has_media:
                    fps = value.fps
                has_media = True
                if value.audio is not None:
                    audio_list.append(value.audio)
            tensor = _select_media_tensor(value, None).float().clamp(0.0, 1.0)
            start, end = trims.get(clip_index, (0, -1))
            trimmed = _trim_clip(tensor, start, end)
            tensors.append(trimmed)
            clip_metadata.append({'slot': int(clip_index), 'source_count': int(tensor.shape[0]), 'trimmed_count': int(trimmed.shape[0]), 'start': int(start), 'end': int(end)})
        max_channels = max((int(t.shape[3]) for t in tensors))
        tensors = [_coerce_channels(t, max_channels) for t in tensors]
        if bool(bypass) or len(tensors) == 1:
            out_tensor = tensors[0]
        else:
            aligned = [tensors[0]]
            for tensor in tensors[1:]:
                first, current = _align_pair(aligned[0], tensor, fit_mode)
                if first is not aligned[0]:
                    aligned = [first] + [_align_pair(first, item, fit_mode)[1] for item in aligned[1:]]
                aligned.append(current)
            out_tensor = torch.cat(aligned, dim=0)
        if has_media:
            out_audio = audio_list[0] if audio_list else None
            out = ImageOpsMedia(frames=out_tensor, fps=fps, audio=out_audio)
        else:
            out = out_tensor
        progress.finish()
        frame_count = int(out_tensor.shape[0])
        height = int(out_tensor.shape[1])
        width = int(out_tensor.shape[2])
        return build_node_preview_result(out_tensor, (out, frame_count, width, height), prefix='imageops_append', metadata={'imageops_append_frame_count': [frame_count], 'imageops_append_clip_counts': [clip_metadata]})