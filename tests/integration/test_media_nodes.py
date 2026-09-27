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
    media2 = ImageOpsMedia(frames=frames2, fps=24.0, audio=torch.ones((1, 100)))

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


def test_append_rejects_mismatched_fps():
    node = ImageOpsAppend()
    media1 = ImageOpsMedia(frames=torch.ones((2, 16, 16, 3)), fps=24.0)
    media2 = ImageOpsMedia(frames=torch.zeros((3, 16, 16, 3)), fps=30.0)

    with pytest.raises(ValueError, match='matching frame rates'):
        node.execute(image_1=media1, image_2=media2)


def test_append_rejects_inverted_trim():
    node = ImageOpsAppend()
    media1 = ImageOpsMedia(frames=torch.ones((5, 16, 16, 3)), fps=24.0)

    with pytest.raises(ValueError, match='trim_end'):
        node.execute(image_1=media1, trims_json='{"version":1,"clips":[{"slot":"image_1","start":3,"end":1}]}')


def test_frame_range_rejects_inverted_trim():
    node = ImageOpsFrameRange()
    frames = torch.ones((5, 16, 16, 3))

    with pytest.raises(ValueError, match='trim_end'):
        node.execute(image=frames, trim_start=3, trim_end=1)


def test_append_pad_to_max_alpha_opaque_by_default():
    node = ImageOpsAppend()
    small = torch.ones((1, 4, 4, 4))
    big = torch.ones((1, 8, 8, 4))

    result = node.execute(image_1=small, image_2=big, fit_mode='pad_to_max')
    out = result[0]
    assert out.shape == (2, 8, 8, 4)
    # Corner of the padded (smaller) clip must be fully opaque by default.
    assert out[0, 0, 0, 3] == 1.0


def test_append_pad_to_max_alpha_transparent_opt_in():
    node = ImageOpsAppend()
    small = torch.ones((1, 4, 4, 4))
    big = torch.ones((1, 8, 8, 4))

    result = node.execute(image_1=small, image_2=big, fit_mode='pad_to_max', pad_alpha='transparent')
    out = result[0]
    assert out[0, 0, 0, 3] == 0.0
