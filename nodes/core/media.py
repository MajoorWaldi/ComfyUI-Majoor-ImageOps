import torch
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

@dataclass
class ImageOpsMedia:
    """
    A unified media object representing a batch of frames, optionally with audio and timing metadata.
    This replaces the raw tensor transport to allow video streams to preserve FPS and audio.
    """
    frames: torch.Tensor
    fps: float = 24.0
    audio: Optional[torch.Tensor] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    def __post_init__(self):
        if self.frames is not None and not isinstance(self.frames, torch.Tensor):
            raise TypeError(f"ImageOpsMedia frames must be a torch.Tensor, got {type(self.frames)}")
        if self.audio is not None and not isinstance(self.audio, torch.Tensor):
            raise TypeError(f"ImageOpsMedia audio must be a torch.Tensor, got {type(self.audio)}")

    @property
    def frame_count(self) -> int:
        if self.frames is None:
            return 0
        return int(self.frames.shape[0])

    def clone(self) -> "ImageOpsMedia":
        return ImageOpsMedia(
            frames=self.frames.clone() if self.frames is not None else None,
            fps=self.fps,
            audio=self.audio.clone() if self.audio is not None else None,
            metadata=dict(self.metadata)
        )
