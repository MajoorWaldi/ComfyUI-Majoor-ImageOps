"""Tests that RETURN_TYPES scalar outputs have the correct Python types at runtime.

This catches the V3 schema bug where INT/FLOAT/BOOL were silently converted to
String.Output in the generated schema, making numeric sockets incompatible with
INT connections in ComfyUI's node graph.

These tests exercise the *backend return values* (what the node actually returns)
to confirm the pipeline produces the right Python types — independent of whether
the V3 schema is even available.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
import torch

import os

# Ensure the nodes package is importable without triggering the ComfyUI entrypoint.
_ROOT = Path(__file__).resolve().parent.parent.parent
COMFY_ROOT = Path(os.environ.get("COMFYUI_ROOT", _ROOT.parent.parent))
_NODES_DIR = _ROOT / "nodes"
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))


# ---------------------------------------------------------------------------
# Helpers to load individual node modules directly (no ComfyUI import chain)
# ---------------------------------------------------------------------------

def _import_node(module_suffix: str, class_name: str):
    """Import a node class from nodes/<module_suffix>.py without loading __init__.py."""
    import importlib
    mod = importlib.import_module(f"nodes.{module_suffix}")
    return getattr(mod, class_name)


# ---------------------------------------------------------------------------
# ImageOpsConstant — RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT")
# Expected: result[2], result[3], result[4] are int
# ---------------------------------------------------------------------------

class TestConstantOutputTypes:
    def test_width_height_framecount_are_int(self):
        cls = _import_node("constant", "ImageOpsConstant")
        instance = cls()
        result = instance.execute(
            mode="constant",
            width=64,
            height=64,
            aspect_ratio="custom",
            frame_count=2,
            color="#ffffff",
            color_b="#000000",
            alpha=1.0,
            tile_size=64,
            offset_x=0,
            offset_y=0,
        )
        # build_node_preview_result wraps as {"result": (...), "ui": {...}}
        outputs = result["result"] if isinstance(result, dict) else result
        _, _, width, height, frame_count = outputs
        assert isinstance(width, int), f"width should be int, got {type(width)}"
        assert isinstance(height, int), f"height should be int, got {type(height)}"
        assert isinstance(frame_count, int), f"frame_count should be int, got {type(frame_count)}"
        assert width == 64
        assert height == 64
        assert frame_count == 2


# ---------------------------------------------------------------------------
# ImageOpsRamp — RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT", "INT")
# ---------------------------------------------------------------------------

class TestRampOutputTypes:
    def test_width_height_framecount_are_int(self):
        cls = _import_node("ramp", "ImageOpsRamp")
        instance = cls()
        result = instance.execute(
            width=32,
            height=32,
            frame_count=3,
            color_a="#000000",
            color_b="#ffffff",
            alpha=1.0,
            start_x=0.0,
            start_y=0.5,
            end_x=1.0,
            end_y=0.5,
            ramp_shape="linear",
            ramp_mode="linear",
            invert=False,
        )
        outputs = result["result"] if isinstance(result, dict) else result
        _, _, width, height, frame_count = outputs
        assert isinstance(width, int), f"width should be int, got {type(width)}"
        assert isinstance(height, int), f"height should be int, got {type(height)}"
        assert isinstance(frame_count, int), f"frame_count should be int, got {type(frame_count)}"
        assert width == 32
        assert height == 32
        assert frame_count == 3


# ---------------------------------------------------------------------------
# ImageOpsPadOut — RETURN_TYPES = ("IMAGE", "MASK", "INT", "INT")
# ---------------------------------------------------------------------------

class TestPadOutOutputTypes:
    def test_width_height_are_int(self):
        cls = _import_node("padout", "ImageOpsPadOut")
        instance = cls()
        src = torch.zeros(1, 32, 32, 3, dtype=torch.float32)
        result = instance.execute(
            image=src,
            bypass=False,
            pad_left=8,
            pad_top=8,
            pad_right=8,
            pad_bottom=8,
            target_format="custom",
            fill_mode="constant",
            fill_color="#000000",
            blur_radius=0,
            invert_mask=False,
        )
        outputs = result["result"] if isinstance(result, dict) else result
        _, _, width, height = outputs
        assert isinstance(width, int), f"width should be int, got {type(width)}"
        assert isinstance(height, int), f"height should be int, got {type(height)}"
        assert width == 48
        assert height == 48


# ---------------------------------------------------------------------------
# ImageOpsFrameRange — RETURN_TYPES = ("IMAGE", "INT")
# ---------------------------------------------------------------------------

class TestFrameRangeOutputTypes:
    def test_frame_count_is_int(self):
        cls = _import_node("frame_range", "ImageOpsFrameRange")
        instance = cls()
        src = torch.rand(5, 32, 32, 3, dtype=torch.float32)
        result = instance.execute(
            image=src,
            bypass=False,
            trim_start=1,
            trim_end=3,
            frame_hold=False,
            hold_frame=0,
            repeat=False,
            repeat_mode="loop",
            custom_frame_count=24,
        )
        outputs = result["result"] if isinstance(result, dict) else result
        _, frame_count = outputs
        assert isinstance(frame_count, int), f"frame_count should be int, got {type(frame_count)}"
        assert frame_count == 3  # frames 1,2,3 inclusive


# ---------------------------------------------------------------------------
# ImageOpsAppend — RETURN_TYPES = ("IMAGE", "INT", "INT", "INT")
# ---------------------------------------------------------------------------

class TestAppendOutputTypes:
    def test_frame_count_width_height_are_int(self):
        cls = _import_node("append", "ImageOpsAppend")
        instance = cls()
        clip_a = torch.rand(2, 32, 32, 3, dtype=torch.float32)
        clip_b = torch.rand(3, 32, 32, 3, dtype=torch.float32)
        result = instance.execute(
            bypass=False,
            fit_mode="strict",
            trims_json='{"version":1,"clips":[]}',
            image_1=clip_a,
            image_2=clip_b,
        )
        outputs = result["result"] if isinstance(result, dict) else result
        _, frame_count, width, height = outputs
        assert isinstance(frame_count, int), f"frame_count should be int, got {type(frame_count)}"
        assert isinstance(width, int), f"width should be int, got {type(width)}"
        assert isinstance(height, int), f"height should be int, got {type(height)}"
        assert frame_count == 5
        assert width == 32
        assert height == 32


# ---------------------------------------------------------------------------
# Parametric sweep: verify RETURN_TYPES declarations match Python field types
# ---------------------------------------------------------------------------

_NUMERIC_NODE_SPECS = [
    ("constant", "ImageOpsConstant", (2, 3, 4), int),
    ("ramp", "ImageOpsRamp", (2, 3, 4), int),
    ("padout", "ImageOpsPadOut", (2, 3), int),
    ("frame_range", "ImageOpsFrameRange", (1,), int),
    ("append", "ImageOpsAppend", (1, 2, 3), int),
]


@pytest.mark.parametrize("module,classname,int_indices,expected_type", _NUMERIC_NODE_SPECS)
def test_return_types_annotation_match(module, classname, int_indices, expected_type):
    """Verify that RETURN_TYPES declares INT for the expected output indices."""
    cls = _import_node(module, classname)
    return_types = getattr(cls, "RETURN_TYPES", ())
    for idx in int_indices:
        actual = return_types[idx] if idx < len(return_types) else None
        assert actual == "INT", (
            f"{classname}.RETURN_TYPES[{idx}] should be 'INT', got {actual!r}. "
            "This means _make_schema_output will generate the wrong V3 socket type."
        )
