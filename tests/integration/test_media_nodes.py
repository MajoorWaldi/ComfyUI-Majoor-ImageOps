from fractions import Fraction

import pytest
import torch

from nodes.core.media import ImageOpsMedia
from nodes.append import ImageOpsAppend
from nodes.frame_range import ImageOpsFrameRange
from comfy_api.latest import io, VideoComponents, VideoFromComponents, VideoFromList


class _FakeLazyVideo:
    """Mimics VideoFromFile's lazy contract (get_frame_count/get_frame_rate read
    container metadata; as_trimmed avoids decoding) without needing a real file."""

    def __init__(self, images, fps, audio=None, sample_rate=44100):
        self._images = images
        self._fps = fps
        self._audio = audio
        self._sample_rate = sample_rate
        self.get_components_calls = 0

    def get_components(self):
        self.get_components_calls += 1
        audio_dict = None
        if self._audio is not None:
            audio_dict = {"waveform": self._audio.unsqueeze(0), "sample_rate": self._sample_rate}
        return VideoComponents(images=self._images, audio=audio_dict, frame_rate=Fraction(self._fps))

    def get_frame_count(self):
        return int(self._images.shape[0])

    def get_frame_rate(self):
        return Fraction(self._fps)

    def as_trimmed(self, start_time, duration):
        start_idx = int(round(start_time * self._fps))
        count = int(round(duration * self._fps))
        trimmed_audio = self._audio
        return _FakeLazyVideo(self._images[start_idx:start_idx + count], self._fps, trimmed_audio, self._sample_rate)

    def save_to(self, path, **kwargs):
        # VideoFromList falls back to this for any source that isn't a real
        # VideoFromFile; the real implementation would encode self.get_components()
        # into `path`, which isn't needed for these tests.
        self.get_components()


def test_multitype_api_available():
    assert hasattr(io, "MultiType")
    assert hasattr(io.MultiType, "Input")


def test_frame_range_preserves_media():
    node = ImageOpsFrameRange()
    frames = torch.ones((10, 16, 16, 3))
    for i in range(10):
        frames[i] *= (i + 1)
        
    audio = torch.ones((1, 44100))  # long enough to cover all 10 frames at 60fps
    media = ImageOpsMedia(frames=frames, fps=60.0, audio=audio)
    
    result = node.execute(image=media, trim_start=2, trim_end=4)
    out_frames = result[0]
    assert torch.is_tensor(out_frames)
    # check that values are correct
    assert torch.allclose(out_frames[0], torch.ones((16, 16, 3)) * 3)
    # Audio/fps travel through the VIDEO output instead of the IMAGE output.
    video_out = result[2]
    components = video_out.get_components()
    assert components.audio is not None


def test_frame_range_native_trim_avoids_full_decode():
    frames = torch.arange(10 * 4 * 4 * 3, dtype=torch.float32).reshape(10, 4, 4, 3)
    fake = _FakeLazyVideo(frames, fps=30.0)

    result = ImageOpsFrameRange().execute(image=fake, trim_start=2, trim_end=4)

    out_frames = result[0]
    assert torch.allclose(out_frames, frames[2:5])
    assert result[1] == 3
    # The source clip's own get_components() must never run — only the
    # already-trimmed sub-clip is decoded, which is the whole point of the fast path.
    assert fake.get_components_calls == 0


def test_frame_range_native_trim_skipped_for_hold_and_repeat():
    frames = torch.arange(10 * 4 * 4 * 3, dtype=torch.float32).reshape(10, 4, 4, 3)
    fake = _FakeLazyVideo(frames, fps=30.0)

    ImageOpsFrameRange().execute(image=fake, trim_start=2, trim_end=4, frame_hold=True, hold_frame=3)

    # frame_hold/repeat have no native equivalent, so the full decode path must run.
    assert fake.get_components_calls == 1


def test_append_preserves_media():
    node = ImageOpsAppend()
    frames1 = torch.ones((2, 16, 16, 3))
    media1 = ImageOpsMedia(frames=frames1, fps=24.0, audio=torch.zeros((1, 100)))

    frames2 = torch.zeros((3, 16, 16, 3))
    media2 = ImageOpsMedia(frames=frames2, fps=24.0, audio=torch.ones((1, 100)))

    result = node.execute(image_1=media1, image_2=media2)
    out_frames = result[0]
    assert torch.is_tensor(out_frames)
    assert out_frames.shape[0] == 5
    video_out = result[4]
    components = video_out.get_components()
    assert components.audio is not None
    out_audio = components.audio['waveform']
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


def test_append_native_concat_uses_video_from_list_when_all_clips_are_video():
    frames1 = torch.rand(4, 64, 64, 3)
    frames2 = torch.rand(3, 64, 64, 3)
    clip1 = VideoFromComponents(VideoComponents(images=frames1, frame_rate=Fraction(24)))
    clip2 = VideoFromComponents(VideoComponents(images=frames2, frame_rate=Fraction(24)))

    result = ImageOpsAppend().execute(image_1=clip1, image_2=clip2, fit_mode='strict')

    video_out = result[4]
    assert isinstance(video_out, VideoFromList)
    components = video_out.get_components()
    assert components.images.shape[0] == 7


def test_append_native_concat_skipped_for_pad_to_max():
    frames1 = torch.zeros(2, 4, 4, 3)
    frames2 = torch.zeros(2, 8, 8, 3)
    clip1 = _FakeLazyVideo(frames1, fps=24.0)
    clip2 = _FakeLazyVideo(frames2, fps=24.0)

    result = ImageOpsAppend().execute(image_1=clip1, image_2=clip2, fit_mode='pad_to_max')

    # pad_to_max isn't a native-eligible mode (clips may end up different sizes),
    # so the VIDEO output must fall back to re-encoding the aligned/padded tensor.
    assert not isinstance(result[4], VideoFromList)


def test_append_plain_images_video_output_uses_image_fps():
    node = ImageOpsAppend()
    frames = torch.ones((60, 4, 4, 3))

    result = node.execute(image_1=frames, image_fps=60.0)
    video_out = result[4]
    components = video_out.get_components()
    assert float(components.frame_rate) == pytest.approx(60.0)


def test_frame_range_bypass_returns_tensor_not_raw_video():
    node = ImageOpsFrameRange()
    frames = torch.ones((5, 4, 4, 3))
    media = ImageOpsMedia(frames=frames, fps=30.0)

    result = node.execute(image=media, bypass=True)
    assert torch.is_tensor(result[0])
