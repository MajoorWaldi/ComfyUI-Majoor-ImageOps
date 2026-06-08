"""
ComfyUI custom node entrypoint.

ComfyUI loads custom nodes via `importlib.util.spec_from_file_location()` with a synthetic module name
that is not a Python package, so relative imports like `from .nodes.foo import ...` can fail.

To stay ComfyUI-proof, we create an internal package namespace and load node modules under it.
"""

from __future__ import annotations

import importlib.util
import json
import re
import sys
import types
from pathlib import Path

try:
    from comfy_api.latest import io as _node20_io
except Exception:  # pragma: no cover - compatibility fallback when ComfyUI is older/missing stubs
    _node20_io = None

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


def _humanize_node_id(node_id: str) -> str:
    label = re.sub(r"(?<!^)(?=[A-Z])", " ", str(node_id or "")).strip()
    return label.replace("Ajust", "Color Correct").strip()


def _field_factory(kind: str):
    if _node20_io is None:
        return None
    direct = getattr(_node20_io, kind, None)
    if direct is not None:
        return direct
    fallback_map = {
        "Float": "Int",
        "Color": "String",
        "Bool": "Boolean",
        "Combo": "String",
    }
    return getattr(_node20_io, fallback_map.get(kind, "String"), None)


def _custom_field_factory(type_name: str):
    if _node20_io is None:
        return None
    custom = getattr(_node20_io, "Custom", None)
    if callable(custom):
        try:
            return custom(type_name)
        except Exception:
            return None
    return None


def _make_schema_input(name: str, spec, optional: bool = False):
    if _node20_io is None:
        return None

    raw_type = spec[0] if isinstance(spec, (tuple, list)) and spec else "STRING"
    opts = spec[1] if isinstance(spec, (tuple, list)) and len(spec) > 1 and isinstance(spec[1], dict) else {}
    kwargs = dict(opts)
    if optional:
        kwargs["optional"] = True

    # Remap legacy INPUT_TYPES option keys that changed in the Node 2.0 API.
    # forceInput (legacy camelCase) -> force_input (new snake_case on WidgetInput).
    force_input_val = kwargs.pop("forceInput", None)
    # display: "slider"/"number" -> display_mode: NumberDisplay enum (Int/Float only).
    display_val = kwargs.pop("display", None)
    display_mode = None
    if display_val is not None:
        _nd = getattr(_node20_io, "NumberDisplay", None)
        if _nd is not None:
            try:
                display_mode = _nd(display_val)
            except (ValueError, KeyError):
                pass

    if isinstance(raw_type, (list, tuple)) and not isinstance(raw_type, str):
        factory = _field_factory("Combo")
        if not factory:
            return None
        # Combo.Input uses 'options', not 'choices'.
        if force_input_val is not None:
            kwargs["force_input"] = force_input_val
        return factory.Input(name, options=list(raw_type), **kwargs)

    type_name = str(raw_type or "STRING").upper()
    if "," in type_name or type_name == "VIDEO":
        factory = _custom_field_factory(type_name) or _field_factory("Image")
    elif type_name == "COLOR" or ("COLOR" in name.lower() and type_name == "STRING"):
        factory = _field_factory("Color")
    elif type_name in {"BOOLEAN", "BOOL"}:
        factory = _field_factory("Boolean")
    elif type_name == "INT":
        factory = _field_factory("Int")
    elif type_name == "FLOAT":
        factory = _field_factory("Float")
    elif type_name == "MASK":
        factory = _field_factory("Mask")
    elif "IMAGE" in type_name or "VIDEO" in type_name:
        factory = _field_factory("Image")
    else:
        factory = _field_factory("String")

    if not factory:
        return None

    # For numeric widget types, forward the remapped display_mode.
    if display_mode is not None and type_name in {"INT", "FLOAT"}:
        kwargs["display_mode"] = display_mode

    # Image/Mask use the base Input class (no force_input param).
    # Pass forceInput via extra_dict so it still appears in the serialised schema.
    if "IMAGE" in type_name or "VIDEO" in type_name or type_name == "MASK":
        if force_input_val is not None:
            existing = kwargs.pop("extra_dict", {}) or {}
            kwargs["extra_dict"] = {"forceInput": force_input_val, **existing}
    else:
        # All WidgetInput subclasses accept force_input directly.
        if force_input_val is not None:
            kwargs["force_input"] = force_input_val

    return factory.Input(name, **kwargs)


def _make_schema_output(name: str, output_type: str):
    if _node20_io is None:
        return None
    kind = str(output_type or "STRING").upper()
    if "," in kind or kind == "VIDEO":
        factory = _custom_field_factory(kind) or _field_factory("Image")
    elif kind == "MASK":
        factory = _field_factory("Mask")
    elif "IMAGE" in kind or "VIDEO" in kind:
        factory = _field_factory("Image")
    elif kind == "INT":
        factory = _field_factory("Int")
    elif kind == "FLOAT":
        factory = _field_factory("Float")
    else:
        factory = _field_factory("String")
    return factory.Output(name, display_name=name) if factory else None


