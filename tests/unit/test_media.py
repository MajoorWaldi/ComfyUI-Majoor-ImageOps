import pytest
import torch

from nodes.core.media import ImageOpsMedia
from nodes._helpers import _coerce_media_to_tensor
from nodes.append import ImageOpsAppend
from nodes.frame_range import ImageOpsFrameRange
from comfy_api.latest import io

def test_print_io():
    import inspect
    try:
        print("\n\nSignature MultiType.Output:", inspect.signature(io.MultiType.Output.__init__))
    except Exception as e:
        print("\n\nFailed to instantiate MultiType Output:", e)
    print("\n\n")

def test_media_dataclass_basic():
    frames = torch.ones((2, 64, 64, 3))
    audio = torch.zeros((1, 48000))
    media = ImageOpsMedia(frames=frames, fps=30.0, audio=audio, metadata={"custom": "data"})
    
    assert media.frame_count == 2
    assert media.fps == 30.0
    assert "custom" in media.metadata
    
    cloned = media.clone()
    assert cloned.frames is not media.frames
    assert torch.allclose(cloned.frames, media.frames)
    assert cloned.audio is not media.audio
    assert cloned.metadata == media.metadata

def test_coerce_media_to_tensor():
    frames = torch.ones((2, 64, 64, 3))
    media = ImageOpsMedia(frames=frames)
    
    tensor = _coerce_media_to_tensor(media)
    assert torch.is_tensor(tensor)
    assert tensor.shape == (2, 64, 64, 3)

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
