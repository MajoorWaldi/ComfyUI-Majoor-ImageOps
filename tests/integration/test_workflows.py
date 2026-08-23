"""Workflow and subgraph schema compatibility tests."""
from __future__ import annotations

import json
from pathlib import Path
import pytest

from nodes import (
    ImageOpsBlur,
    ImageOpsChannel,
    ImageOpsClamp,
    ImageOpsColorAjust,
    ImageOpsComp,
    ImageOpsCornerPin,
    ImageOpsCrop,
    ImageOpsDistort,
    ImageOpsDraw,
    ImageOpsInvert,
    ImageOpsMaskConvert,
    ImageOpsMerge,
    ImageOpsNoise,
    ImageOpsPadOut,
    ImageOpsPreview,
    ImageOpsSpherize,
    ImageOpsTransform,
)


ALL_NODES = [
    ImageOpsBlur,
    ImageOpsChannel,
    ImageOpsClamp,
    ImageOpsColorAjust,
    ImageOpsComp,
    ImageOpsCornerPin,
    ImageOpsCrop,
    ImageOpsDistort,
    ImageOpsDraw,
    ImageOpsInvert,
    ImageOpsMaskConvert,
    ImageOpsMerge,
    ImageOpsNoise,
    ImageOpsPadOut,
    ImageOpsPreview,
    ImageOpsSpherize,
    ImageOpsTransform,
]


class TestWorkflowCompatibility:
    """Verify that all nodes provide valid schemas and default parameters for workflow graphs."""

    @pytest.mark.parametrize("node_cls", ALL_NODES, ids=lambda c: c.__name__)
    def test_node_schema_structure(self, node_cls):
        inputs = node_cls.INPUT_TYPES()
        assert isinstance(inputs, dict)
        assert "required" in inputs or "optional" in inputs

        required = inputs.get("required", {})
        for name, spec in required.items():
            assert isinstance(spec, (tuple, list)), f"{node_cls.__name__}.{name} spec must be tuple/list"
            assert len(spec) >= 1

    @pytest.mark.parametrize("node_cls", ALL_NODES, ids=lambda c: c.__name__)
    def test_node_instantiation_and_function(self, node_cls):
        node = node_cls()
        func_name = getattr(node_cls, "FUNCTION")
        assert hasattr(node, func_name), f"{node_cls.__name__} missing function {func_name}"
