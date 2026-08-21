"""Integration checks for the node definitions exposed to ComfyUI's object_info API."""
from __future__ import annotations

import importlib.util
import sys
import types
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent.parent
COMFY_ROOT = ROOT.parent.parent


class _Routes:
    def get(self, _path):
        return lambda function: function


def _load_entrypoint(monkeypatch):
    if not (COMFY_ROOT / "comfy_api" / "latest").is_dir():
        pytest.skip("ComfyUI checkout is not available for registry integration testing")

    monkeypatch.syspath_prepend(str(COMFY_ROOT))

    server_stub = types.ModuleType("server")
    server_stub.PromptServer = type(
        "PromptServer",
        (),
        {"instance": types.SimpleNamespace(routes=_Routes())},
    )
    server_stub.web = types.SimpleNamespace()
    monkeypatch.setitem(sys.modules, "server", server_stub)

    folder_paths_stub = types.ModuleType("folder_paths")
    folder_paths_stub.get_input_directory = lambda: str(ROOT)
    folder_paths_stub.get_output_directory = lambda: str(ROOT)
    folder_paths_stub.get_temp_directory = lambda: str(ROOT)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths_stub)

    module_name = f"custom_nodes.majoor_imageops_registry_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(
        module_name,
        ROOT / "__init__.py",
        submodule_search_locations=[str(ROOT)],
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, module_name, module)
    spec.loader.exec_module(module)
    return module


def test_all_26_nodes_publish_object_info(monkeypatch):
    module = _load_entrypoint(monkeypatch)
    assert len(module.NODE_CLASS_MAPPINGS) == 26

    for node_id, node_class in module.NODE_CLASS_MAPPINGS.items():
        if hasattr(node_class, "GET_NODE_INFO_V1"):
            info = node_class.GET_NODE_INFO_V1()
            if isinstance(info, dict):
                assert info["name"] == node_id
                assert info["input"] is not None
            else:
                assert info.name == node_id
                assert info.input is not None
        else:
            assert isinstance(node_class.INPUT_TYPES(), dict)
