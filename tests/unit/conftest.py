"""Bootstrap for pure ImageOps unit tests.

The unit suite must be runnable WITHOUT ComfyUI installed.

We expose the `nodes` directory as a lightweight namespace package
without executing nodes/__init__.py, because nodes/__init__.py imports
the actual ComfyUI node classes and therefore comfy_api.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
NODES_DIR = ROOT / "nodes"


def pytest_configure(config):
    del config

    existing = sys.modules.get("nodes")

    if existing is not None:
        return

    package = types.ModuleType("nodes")

    package.__path__ = [
        str(NODES_DIR)
    ]

    package.__package__ = "nodes"

    package.__file__ = str(
        NODES_DIR / "__init__.py"
    )

    sys.modules["nodes"] = package
