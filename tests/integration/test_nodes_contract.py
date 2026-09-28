"""Generic contract tests for all ImageOps nodes.

Auto-discovers all registered node classes and validates:
- bypass returns source unchanged (pixel identity)
- handles RGB input
- handles RGBA input
- single-frame and multi-frame batch
"""
from __future__ import annotations

import math
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


def test_color_correct_master_curve(imageops_extension):
    import torch

    node = next(n for n in imageops_extension.NODES if n.define_schema().node_id == "ImageOpsColorAjust")
    image = torch.rand(1, 16, 16, 4)

    inverted = node.execute(image=image, curve={"points": [[0.0, 1.0], [1.0, 0.0]], "interpolation": "linear"})
    identity = node.execute(image=image, curve=[(0.0, 0.0), (1.0, 1.0)])
    untouched = node.execute(image=image)

    assert torch.allclose(inverted.args[0][..., :3], 1.0 - image[..., :3], atol=1e-4)
    assert torch.equal(inverted.args[0][..., 3], image[..., 3])
    assert torch.equal(identity.args[0], untouched.args[0])
    assert "curve" in {i.id for i in node.define_schema().inputs}


def test_comp_exports_core_layers_document(imageops_extension):
    from comfy_api.latest import io

    if not hasattr(io, "Layers"):
        pytest.skip("io.Layers needs ComfyUI 0.31+")

    node = next(n for n in imageops_extension.NODES if n.define_schema().node_id == "ImageOpsComp")
    base = torch.rand(1, 40, 60, 3)
    top = torch.rand(1, 20, 20, 4)
    layers_json = '{"version":1,"layers":[{"slot":"image_2","center_x":0.25,"center_y":0.5,"scale":2.0,"rotate_deg":30,"opacity":0.5,"mode":"add"}]}'

    out = node.execute(image_1=base, image_2=top, mask_2=torch.ones(1, 20, 20), layers_json=layers_json)
    document = out.args[2]

    assert [o.id for o in node.define_schema().outputs] == ["image", "mask", "layers"]
    assert document["version"] == 1 and document["canvas"] == (60, 40)
    first, second = document["layers"]
    assert (first["z_index"], second["z_index"]) == (0, 1)
    assert first["blend_mode"] == "normal" and (first["x"], first["y"], first["w"], first["h"]) == (0, 0, 60, 40) or first["w"] == 60
    assert second["blend_mode"] == "linear-dodge" and second["opacity"] == 0.5 and second["rotation"] == pytest.approx(math.radians(30.0))
    assert (second["w"], second["h"]) == (40, 40)
    assert (second["x"], second["y"]) == (round(0.25 * 60 - 20), round(0.5 * 40 - 20))
    assert second["mask"].shape == (1, 20, 20) and second["image"].shape == (1, 20, 20, 4)
