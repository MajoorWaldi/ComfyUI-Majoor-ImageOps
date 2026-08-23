from __future__ import annotations

import torch

from nodes.core.media import ImageOpsMedia


def test_media_dataclass_basic():
    frames = torch.ones(
        (2, 64, 64, 3)
    )

    audio = torch.zeros(
        (1, 48000)
    )

    media = ImageOpsMedia(
        frames=frames,
        fps=30.0,
        audio=audio,
        metadata={
            "custom": "data",
        },
    )

    assert media.frame_count == 2
    assert media.fps == 30.0

    assert (
        media.metadata["custom"]
        == "data"
    )


def test_media_clone():
    frames = torch.ones(
        (2, 64, 64, 3)
    )

    audio = torch.zeros(
        (1, 48000)
    )

    media = ImageOpsMedia(
        frames=frames,
        fps=24.0,
        audio=audio,
    )

    cloned = media.clone()

    assert cloned.frames is not media.frames

    assert torch.allclose(
        cloned.frames,
        media.frames,
    )

    assert cloned.audio is not media.audio