def _make_hidden_fields(hidden_spec: dict | None):
    if _node20_io is None or not hidden_spec:
        return []
    hidden_obj = getattr(_node20_io, "Hidden", None)
    if hidden_obj is None:
        return []
    out = []
    for name in hidden_spec:
        token = getattr(hidden_obj, name, None)
        if token is not None:
            out.append(token)
    return out


def _build_legacy_schema(node_id: str, cls, display_name: str, search_aliases=None):
    if _node20_io is None:
        return None

    legacy_inputs = cls.INPUT_TYPES() if callable(getattr(cls, "INPUT_TYPES", None)) else {}
    required = legacy_inputs.get("required", {}) if isinstance(legacy_inputs, dict) else {}
    optional = legacy_inputs.get("optional", {}) if isinstance(legacy_inputs, dict) else {}
    hidden = legacy_inputs.get("hidden", {}) if isinstance(legacy_inputs, dict) else {}

    inputs = []
    for is_optional, group in ((False, required), (True, optional)):
        for input_name, input_spec in group.items():
            field = _make_schema_input(input_name, input_spec)
            if field is not None:
                if is_optional:
                    # Newer ComfyUI Node 2.0 builds may return a frozen dict-like
                    # field object that disallows attribute assignment. Try every
                    # known shape so the schema always carries the optional flag.
                    _set = False
                    try:
                        field.optional = True  # dataclass / object form
                        _set = True
                    except (AttributeError, TypeError):
                        pass
                    if not _set:
                        try:
                            field["optional"] = True  # dict form
                            _set = True
                        except (TypeError, KeyError):
                            pass
                    if not _set:
                        # Fallback: rebuild the field with optional kwarg if supported.
                        try:
                            rebuilt = _make_schema_input(input_name, input_spec, optional=True)
                            if rebuilt is not None:
                                field = rebuilt
                        except TypeError:
                            pass
                inputs.append(field)

    return_names = tuple(getattr(cls, "RETURN_NAMES", ()) or ())
    return_types = tuple(getattr(cls, "RETURN_TYPES", ()) or ())
    outputs = []
    for index, output_type in enumerate(return_types):
        name = return_names[index] if index < len(return_names) else f"output_{index + 1}"
        field = _make_schema_output(name, output_type)
        if field is not None:
            outputs.append(field)

    schema_kwargs = {
        "node_id": node_id,
        "display_name": display_name,
        "category": getattr(cls, "CATEGORY", "image/imageops"),
        "inputs": inputs,
        "outputs": outputs,
        "accept_all_inputs": True,
    }
    if search_aliases:
        schema_kwargs["search_aliases"] = list(search_aliases)
    hidden_fields = _make_hidden_fields(hidden)
    if hidden_fields:
        schema_kwargs["hidden"] = hidden_fields
    return _node20_io.Schema(**schema_kwargs)


