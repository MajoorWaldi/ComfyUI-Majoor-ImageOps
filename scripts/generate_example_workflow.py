"""Regenerate example/All Nodes MIO.json from the live node schemas.

Every ImageOps node is placed in the graph and wired to an input. Run it inside a
ComfyUI environment so the pack can import comfy_api:

    python scripts/generate_example_workflow.py [--check]

--check exits with an error when the committed file differs from the generated one.
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parent.parent
COMFYUI_ROOT = Path(os.environ.get("COMFYUI_ROOT", PACK_ROOT.parent.parent)).resolve()
EXAMPLE_PATH = PACK_ROOT / "example" / "All Nodes MIO.json"

SOURCE_IMAGE = "example.png"
SOURCE_SIZE = 768
WORKFLOW_ID = "5b0c2f5e-6f0a-4c52-9a7e-1d1f6f0a1e01"

# node type -> {input name: (source node type, output name)}. Every other `image` input is fed by LoadImage.
LINKS = {
    "ImageOpsMerge": {"A": ("LoadImage", "IMAGE"), "B": ("ImageOpsRamp", "image")},
    "ImageOpsComp": {"image_1": ("LoadImage", "IMAGE"), "image_2": ("ImageOpsConstant", "image")},
    "ImageOpsCropStitch": {
        "original": ("LoadImage", "IMAGE"),
        "crop": ("ImageOpsCrop", "image"),
        "crop_mask": ("ImageOpsCrop", "mask"),
        "crop_bbox": ("ImageOpsCrop", "bbox"),
    },
    "ImageOpsDistort": {"displacement": ("ImageOpsNoise", "image")},
    "ImageOpsDefocus": {"depth": ("ImageOpsRamp", "image")},
    "ImageOpsAppend": {"image_1": ("LoadImage", "IMAGE"), "image_2": ("ImageOpsNoise", "image")},
    "ImageOpsFrameRange": {"image": ("ImageOpsAppend", "image")},
    "ImageOpsPreview": {"image": ("ImageOpsMerge", "image"), "image_b": ("LoadImage", "IMAGE")},
}

# Widget values that differ from the schema default so the example shows something.
OVERRIDES = {
    "ImageOpsColorAjust": {"contrast": 10, "saturation": 15},
    "ImageOpsTransform": {"rotate_deg": 8.0, "scale": 1.1},
    "ImageOpsCrop": {"width": 512, "height": 512, "crop_scale": 0.6},
    "ImageOpsPreview": {"compare_mode": "wipe"},
    "ImageOpsMaskConvert": {"reverse": True, "mask_source": "luma"},
    "ImageOpsConstant": {"width": SOURCE_SIZE, "height": SOURCE_SIZE},
    "ImageOpsRamp": {"width": SOURCE_SIZE, "height": SOURCE_SIZE},
    "ImageOpsNoise": {"width": SOURCE_SIZE, "height": SOURCE_SIZE},
    "ImageOpsComp": {
        "layers_json": json.dumps(
            {
                "version": 1,
                "layers": [
                    {"slot": "image_1", "center_x": 0.5, "center_y": 0.5, "scale": 1, "rotate_deg": 0, "opacity": 1, "mode": "over", "enabled": True},
                    {"slot": "image_2", "center_x": 0.5, "center_y": 0.5, "scale": 0.5, "rotate_deg": 0, "opacity": 0.8, "mode": "screen", "enabled": True},
                ],
            },
            separators=(",", ":"),
        )
    },
}

# ImageOpsComp builds its layer sockets in the UI, so they are not part of its schema.
DYNAMIC_SOCKETS = {
    "ImageOpsComp": [
        ("image_1", "IMAGE,VIDEO", "Images/Video 1"),
        ("mask_1", "MASK", None),
        ("image_2", "IMAGE,VIDEO", "Images/Video 2"),
        ("mask_2", "MASK", None),
    ]
}

GROUPS = [
    ("IMAGE  SOURCE", ["LoadImage", "ImageOpsConstant", "ImageOpsRamp", "ImageOpsNoise"]),
    ("IMAGE MASK AND CHANNEL", ["ImageOpsChannel", "ImageOpsMaskConvert", "ImageOpsKeyer", "ImageOpsRoto", "ImageOpsClamp", "ImageOpsInvert"]),
    ("IMAGE TRANSFORMATION            ( MOVE / ROTATE / SCALE / DISTORT )", ["ImageOpsCrop", "ImageOpsCropStitch", "ImageOpsTransform", "ImageOpsCornerPin", "ImageOpsPadOut", "ImageOpsDistort", "ImageOpsSpherize", "ImageOpsCameraShake"]),
    ("IMAGE EFFECT", ["ImageOpsBlur", "ImageOpsColorAjust", "ImageOpsGrain", "ImageOpsVignette", "ImageOpsChromaticAberration", "ImageOpsBloom", "ImageOpsDefocus"]),
    ("IMAGE TEXT AND DRAW", ["ImageOpsText", "ImageOpsDraw"]),
    ("IMAGE  COMPOSITION", ["ImageOpsMerge", "ImageOpsComp", "ImageOpsPreview"]),
    ("IMAGE TEMPORAL AND TIMELINE", ["ImageOpsAppend", "ImageOpsFrameRange"]),
]

NODE_SIZE = (470, 960)
LOAD_IMAGE_SIZE = (340, 420)
COLUMN_STEP = 520
ROW_STEP = 1120
GROUP_PADDING = 60
GROUP_TITLE_HEIGHT = 90

WIDGET_TYPES = {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO", "COLOR", "CURVE", "COLORS"}
CURVE_DEFAULT = {"points": [[0, 0], [1, 1]], "interpolation": "monotone_cubic"}

LOAD_IMAGE_DEFINITION = {
    "name": "LoadImage",
    "input_order": {"required": ["image", "upload"]},
    "input": {"required": {"image": ["COMBO", {"default": SOURCE_IMAGE}], "upload": ["IMAGEUPLOAD", {}]}},
    "output": ["IMAGE", "MASK"],
    "output_name": ["IMAGE", "MASK"],
    "display_name": "Load Image",
}


def load_extension():
    """Import the pack the way ComfyUI does, on the CPU."""
    sys.path.insert(0, str(COMFYUI_ROOT))
    from comfy.cli_args import args

    args.cpu = True
    spec = importlib.util.spec_from_file_location("imageops_example", PACK_ROOT / "__init__.py", submodule_search_locations=[str(PACK_ROOT)])
    module = importlib.util.module_from_spec(spec)
    sys.modules["imageops_example"] = module
    spec.loader.exec_module(module)
    return module


def node_definitions(extension) -> dict[str, dict]:
    definitions = {}
    for node in extension.NODES:
        info = node.GET_NODE_INFO_V1()
        info = info if isinstance(info, dict) else vars(info)
        definitions[info["name"]] = info
    definitions["LoadImage"] = LOAD_IMAGE_DEFINITION
    return definitions


def _inputs_by_kind(definition: dict):
    """Split a definition into ordered (name, type, options, required) socket and widget inputs."""
    sockets, widgets = [], []
    for group in ("required", "optional"):
        for name in definition["input_order"].get(group, []):
            entry = definition["input"][group][name]
            input_type, options = entry[0], (entry[1] if len(entry) > 1 else {})
            record = (name, input_type, options, group == "required")
            if input_type == "IMAGEUPLOAD":
                continue
            is_widget = (input_type in WIDGET_TYPES or isinstance(input_type, list)) and not options.get("forceInput")
            (widgets if is_widget else sockets).append(record)
    return sockets, widgets


def widget_values(node_type: str, definition: dict) -> dict[str, object]:
    _, widgets = _inputs_by_kind(definition)
    values = {}
    for name, input_type, options, _ in widgets:
        if input_type == "CURVE":
            values[name] = CURVE_DEFAULT
        elif input_type == "COMBO" and "default" not in options:
            values[name] = options["options"][0]
        else:
            values[name] = options.get("default", "")
    overrides = OVERRIDES.get(node_type, {})
    assert set(overrides) <= set(values), f"{node_type}: overrides for unknown widgets {set(overrides) - set(values)}"
    values.update(overrides)
    return values


def resolve_links(definitions: dict[str, dict]) -> dict[str, dict[str, tuple[str, str]]]:
    """node type -> {input name: (source type, output name)} for every wired input."""
    resolved = {}
    for node_type, definition in definitions.items():
        if node_type == "LoadImage":
            continue
        sockets = {name for name, _, _, _ in _inputs_by_kind(definition)[0]}
        wired = dict(LINKS.get(node_type, {}))
        if "image" in sockets and "image" not in wired:
            wired["image"] = ("LoadImage", "IMAGE")
        resolved[node_type] = wired
    return resolved


def _layout(definitions: dict[str, dict]) -> tuple[dict[str, tuple[float, float, int, int]], list[dict]]:
    positions, groups = {}, []
    y = 0
    for group_id, (title, members) in enumerate(GROUPS, start=1):
        members = [m for m in members if m in definitions]
        top = y + GROUP_TITLE_HEIGHT
        width = 2 * GROUP_PADDING + len(members) * COLUMN_STEP - (COLUMN_STEP - NODE_SIZE[0])
        for column, member in enumerate(members):
            size = LOAD_IMAGE_SIZE if member == "LoadImage" else NODE_SIZE
            positions[member] = (GROUP_PADDING + column * COLUMN_STEP, top, size[0], size[1])
        groups.append(
            {
                "id": group_id,
                "title": title,
                "bounding": [0, y, width, GROUP_TITLE_HEIGHT + NODE_SIZE[1] + GROUP_PADDING],
                "color": "#3f789e",
                "font_size": 24,
                "flags": {},
            }
        )
        y += ROW_STEP + GROUP_TITLE_HEIGHT
    return positions, groups


def _execution_order(node_ids: dict[str, int], links: dict[str, dict[str, tuple[str, str]]]) -> dict[str, int]:
    remaining = {t: {src for src, _ in wired.values()} for t, wired in links.items()}
    remaining["LoadImage"] = set()
    order, done = {}, set()
    while remaining:
        ready = sorted((t for t, deps in remaining.items() if deps <= done), key=lambda t: node_ids[t])
        assert ready, "cycle in the example graph"
        for node_type in ready:
            order[node_type] = len(order)
            done.add(node_type)
            del remaining[node_type]
    return order


def build_workflow(definitions: dict[str, dict], version: str, comfy_version: str, frontend_version: str) -> dict:
    positions, groups = _layout(definitions)
    types = [t for _, members in GROUPS for t in members if t in definitions]
    assert set(types) == set(definitions), f"nodes missing from GROUPS: {set(definitions) - set(types)}"
    node_ids = {node_type: index for index, node_type in enumerate(types, start=1)}
    links_by_node = resolve_links(definitions)
    order = _execution_order(node_ids, links_by_node)

    link_rows, link_ids = [], {}
    inputs_of, outputs_of = {}, {t: {} for t in types}
    for node_type in types:
        definition = definitions[node_type]
        sockets = [(n, t, o, r) for n, t, o, r in _inputs_by_kind(definition)[0]]
        for name, socket_type, label in DYNAMIC_SOCKETS.get(node_type, []):
            sockets.append((name, socket_type, {"display_name": label} if label else {}, False))
        serialized = []
        for name, socket_type, options, required in sockets:
            entry = {"name": name, "type": socket_type}
            if options.get("display_name"):
                entry = {"label": options["display_name"], **entry}
            if not required:
                entry["shape"] = 7
            source = links_by_node.get(node_type, {}).get(name)
            entry["link"] = None
            if source:
                source_type, output_name = source
                source_def = definitions[source_type]
                slot = source_def["output_name"].index(output_name)
                link_id = len(link_rows) + 1
                link_rows.append([link_id, node_ids[source_type], slot, node_ids[node_type], len(serialized), source_def["output"][slot]])
                entry["link"] = link_id
                outputs_of[source_type].setdefault(slot, []).append(link_id)
            serialized.append(entry)
        inputs_of[node_type] = serialized

    nodes = []
    for node_type in types:
        definition = definitions[node_type]
        x, y, width, height = positions[node_type]
        outputs = []
        for slot, (out_name, out_type) in enumerate(zip(definition["output_name"], definition["output"])):
            linked = outputs_of[node_type].get(slot)
            output = {"name": out_name, "type": out_type, "links": linked}
            if linked:
                output["slot_index"] = slot
            outputs.append(output)
        core = node_type == "LoadImage"
        node = {
            "id": node_ids[node_type],
            "type": node_type,
            "pos": [x, y],
            "size": [width, height],
            "flags": {},
            "order": order[node_type],
            "mode": 0,
            "inputs": inputs_of[node_type],
            "outputs": outputs,
            "properties": {
                "cnr_id": "comfy-core" if core else "majoor-imageops",
                "ver": comfy_version if core else version,
                "Node name for S&R": node_type,
            },
            "widgets_values": [SOURCE_IMAGE, "image"] if core else list(widget_values(node_type, definition).values()),
        }
        if core:
            node["inputs"] = []
        nodes.append(node)

    return {
        "id": WORKFLOW_ID,
        "revision": 0,
        "last_node_id": len(nodes),
        "last_link_id": len(link_rows),
        "nodes": nodes,
        "links": link_rows,
        "groups": groups,
        "config": {},
        "extra": {"ds": {"scale": 0.12, "offset": [200, 200]}, "frontendVersion": frontend_version},
        "version": 0.4,
    }


def build_prompt(definitions: dict[str, dict], workflow: dict) -> dict:
    """The same graph in API format, used to execute the example without the frontend."""
    type_by_id = {node["id"]: node["type"] for node in workflow["nodes"]}
    prompt = {}
    for node in workflow["nodes"]:
        node_type = node["type"]
        inputs = {}
        if node_type == "LoadImage":
            inputs["image"] = SOURCE_IMAGE
        else:
            inputs.update(widget_values(node_type, definitions[node_type]))
        for socket in node["inputs"]:
            if socket["link"] is not None:
                link = next(row for row in workflow["links"] if row[0] == socket["link"])
                inputs[socket["name"]] = [str(link[1]), link[2]]
        prompt[str(node["id"])] = {"class_type": node_type, "inputs": inputs}
    assert {v["class_type"] for v in prompt.values()} == set(type_by_id.values())
    return prompt


def read_versions() -> tuple[str, str, str]:
    project_version = next(line.split('"')[1] for line in (PACK_ROOT / "pyproject.toml").read_text(encoding="utf-8").splitlines() if line.startswith("version = "))
    comfy_version = re.search(r'__version__ = "([^"]+)"', (COMFYUI_ROOT / "comfyui_version.py").read_text(encoding="utf-8")).group(1)
    frontend = next(line.split("==")[1].strip() for line in (COMFYUI_ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines() if line.startswith("comfyui-frontend-package"))
    return project_version, comfy_version, frontend


def generate() -> tuple[dict, dict, dict]:
    definitions = node_definitions(load_extension())
    workflow = build_workflow(definitions, *read_versions())
    return definitions, workflow, build_prompt(definitions, workflow)


def render(workflow: dict) -> str:
    return json.dumps(workflow, indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    text = render(generate()[1])
    if "--check" in sys.argv:
        if EXAMPLE_PATH.read_text(encoding="utf-8") != text:
            sys.exit(f"{EXAMPLE_PATH} is stale. Run: python scripts/generate_example_workflow.py")
    else:
        EXAMPLE_PATH.write_text(text, encoding="utf-8", newline="\n")
        print(f"Wrote {EXAMPLE_PATH}")
