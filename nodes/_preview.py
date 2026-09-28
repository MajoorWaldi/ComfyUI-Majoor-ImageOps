import torch

from comfy_api.latest import io

from .core.memory import to_intermediate_device
from .core.media import ImageOpsMedia

def build_node_preview_result(_images, result, prefix=None, fps=None, metadata=None):  # noqa: ARG001
    if not isinstance(result, tuple):
        result = (result,)
    result = tuple(to_intermediate_device(r) if torch.is_tensor(r) else r for r in result)

    if len(result) > 0 and isinstance(result[0], ImageOpsMedia):
        media = result[0]
        if media.audio is not None:
            # Native ComfyUI VIDEO format
            # audio waveform is typically (batch, channels, samples)
            audio_waveform = media.audio.unsqueeze(0) if media.audio.dim() == 2 else media.audio
            audio_dict = {"waveform": audio_waveform, "sample_rate": getattr(media, 'sample_rate', 44100)}
            public_output = {"samples": media.frames, "audio": audio_dict}
        else:
            public_output = media.frames
        result = (public_output,) + result[1:]
        
    if metadata is not None:
        return io.NodeOutput(*result, ui=metadata)
    return io.NodeOutput(*result)
