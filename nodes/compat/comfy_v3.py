"""ComfyUI V3 native API compatibility and helpers."""
from __future__ import annotations

import logging
import sys
from typing import Any

logger = logging.getLogger(__name__)

try:
    from comfy_api.latest import io as comfy_io
except Exception:
    comfy_io = None


_comfy_node_base = getattr(comfy_io, "ComfyNode", object) if comfy_io is not None else object

class V3NodeBase(_comfy_node_base):
    """Base class providing native ComfyUI V3 execution contract while preserving V1 compatibility."""

    FUNCTION = "apply"

    @classmethod
    def define_schema(cls):
        """Native V3 schema definition."""
        # The custom-node entrypoint exposes its schema helpers on the private
        # package used by the node modules. ComfyUI itself loads that entrypoint
        # under a synthetic name, so importing __init__.py again here would
        # create a second registry and duplicate route registration.
        root_init = sys.modules.get("majoor_imageops")
        schema_builder = getattr(root_init, "_build_legacy_schema", None)
        display_names = getattr(root_init, "NODE_DISPLAY_NAME_MAPPINGS", None)
        if not callable(schema_builder) or not isinstance(display_names, dict):
            raise RuntimeError("ImageOps V3 schema bridge is not initialized")

        node_id = cls.__name__
        display_name = display_names.get(node_id, node_id)
        return schema_builder(node_id, cls, display_name)

    @classmethod
    def execute(cls, **kwargs) -> Any:
        """Classmethod execution endpoint for ComfyUI V3 runtime."""
        fn_name = getattr(cls, "FUNCTION", "apply")
        if fn_name == "execute":
            # The compat wrapper Node20Compat sets FUNCTION = "execute".
            # We must not call execute() recursively. Fall back to "apply".
            fn_name = "apply"
        instance = cls()
        fn = getattr(instance, fn_name)
        return fn(**kwargs)
