"""ComfyUI V3 native API compatibility and helpers."""
from __future__ import annotations

import logging
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
        import sys
        from pathlib import Path
        import importlib.util
        
        import sys
        
        # ComfyUI's __init__.py registers the root as 'majoor_imageops'.
        root_init = sys.modules.get("majoor_imageops")
        if root_init is None:
            # Fallback for dynamic loading
            from pathlib import Path
            import importlib.util
            root_path = Path(__file__).resolve().parent.parent.parent
            spec = importlib.util.spec_from_file_location("majoor_root", root_path / "__init__.py")
            root_init = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(root_init)

        node_id = cls.__name__
        display_name = root_init.NODE_DISPLAY_NAME_MAPPINGS.get(node_id, node_id)
        return root_init._build_legacy_schema(node_id, cls, display_name)

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
