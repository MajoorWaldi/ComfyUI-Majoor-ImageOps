import torch

from comfy_api.latest import io

from .core.memory import to_intermediate_device
from .core.media import ImageOpsMedia

def build_node_preview_result(_images, result, prefix=None, fps=None, metadata=None):  # noqa: ARG001
    if not isinstance(result, tuple):
        result = (result,)
    result = tuple(to_intermediate_device(r) if torch.is_tensor(r) else r for r in result)

    if len(result) > 0 and isinstance(result[0], ImageOpsMedia):
        # The IMAGE output socket only ever carries a tensor; audio/fps travel
        # through the node's own VIDEO output instead.
        result = (result[0].frames,) + result[1:]
        
    if metadata is not None:
        return io.NodeOutput(*result, ui=metadata)
    return io.NodeOutput(*result)
