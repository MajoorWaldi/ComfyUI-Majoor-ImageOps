"""Integration-test bootstrap for a real ComfyUI checkout."""

from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest


COMFYUI_ROOT = Path(
    os.environ.get("COMFYUI_ROOT", "/tmp/ComfyUI")
).resolve()

EXTENSION_ROOT = (
    COMFYUI_ROOT
    / "custom_nodes"
    / "ComfyUI-Majoor-ImageOps"
).resolve()


# Important:
# ComfyUI is cloned, not installed as a normal Python package.
# Therefore comfy_api, folder_paths, server, etc. need the ComfyUI
# repository root on sys.path.
if str(COMFYUI_ROOT) not in sys.path:
    sys.path.insert(0, str(COMFYUI_ROOT))


@pytest.fixture(scope="session")
def imageops_extension():
    """Load ImageOps exactly from ComfyUI/custom_nodes."""

    init_file = EXTENSION_ROOT / "__init__.py"

    assert COMFYUI_ROOT.is_dir(), (
        f"COMFYUI_ROOT does not exist: {COMFYUI_ROOT}"
    )

    assert init_file.is_file(), (
        f"ImageOps extension was not copied correctly: {init_file}"
    )

    module_name = "imageops_ci_extension"

    spec = importlib.util.spec_from_file_location(
        module_name,
        init_file,
        submodule_search_locations=[str(EXTENSION_ROOT)],
    )

    assert spec is not None
    assert spec.loader is not None

    module = importlib.util.module_from_spec(spec)

    sys.modules[module_name] = module
    spec.loader.exec_module(module)

    return module
