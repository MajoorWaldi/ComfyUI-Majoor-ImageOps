from __future__ import annotations

import sys
from pathlib import Path

try:
    from comfy_api.latest import io as _node20_io
    from comfy_api.latest import ComfyExtension
except Exception:  # pragma: no cover
    _node20_io = None
    ComfyExtension = object

BASE_DIR = Path(__file__).resolve().parent

import importlib.util
import types

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

_internal_package = _ensure_pkg(_PKG, BASE_DIR, BASE_DIR / "__init__.py")
_ensure_pkg(f"{_PKG}.nodes", BASE_DIR / "nodes", BASE_DIR / "nodes" / "__init__.py")

_nodes_dir = BASE_DIR / "nodes"

ImageOpsBlur = _load_module(f"{_PKG}.nodes.blur", _nodes_dir / "blur.py").ImageOpsBlur
ImageOpsChannel = _load_module(f"{_PKG}.nodes.channel", _nodes_dir / "channel.py").ImageOpsChannel
ImageOpsCornerPin = _load_module(f"{_PKG}.nodes.corner_pin", _nodes_dir / "corner_pin.py").ImageOpsCornerPin
ImageOpsComp = _load_module(f"{_PKG}.nodes.comp", _nodes_dir / "comp.py").ImageOpsComp
ImageOpsCrop = _load_module(f"{_PKG}.nodes.crop", _nodes_dir / "crop.py").ImageOpsCrop
ImageOpsCropStitch = _load_module(f"{_PKG}.nodes.crop_stitch", _nodes_dir / "crop_stitch.py").ImageOpsCropStitch
ImageOpsDistort = _load_module(f"{_PKG}.nodes.distort", _nodes_dir / "distort.py").ImageOpsDistort
ImageOpsDraw = _load_module(f"{_PKG}.nodes.draw", _nodes_dir / "draw.py").ImageOpsDraw
ImageOpsTransform = _load_module(f"{_PKG}.nodes.transform", _nodes_dir / "transform.py").ImageOpsTransform
ImageOpsColorAjust = _load_module(f"{_PKG}.nodes.color_ajust", _nodes_dir / "color_ajust.py").ImageOpsColorAjust
ImageOpsInvert = _load_module(f"{_PKG}.nodes.invert", _nodes_dir / "invert.py").ImageOpsInvert
ImageOpsClamp = _load_module(f"{_PKG}.nodes.clamp", _nodes_dir / "clamp.py").ImageOpsClamp
ImageOpsMerge = _load_module(f"{_PKG}.nodes.merge", _nodes_dir / "merge.py").ImageOpsMerge
ImageOpsMaskConvert = _load_module(f"{_PKG}.nodes.mask_convert", _nodes_dir / "mask_convert.py").ImageOpsMaskConvert
ImageOpsNoise = _load_module(f"{_PKG}.nodes.noise", _nodes_dir / "noise.py").ImageOpsNoise
ImageOpsPadOut = _load_module(f"{_PKG}.nodes.padout", _nodes_dir / "padout.py").ImageOpsPadOut
ImageOpsPreview = _load_module(f"{_PKG}.nodes.preview", _nodes_dir / "preview.py").ImageOpsPreview
ImageOpsSpherize = _load_module(f"{_PKG}.nodes.spherize", _nodes_dir / "spherize.py").ImageOpsSpherize
ImageOpsConstant = _load_module(f"{_PKG}.nodes.constant", _nodes_dir / "constant.py").ImageOpsConstant
ImageOpsRamp = _load_module(f"{_PKG}.nodes.ramp", _nodes_dir / "ramp.py").ImageOpsRamp
ImageOpsGrain = _load_module(f"{_PKG}.nodes.grain", _nodes_dir / "grain.py").ImageOpsGrain
ImageOpsCameraShake = _load_module(f"{_PKG}.nodes.camera_shake", _nodes_dir / "camera_shake.py").ImageOpsCameraShake
ImageOpsKeyer = _load_module(f"{_PKG}.nodes.keyer", _nodes_dir / "keyer.py").ImageOpsKeyer
ImageOpsText = _load_module(f"{_PKG}.nodes.text", _nodes_dir / "text.py").ImageOpsText
ImageOpsFrameRange = _load_module(f"{_PKG}.nodes.frame_range", _nodes_dir / "frame_range.py").ImageOpsFrameRange
ImageOpsAppend = _load_module(f"{_PKG}.nodes.append", _nodes_dir / "append.py").ImageOpsAppend

NODES = [
    ImageOpsBlur,
    ImageOpsChannel,
    ImageOpsCornerPin,
    ImageOpsComp,
    ImageOpsCrop,
    ImageOpsCropStitch,
    ImageOpsDistort,
    ImageOpsDraw,
    ImageOpsTransform,
    ImageOpsColorAjust,
    ImageOpsInvert,
    ImageOpsClamp,
    ImageOpsMerge,
    ImageOpsMaskConvert,
    ImageOpsNoise,
    ImageOpsPadOut,
    ImageOpsPreview,
    ImageOpsSpherize,
    ImageOpsConstant,
    ImageOpsRamp,
    ImageOpsGrain,
    ImageOpsCameraShake,
    ImageOpsKeyer,
    ImageOpsText,
    ImageOpsFrameRange,
    ImageOpsAppend,
]

if ComfyExtension is not object:
    class MajoorImageOpsExtension(ComfyExtension):
        async def get_node_list(self):
            return NODES

    async def comfy_entrypoint():
        return MajoorImageOpsExtension()

# Fallback mappings for tests or extreme edge cases expecting legacy dictionary
NODE_CLASS_MAPPINGS = {node.__name__: node for node in NODES}
NODE_DISPLAY_NAME_MAPPINGS = {node.__name__: node.define_schema().display_name for node in NODES if hasattr(node, "define_schema")}

__all__ = [
    "comfy_entrypoint",
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
]

# ComfyUI web extension folder
WEB_DIRECTORY = "./js"