def _wrap_legacy_node20(node_id: str, cls, display_name: str, search_aliases=None):
    if callable(getattr(cls, "define_schema", None)) and callable(getattr(cls, "execute", None)):
        return cls
    if _node20_io is None:
        return cls

    comfy_node_base = getattr(_node20_io, "ComfyNode", object)
    bases = (cls,) if not isinstance(comfy_node_base, type) or issubclass(cls, comfy_node_base) else (cls, comfy_node_base)

    import inspect
    fn_name = getattr(cls, "FUNCTION", None)
    is_async = False
    if fn_name:
        try:
            is_async = inspect.iscoroutinefunction(getattr(cls(), fn_name))
        except Exception:
            pass

    if is_async:
        class Node20Compat(*bases):
            # v3 execution path uses FUNCTION to locate the callable; must point to
            # a classmethod so that getattr(cls, FUNCTION).__func__ works correctly.
            FUNCTION = "execute"

            @classmethod
            def define_schema(inner_cls):
                return _build_legacy_schema(node_id, cls, display_name, search_aliases)

            @classmethod
            def INPUT_TYPES(inner_cls):
                # Explicitly override the legacy INPUT_TYPES() so that ComfyUI's v3
                # validation path receives a schema-derived dict with "COMBO" io_type
                # strings instead of raw lists.  Without this, Python's MRO resolves
                # INPUT_TYPES to the legacy classmethod (which returns list-based Combo
                # values), and parse_class_inputs then tries `list_value in dict` which
                # raises TypeError: unhashable type: 'list'.
                schema = _build_legacy_schema(node_id, cls, display_name, search_aliases)
                # Older Comfy builds expose Schema.finalize(); newer builds drop it
                # because the Schema is finalised lazily. Guard so both shapes work.
                finalize = getattr(schema, "finalize", None)
                if callable(finalize):
                    try:
                        finalize()
                    except Exception:
                        pass
                try:
                    return schema.get_v1_info(inner_cls).input
                except AttributeError:
                    # Fall back to the legacy INPUT_TYPES from the original class so
                    # the v1 validation path still has data even if the v3 schema
                    # cannot be downgraded by this Comfy version.
                    legacy = getattr(cls, "INPUT_TYPES", None)
                    return legacy() if callable(legacy) else {"required": {}}

            @classmethod
            async def execute(inner_cls, **kwargs):
                fn_name_inner = getattr(cls, "FUNCTION", None)
                if not fn_name_inner:
                    raise AttributeError(f"{node_id} is missing FUNCTION for Node 2.0 compatibility")
                instance = cls()
                fn = getattr(instance, fn_name_inner)
                return await fn(**kwargs)
    else:
        class Node20Compat(*bases):
            # v3 execution path uses FUNCTION to locate the callable; must point to
            # a classmethod so that getattr(cls, FUNCTION).__func__ works correctly.
            FUNCTION = "execute"

            @classmethod
            def define_schema(inner_cls):
                return _build_legacy_schema(node_id, cls, display_name, search_aliases)

            @classmethod
            def INPUT_TYPES(inner_cls):
                # Explicitly override the legacy INPUT_TYPES() so that ComfyUI's v3
                # validation path receives a schema-derived dict with "COMBO" io_type
                # strings instead of raw lists.  Without this, Python's MRO resolves
                # INPUT_TYPES to the legacy classmethod (which returns list-based Combo
                # values), and parse_class_inputs then tries `list_value in dict` which
                # raises TypeError: unhashable type: 'list'.
                schema = _build_legacy_schema(node_id, cls, display_name, search_aliases)
                # Older Comfy builds expose Schema.finalize(); newer builds drop it
                # because the Schema is finalised lazily. Guard so both shapes work.
                finalize = getattr(schema, "finalize", None)
                if callable(finalize):
                    try:
                        finalize()
                    except Exception:
                        pass
                try:
                    return schema.get_v1_info(inner_cls).input
                except AttributeError:
                    # Fall back to the legacy INPUT_TYPES from the original class so
                    # the v1 validation path still has data even if the v3 schema
                    # cannot be downgraded by this Comfy version.
                    legacy = getattr(cls, "INPUT_TYPES", None)
                    return legacy() if callable(legacy) else {"required": {}}

            @classmethod
            def execute(inner_cls, **kwargs):
                fn_name_inner = getattr(cls, "FUNCTION", None)
                if not fn_name_inner:
                    raise AttributeError(f"{node_id} is missing FUNCTION for Node 2.0 compatibility")
                instance = cls()
                fn = getattr(instance, fn_name_inner)
                return fn(**kwargs)

    Node20Compat.__name__ = cls.__name__
    Node20Compat.__qualname__ = cls.__qualname__
    Node20Compat.__module__ = cls.__module__
    Node20Compat.__doc__ = cls.__doc__
    return Node20Compat


# Create internal package + nodes package so node files' relative imports work.
_ensure_pkg(_PKG, BASE_DIR, BASE_DIR / "__init__.py")
_ensure_pkg(f"{_PKG}.nodes", BASE_DIR / "nodes", BASE_DIR / "nodes" / "__init__.py")

_nodes_dir = BASE_DIR / "nodes"
_load_module(f"{_PKG}.server", BASE_DIR / "server.py")


def _load_node_metadata() -> list[dict]:
    path = BASE_DIR / "imageops_nodes.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    nodes = raw.get("nodes") if isinstance(raw, dict) else None
    return [entry for entry in nodes if isinstance(entry, dict)] if isinstance(nodes, list) else []

_NODE_METADATA = _load_node_metadata()
if not _NODE_METADATA:
    raise RuntimeError("ImageOps node metadata is missing or invalid")

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
NODE_SEARCH_ALIAS_MAPPINGS = {}

for _entry in _NODE_METADATA:
    _node_id = str(_entry.get("className") or "").strip()
    _module_name = str(_entry.get("module") or "").strip()
    _class_export = str(_entry.get("classExport") or _node_id).strip()
    if not _node_id or not _module_name or not _class_export:
        continue
    _module = _load_module(f"{_PKG}.nodes.{_module_name}", _nodes_dir / f"{_module_name}.py")
    NODE_CLASS_MAPPINGS[_node_id] = getattr(_module, _class_export)
    NODE_DISPLAY_NAME_MAPPINGS[_node_id] = str(_entry.get("displayName") or _humanize_node_id(_node_id))
    _aliases = _entry.get("aliases")
    NODE_SEARCH_ALIAS_MAPPINGS[_node_id] = [str(alias) for alias in _aliases] if isinstance(_aliases, list) else []
for _node_id, _node_cls in list(NODE_CLASS_MAPPINGS.items()):
    _display = NODE_DISPLAY_NAME_MAPPINGS.get(_node_id, _humanize_node_id(_node_id))
    _aliases = NODE_SEARCH_ALIAS_MAPPINGS.get(_node_id, ())
    NODE_CLASS_MAPPINGS[_node_id] = _wrap_legacy_node20(_node_id, _node_cls, _display, _aliases)

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "NODE_SEARCH_ALIAS_MAPPINGS",
    "WEB_DIRECTORY",
]

# ComfyUI web extension folder
WEB_DIRECTORY = "./js"
