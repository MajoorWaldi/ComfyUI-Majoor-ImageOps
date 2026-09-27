"""Node replacement registry for ImageOps.

Register an entry here only when a node's ID, widget layout, or output order
changes in a way that would otherwise strand saved workflows. Additive schema
changes (a new optional input, a new output appended at the end) do not need
an entry — those stay backward compatible on their own.

See comfy_api.latest.io.NodeReplace for the mapping fields.
"""
from __future__ import annotations

from comfy_api.latest import ComfyAPI, io

REPLACEMENTS: list[io.NodeReplace] = [
    # Example, once a node is actually renamed/restructured:
    # io.NodeReplace(
    #     new_node_id="ImageOpsChannelShuffle",
    #     old_node_id="ImageOpsChannel",
    #     old_widget_ids=["bypass", "channel"],
    #     input_mapping=[{"new_id": "image", "old_id": "image"}],
    #     output_mapping=[{"new_idx": 0, "old_idx": 0}],
    # ),
]


async def register_node_replacements() -> None:
    if not REPLACEMENTS:
        return
    api = ComfyAPI()
    for replacement in REPLACEMENTS:
        await api.node_replacement.register(replacement)
