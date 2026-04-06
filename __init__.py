"""
ComfyUI custom node entrypoint.

ComfyUI loads custom nodes via `importlib.util.spec_from_file_location()` with a synthetic module name
that is not a Python package, so relative imports like `from .nodes.foo import ...` can fail.

To stay ComfyUI-proof, we create an internal package namespace and load node modules under it.
"""

from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Stable, collision-resistant package prefix for our internal imports.
_PKG = "majoor_imageops"


def _ensure_pkg(name: str, path: Path, file_hint: Path | None = None) -> types.ModuleType:
    mod = sys.modules.get(name)
    if mod is None:
        mod = types.ModuleType(name)
        sys.modules[name] = mod
    mod.__path__ = [str(path)]
    if file_hint is not None:
        mod.__file__ = str(file_hint)
    return mod


def _load_module(mod_name: str, file_path: Path) -> types.ModuleType:
    existing = sys.modules.get(mod_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(mod_name, str(file_path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Unable to load module spec for {mod_name} from {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[mod_name] = module
    spec.loader.exec_module(module)
    return module


# Create internal package + nodes package so node files' relative imports work.
_ensure_pkg(_PKG, BASE_DIR, BASE_DIR / "__init__.py")
_ensure_pkg(f"{_PKG}.nodes", BASE_DIR / "nodes", BASE_DIR / "nodes" / "__init__.py")

_nodes_dir = BASE_DIR / "nodes"
_load_module(f"{_PKG}.server", BASE_DIR / "server.py")

ImageOpsBlur = _load_module(f"{_PKG}.nodes.blur", _nodes_dir / "blur.py").ImageOpsBlur
ImageOpsChannel = _load_module(f"{_PKG}.nodes.channel", _nodes_dir / "channel.py").ImageOpsChannel
ImageOpsComp = _load_module(f"{_PKG}.nodes.comp", _nodes_dir / "comp.py").ImageOpsComp
ImageOpsCrop = _load_module(f"{_PKG}.nodes.crop", _nodes_dir / "crop.py").ImageOpsCrop
ImageOpsDistort = _load_module(f"{_PKG}.nodes.distort", _nodes_dir / "distort.py").ImageOpsDistort
ImageOpsDraw = _load_module(f"{_PKG}.nodes.draw", _nodes_dir / "draw.py").ImageOpsDraw
ImageOpsTransform = _load_module(f"{_PKG}.nodes.transform", _nodes_dir / "transform.py").ImageOpsTransform
ImageOpsColorAjust = _load_module(f"{_PKG}.nodes.color_ajust", _nodes_dir / "color_ajust.py").ImageOpsColorAjust
ImageOpsInvert = _load_module(f"{_PKG}.nodes.invert", _nodes_dir / "invert.py").ImageOpsInvert
ImageOpsClamp = _load_module(f"{_PKG}.nodes.clamp", _nodes_dir / "clamp.py").ImageOpsClamp
ImageOpsMerge = _load_module(f"{_PKG}.nodes.merge", _nodes_dir / "merge.py").ImageOpsMerge
ImageOpsMaskConvert = _load_module(f"{_PKG}.nodes.mask_convert", _nodes_dir / "mask_convert.py").ImageOpsMaskConvert
ImageOpsNoise = _load_module(f"{_PKG}.nodes.noise", _nodes_dir / "noise.py").ImageOpsNoise
ImageOpsPreview = _load_module(f"{_PKG}.nodes.preview", _nodes_dir / "preview.py").ImageOpsPreview

NODE_CLASS_MAPPINGS = {
    "ImageOpsBlur": ImageOpsBlur,
    "ImageOpsChannel": ImageOpsChannel,
    "ImageOpsComp": ImageOpsComp,
    "ImageOpsCrop": ImageOpsCrop,
    "ImageOpsDistort": ImageOpsDistort,
    "ImageOpsDraw": ImageOpsDraw,
    "ImageOpsTransform": ImageOpsTransform,
    "ImageOpsColorAjust": ImageOpsColorAjust,
    "ImageOpsInvert": ImageOpsInvert,
    "ImageOpsClamp": ImageOpsClamp,
    "ImageOpsMerge": ImageOpsMerge,
    "ImageOpsMaskConvert": ImageOpsMaskConvert,
    "ImageOpsNoise": ImageOpsNoise,
    "ImageOpsPreview": ImageOpsPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ImageOpsBlur": "ImageOps Blur",
    "ImageOpsChannel": "ImageOps Channels",
    "ImageOpsComp": "ImageOps Comp",
    "ImageOpsCrop": "ImageOps Resize/Crop",
    "ImageOpsDistort": "ImageOps Distort",
    "ImageOpsDraw": "ImageOps Paint",
    "ImageOpsTransform": "ImageOps Transform",
    # Keep the legacy class key for workflow compatibility, but expose the
    # corrected node name in the UI.
    "ImageOpsColorAjust": "ImageOps Color Correct",
    "ImageOpsInvert": "ImageOps Invert",
    "ImageOpsClamp": "ImageOps Clamp",
    "ImageOpsMerge": "ImageOps Merge",
    "ImageOpsMaskConvert": "ImageOps Mask Convert",
    "ImageOpsNoise": "ImageOps Noise",
    "ImageOpsPreview": "ImageOps Preview",
}

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

# ComfyUI web extension folder
WEB_DIRECTORY = "./js"
