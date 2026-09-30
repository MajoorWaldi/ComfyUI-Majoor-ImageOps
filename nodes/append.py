from __future__ import annotations
from comfy_api.latest import io, VideoFromList
import json
import re
from typing import Any
import torch
from ._helpers import _resize, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress
from .core.timeline import trim_indices
from .core.video_io import extract_video_media, media_to_video
from .core.memory import check_budget
from .core.media import ImageOpsMedia
from .frame_range import _slice_audio_for_indices
_JOIN_FIT_MODES = ['strict', 'resize_to_first', 'pad_to_max']
_FPS_RELATIVE_TOLERANCE = 0.001

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

def _fps_matches(a: float, b: float) -> bool:
    return abs(a - b) <= max(a, b) * _FPS_RELATIVE_TOLERANCE

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
        check_budget(batch, h, w, target_channels - channels, label='ImageOps Append (Coerce Channels)', device=tensor.device)
        padding = torch.zeros((batch, h, w, target_channels - channels), device=tensor.device, dtype=tensor.dtype)
        if target_channels >= 4 and channels <= 3:
            padding[..., -1] = 1.0
        return torch.cat([tensor, padding], dim=-1)
    return tensor[..., :target_channels]

def _pad_to_size(source: torch.Tensor, target_w: int, target_h: int, pad_alpha: str = 'opaque') -> torch.Tensor:
    batch, source_h, source_w, channels = source.shape
    if source_w == target_w and source_h == target_h:
        return source
    check_budget(batch, target_h, target_w, channels, label='ImageOps Append (Pad to Size)', device=source.device)
    out = torch.zeros((batch, target_h, target_w, channels), device=source.device, dtype=source.dtype)
    if channels >= 4 and str(pad_alpha or 'opaque').strip().lower() != 'transparent':
        out[..., 3] = 1.0
    left = max(0, (target_w - source_w) // 2)
    top = max(0, (target_h - source_h) // 2)
    out[:, top:top + source_h, left:left + source_w, :] = source
    return out

def _align_pair(image_a: torch.Tensor, image_b: torch.Tensor, fit_mode: str, pad_alpha: str = 'opaque') -> tuple[torch.Tensor, torch.Tensor]:
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
        return (_pad_to_size(image_a, target_w, target_h, pad_alpha), _pad_to_size(image_b, target_w, target_h, pad_alpha))
    raise ValueError(f'ImageOps Append requires matching dimensions in strict mode. image_a is {a_w}x{a_h}, image_b is {b_w}x{b_h}. Use resize_to_first or pad_to_max to align them.')

class ImageOpsAppend(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsAppend', display_name='〽️ Image Ops Append', category='image/imageops', essentials_category='Video Tools', has_intermediate_output=True, search_aliases=['append', 'join', 'concat', 'concatenate', 'clips', 'sequence'], inputs=[io.Boolean.Input('bypass', default=False), io.Combo.Input('fit_mode', options=['strict', 'resize_to_first', 'pad_to_max'], default='strict', tooltip='How to align two clips before concatenating their frame batches.'), io.String.Input('trims_json', default='{"version":1,"clips":[]}', multiline=False, tooltip='Managed by the Append preview controls.'), io.MultiType.Input('image_1', types=[io.Image, io.Video], display_name='Images/Video 1', optional=True, extra_dict={'forceInput': True}), io.MultiType.Input('image_2', types=[io.Image, io.Video], display_name='Images/Video 2', optional=True, extra_dict={'forceInput': True}), io.Float.Input('image_fps', default=24.0, min=1.0, max=1000.0, step=0.001, optional=True, tooltip='Frame rate assumed for plain IMAGE clips (no VIDEO fps of their own) when checking that all clips share a frame rate.'), io.Combo.Input('pad_alpha', options=['opaque', 'transparent'], default='opaque', optional=True, tooltip='Alpha of the padding added by fit_mode=pad_to_max. opaque matches this node\'s historical behavior; transparent leaves the added margins see-through for compositing.')], outputs=[io.Image.Output('image', display_name='image'), io.Int.Output('frame_count', display_name='frame_count'), io.Int.Output('width', display_name='width'), io.Int.Output('height', display_name='height'), io.Video.Output('video', display_name='video', tooltip='Native VIDEO output. Carries the real audio/fps from the first connected VIDEO clip (not a plain IMAGE batch), if any.')])

    @classmethod
    def execute(cls, bypass=False, fit_mode='strict', trims_json='{"version":1,"clips":[]}', image_fps=24.0, pad_alpha='opaque', **inputs):
        progress = start_progress()
        clips = _sorted_clip_inputs(inputs)
        if not clips:
            raise ValueError('ImageOps Append needs at least one connected image/video input.')
        if bool(bypass):
            clips = clips[:1]
        trims = _parse_trims(trims_json)
        tensors: list[torch.Tensor] = []
        clip_metadata: list[dict[str, int]] = []
        has_media = False
        fps = 24.0
        sample_rate = 44100
        audio_list = []
        effective_fps: list[tuple[int, float]] = []
        # Collect each clip's own trimmed VideoInput so the VIDEO output can be built
        # via VideoFromList (which avoids a full re-encode when every clip is already
        # a compatible VideoFromFile) instead of always re-encoding the concatenated
        # tensor. Dropped to None the moment any clip can't participate; the IMAGE
        # tensor output below is unaffected either way, since it always needs the
        # decoded frames regardless of this.
        native_video_sources: list | None = [] if str(fit_mode or 'strict').strip().lower() == 'strict' else None

        for clip_index, value in clips:
            video_media = extract_video_media(value)
            if isinstance(value, ImageOpsMedia):
                is_media = True
                clip_audio, clip_fps, clip_sample_rate = value.audio, value.fps, getattr(value, 'sample_rate', 44100)
            elif video_media is not None:
                is_media = True
                _, clip_fps, clip_audio, clip_sample_rate = video_media
            else:
                is_media = False
                clip_audio, clip_fps, clip_sample_rate = None, float(image_fps), 44100
            tensor = _select_media_tensor(value, None).float()
            start, end = trims.get(clip_index, (0, -1))

            source_count = int(tensor.shape[0])
            indices = trim_indices(source_count, start, end, label=f'ImageOps Append (clip slot {clip_index})')
            trimmed = tensor[indices]
            tensors.append(trimmed)
            effective_fps.append((clip_index, clip_fps if is_media else float(image_fps)))

            if native_video_sources is not None:
                is_native_video = not isinstance(value, ImageOpsMedia) and video_media is not None and callable(getattr(value, 'as_trimmed', None))
                native_trimmed = value.as_trimmed(indices[0] / clip_fps, len(indices) / clip_fps) if is_native_video and clip_fps > 0 else None
                if native_trimmed is not None:
                    native_video_sources.append(native_trimmed)
                else:
                    native_video_sources = None

            if is_media:
                if not has_media:
                    fps = clip_fps
                    sample_rate = clip_sample_rate
                has_media = True

                if clip_audio is not None and clip_fps > 0:
                    trimmed_audio = _slice_audio_for_indices(clip_audio, indices, clip_fps, clip_sample_rate)
                    audio_list.append(trimmed_audio)
                else:
                    audio_list.append(None)
            else:
                audio_list.append(None)

            clip_metadata.append({'slot': int(clip_index), 'source_count': source_count, 'trimmed_count': int(trimmed.shape[0]), 'start': int(start), 'end': int(end), 'sample_rate': int(clip_sample_rate)})
        if len(effective_fps) > 1:
            ref_slot, ref_fps = effective_fps[0]
            mismatched_fps = [
                (slot, clip_fps, next(m['trimmed_count'] for m in clip_metadata if m['slot'] == slot) / clip_fps)
                for slot, clip_fps in effective_fps[1:]
                if not _fps_matches(clip_fps, ref_fps)
            ]
            if mismatched_fps:
                details = ', '.join(f'slot {slot}: {clip_fps:.3f} fps ({duration:.2f}s)' for slot, clip_fps, duration in mismatched_fps)
                raise ValueError(
                    f'ImageOps Append requires matching frame rates. Output fps is {ref_fps:.3f} '
                    f'(from clip slot {ref_slot}); {details} do not match. Use clips with a matching '
                    f'frame rate, or set image_fps to declare the rate of plain IMAGE clips.'
                )
        max_channels = max((int(t.shape[3]) for t in tensors))
        tensors = [_coerce_channels(t, max_channels) for t in tensors]
        if len(tensors) == 1:
            out_tensor = tensors[0]
        else:
            aligned = [tensors[0]]
            for tensor in tensors[1:]:
                first, current = _align_pair(aligned[0], tensor, fit_mode, pad_alpha)
                if first is not aligned[0]:
                    aligned = [first] + [_align_pair(first, item, fit_mode, pad_alpha)[1] for item in aligned[1:]]
                aligned.append(current)
            out_tensor = torch.cat(aligned, dim=0)
        if has_media:
            # Concatenate audio
            mismatched_slots = [
                meta['slot'] for meta, audio in zip(clip_metadata, audio_list)
                if audio is not None and meta['sample_rate'] != sample_rate
            ]
            if mismatched_slots:
                raise ValueError(
                    f'ImageOps Append cannot concatenate audio at different sample rates without resampling. '
                    f'Output sample rate is {sample_rate} Hz (from the first clip); '
                    f'clip slot(s) {mismatched_slots} use a different sample rate. '
                    f'Resample those clips to {sample_rate} Hz before Append, or trim out their audio.'
                )
            out_audio = None
            if any(a is not None for a in audio_list):
                chunks = []
                for audio, tensor_clip in zip(audio_list, tensors):
                    if audio is not None:
                        chunks.append(audio)
                    else:
                        fc = tensor_clip.shape[0]
                        samples = int(round(fc * sample_rate / fps)) if fps > 0 else 0
                        valid_audio = next(a for a in audio_list if a is not None)
                        channels = valid_audio.shape[0]
                        chunks.append(torch.zeros((channels, samples), device=valid_audio.device, dtype=valid_audio.dtype))
                if chunks:
                    out_audio = torch.cat(chunks, dim=-1)
            out = ImageOpsMedia(frames=out_tensor, fps=fps, audio=out_audio, sample_rate=sample_rate)
            if native_video_sources is not None and len(native_video_sources) == len(clips):
                video_out = VideoFromList(native_video_sources)
            else:
                video_out = media_to_video(out_tensor, fps, out_audio, sample_rate)
        else:
            out = out_tensor
            video_out = media_to_video(out_tensor, float(image_fps), None, 44100)
        progress.finish()
        frame_count = int(out_tensor.shape[0])
        height = int(out_tensor.shape[1])
        width = int(out_tensor.shape[2])
        return build_node_preview_result(out_tensor, (out, frame_count, width, height, video_out), prefix='imageops_append', metadata={'imageops_append_frame_count': [frame_count], 'imageops_append_clip_counts': [clip_metadata]})
