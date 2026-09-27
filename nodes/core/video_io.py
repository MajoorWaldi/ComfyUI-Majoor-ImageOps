"""Bridge between this pack's internal frames+fps+audio carrier (ImageOpsMedia,
audio as [C, T]) and ComfyUI's native VIDEO type (VideoInput, audio as
{"waveform": [B, C, T], "sample_rate": int}).

Only imported by node files (which already require comfy_api at module scope);
never imported from nodes/_helpers.py, which must stay importable without
ComfyUI installed for the isolated unit-test suite.
"""
from __future__ import annotations

from fractions import Fraction

import torch
from comfy_api.latest import VideoComponents, VideoFromComponents



def extract_video_media(media) -> tuple[torch.Tensor, float, torch.Tensor | None, int] | None:
    """If media exposes ComfyUI's VideoInput contract (get_components()), return
    (images, fps, audio, sample_rate) with audio in this pack's [C, T] convention
    (or None). Returns None if media isn't a VideoInput."""
    get_components = getattr(media, "get_components", None)
    if not callable(get_components):
        return None
    components = get_components()
    images = components.images
    fps = float(components.frame_rate) if components.frame_rate else 24.0
    audio = None
    sample_rate = 44100
    if components.audio is not None:
        waveform = components.audio["waveform"]
        sample_rate = int(components.audio["sample_rate"])
        # ComfyUI AUDIO is [B, C, T]; this pack's ImageOpsMedia.audio is [C, T].
        audio = waveform[0] if waveform.dim() == 3 else waveform
    return images, fps, audio, sample_rate


def media_to_video(frames: torch.Tensor, fps: float, audio: torch.Tensor | None, sample_rate: int):
    """Build a native ComfyUI VIDEO from this pack's frames/fps/audio ([C, T])."""
    audio_dict = None
    if audio is not None and audio.numel() > 0:
        waveform = audio.unsqueeze(0) if audio.dim() == 2 else audio
        audio_dict = {"waveform": waveform, "sample_rate": int(sample_rate)}
    frame_rate = Fraction(fps).limit_denominator(1_000_000) if fps and fps > 0 else Fraction(24)
    return VideoFromComponents(VideoComponents(images=frames, audio=audio_dict, frame_rate=frame_rate))
