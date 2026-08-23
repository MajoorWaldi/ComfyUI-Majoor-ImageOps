import pytest
import torch

from nodes.core.media import ImageOpsMedia
from nodes.append import ImageOpsAppend
from nodes.frame_range import ImageOpsFrameRange
from comfy_api.latest import io


def test_multitype_api_available():
    assert hasattr(io, "MultiType")
    assert hasattr(io.MultiType, "Input")


def test_frame_range_preserves_media():
    node = ImageOpsFrameRange()
    frames = torch.ones((10, 16, 16, 3))
    for i in range(10):
        frames[i] *= (i + 1)
        
    audio = torch.ones((1, 1000))
    media = ImageOpsMedia(frames=frames, fps=60.0, audio=audio)
    
    result = node.execute(image=media, trim_start=2, trim_end=4)
    out_dict = result[0]
    assert isinstance(out_dict, dict)
    assert 'samples' in out_dict
    assert 'audio' in out_dict
    out_frames = out_dict['samples']
    # check that values are correct
    assert torch.allclose(out_frames[0], torch.ones((16, 16, 3)) * 3)
    # Audio is passed through
    assert out_dict['audio'] is not None


def test_append_preserves_media():
    node = ImageOpsAppend()
    frames1 = torch.ones((2, 16, 16, 3))
    media1 = ImageOpsMedia(frames=frames1, fps=24.0, audio=torch.zeros((1, 100)))
    
    frames2 = torch.zeros((3, 16, 16, 3))
    media2 = ImageOpsMedia(frames=frames2, fps=30.0, audio=torch.ones((1, 100)))
    
    result = node.execute(image_1=media1, image_2=media2)
    out_dict = result[0]
    assert isinstance(out_dict, dict)
    out_frames = out_dict['samples']
    assert out_frames.shape[0] == 5
    assert out_dict['audio'] is not None
    out_audio = out_dict['audio']['waveform']
    assert out_audio.shape[-1] == 200
    assert torch.all(out_audio[..., :100] == 0)
    assert torch.all(out_audio[..., 100:] == 1)
