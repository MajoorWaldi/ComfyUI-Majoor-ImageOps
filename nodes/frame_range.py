from __future__ import annotations
from comfy_api.latest import io
import torch
from ._helpers import MEDIA_INPUT_TYPE, _coerce_media_to_tensor, _scalar
from ._preview import build_node_preview_result
from ._progress import start_progress

def _clamp_int(value, low: int, high: int) -> int:
    return max(low, min(high, int(value)))

def _timeline_indices(source_count: int, trim_start: int, trim_end: int) -> list[int]:
    if source_count <= 0:
        return []
    start = _clamp_int(trim_start, 0, source_count - 1)
    end = source_count - 1 if trim_end < 0 else _clamp_int(trim_end, 0, source_count - 1)
    if end < start:
        start, end = (end, start)
    return list(range(start, end + 1))

def _repeat_count(repeat: bool, repeat_mode: str, custom_frame_count: int, source_count: int) -> int:
    if not repeat:
        return 1
    mode = str(repeat_mode or '').strip().lower()
    if mode == 'input_duration':
        return max(0, int(source_count))
    return max(1, int(custom_frame_count))

def _normalize_repeat_style(repeat_mode: str) -> str:
    mode = str(repeat_mode or 'loop').strip().lower()
    if mode in {'bounce', 'reverse', 'loop'}:
        return mode
    return 'loop'

def _repeat_indices(indices: list[int], output_count: int, repeat_mode: str) -> list[int]:
    if not indices or output_count <= 0:
        return []
    style = _normalize_repeat_style(repeat_mode)
    if style == 'reverse':
        pattern = list(reversed(indices))
    elif style == 'bounce':
        pattern = indices if len(indices) <= 2 else indices + indices[-2:0:-1]
    else:
        pattern = indices
    if not pattern:
        pattern = indices
    pattern_count = len(pattern)
    return [pattern[i % pattern_count] for i in range(output_count)]

class ImageOpsFrameRange(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsFrameRange', display_name='〽️ Image Ops Frame Range', category='image/imageops', inputs=[io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Image batch or video frames.', display_name='Image/Video'), io.Boolean.Input('bypass', default=False), io.Int.Input('trim_start', default=0, min=0, max=10000000, step=1), io.Int.Input('trim_end', default=-1, min=-1, max=10000000, step=1, tooltip='-1 means last input frame.'), io.Boolean.Input('frame_hold', default=False), io.Int.Input('hold_frame', default=0, min=0, max=10000000, step=1), io.Boolean.Input('repeat', default=False), io.String.Input('repeat_mode', default='loop'), io.Int.Input('custom_frame_count', default=24, min=1, max=10000000, step=1)], outputs=[io.Image.Output('image', display_name='image'), io.Int.Output('frame_count', display_name='frame_count')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image, bypass=False, trim_start=0, trim_end=-1, frame_hold=False, hold_frame=0, repeat=False, repeat_mode='loop', custom_frame_count=24, unique_id=None, **kwargs):
        from .core.media import ImageOpsMedia
        is_media = isinstance(image, ImageOpsMedia)
        media_obj = image if is_media else None
        tensor = _coerce_media_to_tensor(image, 'image')
        progress = start_progress(unique_id=unique_id)
        source_count = int(tensor.shape[0])
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(image, (image, source_count), metadata={'imageops_frame_range_source_count': [source_count]})
        indices = _timeline_indices(source_count, _scalar(trim_start, int), _scalar(trim_end, int))
        repeat_mode_text = str(repeat_mode or 'loop').strip().lower()
        repeat_uses_hold = repeat_mode_text in {'input_duration', 'custom_count', 'freeze'}
        apply_hold = _scalar(frame_hold, bool) and (not _scalar(repeat, bool) or repeat_uses_hold) or (_scalar(repeat, bool) and repeat_mode_text == 'freeze')
        if apply_hold and indices:
            hold_min = indices[0]
            hold_max = indices[-1]
            base_index = _clamp_int(_scalar(hold_frame, int), hold_min, hold_max)
            indices = [base_index]
        repeat_enabled = _scalar(repeat, bool)
        if repeat_enabled and indices:
            output_count = _repeat_count(True, str(repeat_mode or 'loop'), _scalar(custom_frame_count, int), source_count)
            indices = _repeat_indices(indices, output_count, str(repeat_mode or 'loop'))
        if not indices:
            out_tensor = tensor[:1].clone()
            out_audio = media_obj.audio if media_obj and media_obj.audio is not None else None
        else:
            idx_tensor = torch.tensor(indices, device=tensor.device, dtype=torch.long)
            out_tensor = tensor[idx_tensor]
            if media_obj and media_obj.audio is not None:
                out_audio = media_obj.audio.clone()
            else:
                out_audio = None
        if is_media:
            out = ImageOpsMedia(frames=out_tensor, fps=media_obj.fps, audio=out_audio, metadata=dict(media_obj.metadata))
        else:
            out = out_tensor
        progress.finish()
        return build_node_preview_result(out_tensor, (out, int(out_tensor.shape[0])), metadata={'imageops_frame_range_source_count': [source_count]})