"""Real integration test using ComfyUI environment."""
from __future__ import annotations

import os
import sys
import uuid
import importlib.util
from pathlib import Path

import pytest

# Find ComfyUI root
_ROOT = Path(__file__).resolve().parent.parent.parent
COMFY_ROOT = Path(os.environ.get("COMFYUI_ROOT", _ROOT.parent.parent))


def _load_comfyui():
    """Attempt to load ComfyUI and its execution environment."""
    if not (COMFY_ROOT / "comfy_api" / "latest").is_dir() and not (COMFY_ROOT / "execution.py").exists():
        pytest.skip(f"ComfyUI checkout is not available at {COMFY_ROOT}")
        return False
        
    if str(COMFY_ROOT) not in sys.path:
        sys.path.insert(0, str(COMFY_ROOT))
    
    # Try importing execution to verify ComfyUI is loadable
    try:
        import execution
    except ImportError:
        pytest.skip(f"Could not import execution from ComfyUI at {COMFY_ROOT}")
        return False
        
    return True

def test_integration_load_nodes():
    """Test loading the module and instantiating each node mapped in NODE_CLASS_MAPPINGS."""
    if not _load_comfyui():
        return
        
    # We must load the custom node exactly as ComfyUI would
    module_name = f"custom_nodes.majoor_imageops_integration_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(
        module_name,
        _ROOT / "__init__.py",
        submodule_search_locations=[str(_ROOT)],
    )
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    
    # Validate mapping exists
    assert hasattr(module, "NODE_CLASS_MAPPINGS")
    
    # Check each node can be instantiated in the real environment
    for name, cls in module.NODE_CLASS_MAPPINGS.items():
        try:
            instance = cls()
        except Exception as e:
            pytest.fail(f"Failed to instantiate node '{name}' from class {cls.__name__}: {e}")
