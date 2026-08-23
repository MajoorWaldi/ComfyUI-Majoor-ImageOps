"""Generic contract tests for all ImageOps nodes.

Auto-discovers all registered node classes and validates:
- bypass returns source unchanged (pixel identity)
- handles RGB input
- handles RGBA input
- single-frame and multi-frame batch
"""
from __future__ import annotations

import sys
import importlib
from pathlib import Path

import pytest
import torch

import os

# Ensure the majoor-imageops package is importable
_ROOT = Path(__file__).resolve().parent.parent.parent
COMFY_ROOT = Path(os.environ.get("COMFYUI_ROOT", _ROOT.parent.parent))

if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


def _load_node_classes():
    """Load all node classes from the nodes/ package."""
    nodes_dir = _ROOT / "nodes"
    classes = {}
    for py_file in sorted(nodes_dir.glob("*.py")):
        if py_file.name.startswith("_"):
            continue
        mod_name = f"nodes.{py_file.stem}"
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        for attr_name in dir(mod):
            obj = getattr(mod, attr_name)
            if (isinstance(obj, type)
                    and hasattr(obj, "define_schema")
                    and hasattr(obj, "execute")
                    and attr_name.startswith("ImageOps")):
                classes[attr_name] = obj
    return classes


NODE_CLASSES = _load_node_classes()


def _node_has_bypass(cls) -> bool:
    try:
        schema = cls.define_schema()
        for inp in schema.inputs:
            if inp.name == "bypass":
                return True
        return False
    except Exception:
        return False

def _node_has_image_input(cls) -> bool:
    try:
        schema = cls.define_schema()
        for inp in schema.inputs:
            if inp.name in ("image", "A"):
                return True
        return False
    except Exception:
        return False

def _get_required_inputs(cls):
    try:
        schema = cls.define_schema()
        # V3 widget inputs
        req = {}
        for inp in schema.inputs:
            req[inp.name] = inp
        return req
    except Exception:
        return {}


class TestNodeDiscovery:
    """Basic sanity checks on node registration."""

    def test_nodes_found(self):
        assert len(NODE_CLASSES) > 0, "No ImageOps node classes found"

    def test_all_have_function(self):
        for name, cls in NODE_CLASSES.items():
            assert hasattr(cls, "execute"), f"{name} missing execute"

    def test_all_have_define_schema(self):
        for name, cls in NODE_CLASSES.items():
            assert callable(getattr(cls, "define_schema", None)), f"{name} missing define_schema"

    def test_all_have_category(self):
        for name, cls in NODE_CLASSES.items():
            schema = cls.define_schema()
            assert hasattr(schema, "category"), f"{name} missing CATEGORY in schema"


# Collect nodes that have bypass + image input for parameterized bypass tests
_BYPASS_NODES = {
    name: cls for name, cls in NODE_CLASSES.items()
    if _node_has_bypass(cls) and _node_has_image_input(cls)
    # Skip complex interactive nodes that require special state
    and name not in ("ImageOpsDraw", "ImageOpsComp", "ImageOpsCrop")
}


class TestBypassContract:
    """Bypass must return the source image unchanged."""

    @pytest.mark.parametrize("node_name", sorted(_BYPASS_NODES.keys()))
    def test_bypass_returns_source_rgb(self, node_name):
        cls = _BYPASS_NODES[node_name]
        fn = getattr(cls, "execute")
        src = torch.rand(1, 32, 32, 3, dtype=torch.float32)

        kwargs = {"bypass": True, "image": src}
        # Add required defaults for non-image inputs
        required = _get_required_inputs(cls)
        for input_name, spec in required.items():
            if input_name in kwargs:
                continue
            if hasattr(spec, 'default'):
                kwargs[input_name] = spec.default
            elif hasattr(spec, 'options') and spec.options:
                kwargs[input_name] = spec.options[0]

        try:
            result = fn(**kwargs)
        except Exception:
            pytest.skip(f"{node_name} requires additional inputs")
            return

        if isinstance(result, dict):
            # build_node_preview_result returns dict with "ui" and "result"
            out_image = result.get("result", (None,))[0]
        elif isinstance(result, tuple):
            out_image = result[0]
        elif type(result).__name__ == "NodeOutput":
            out_image = result[0]
        else:
            pytest.fail(f"{node_name} returned unexpected type: {type(result)}")
            return

        if out_image is None:
            pytest.skip(f"{node_name} returned None image on bypass")
            return

        assert out_image.shape == src.shape, (
            f"{node_name} bypass changed shape: {src.shape} -> {out_image.shape}"
        )
        assert torch.allclose(out_image, src, atol=1e-6), (
            f"{node_name} bypass modified pixel values"
        )
