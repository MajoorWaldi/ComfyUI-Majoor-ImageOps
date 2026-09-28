"""The shipped example workflow must cover every node, stay wired, and match the schemas."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import pytest

PACK_ROOT = Path(__file__).resolve().parents[2]
EXAMPLE = PACK_ROOT / "example" / "All Nodes MIO.json"
GENERATOR = PACK_ROOT / "scripts" / "generate_example_workflow.py"


@pytest.fixture(scope="module")
def generator():
    spec = importlib.util.spec_from_file_location("generate_example_workflow", GENERATOR)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def workflow():
    return json.loads(EXAMPLE.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def definitions(generator, imageops_extension):
    return generator.node_definitions(imageops_extension)


def test_example_is_up_to_date(generator, definitions, workflow):
    """Regenerating with the versions stored in the file must reproduce it byte for byte."""
    from comfy_api.latest import io

    if not hasattr(io, "Layers"):
        pytest.skip("the example is generated on ComfyUI 0.31+, where ImageOpsComp has its layers output")
    majoor = next(n for n in workflow["nodes"] if n["type"] != "LoadImage")
    load_image = next(n for n in workflow["nodes"] if n["type"] == "LoadImage")
    expected = generator.build_workflow(
        definitions,
        majoor["properties"]["ver"],
        load_image["properties"]["ver"],
        workflow["extra"]["frontendVersion"],
    )

    assert EXAMPLE.read_text(encoding="utf-8") == generator.render(expected), (
        "example/All Nodes MIO.json is stale. Run: python scripts/generate_example_workflow.py"
    )


def test_example_contains_every_node(imageops_extension, workflow):
    registered = {node.define_schema().node_id for node in imageops_extension.NODES}
    used = [node["type"] for node in workflow["nodes"]]

    assert set(used) == registered | {"LoadImage"}
    assert len(used) == len(set(used))


def test_every_link_is_consistent(workflow):
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert len({row[0] for row in workflow["links"]}) == len(workflow["links"])

    for link_id, source_id, source_slot, target_id, target_slot, link_type in workflow["links"]:
        output = nodes[source_id]["outputs"][source_slot]
        socket = nodes[target_id]["inputs"][target_slot]

        assert link_id in output["links"]
        assert socket["link"] == link_id
        assert output["type"] == link_type
        assert link_type in socket["type"].split(","), f"{output['name']} -> {socket['name']}"

    assert workflow["last_link_id"] == max(row[0] for row in workflow["links"])
    assert workflow["last_node_id"] == max(nodes)


def test_every_node_is_connected_to_an_input(workflow):
    generators = {"LoadImage", "ImageOpsConstant", "ImageOpsRamp", "ImageOpsNoise"}
    fed = {row[3] for row in workflow["links"]}
    feeding = {row[1] for row in workflow["links"]}

    for node in workflow["nodes"]:
        if node["type"] in generators:
            assert node["id"] in feeding, f"{node['type']} feeds nothing"
        else:
            assert node["id"] in fed, f"{node['type']} has no connected input"


def test_widget_values_match_the_schemas(generator, definitions, workflow):
    for node in workflow["nodes"]:
        if node["type"] == "LoadImage":
            continue
        widgets = generator._inputs_by_kind(definitions[node["type"]])[1]
        assert len(node["widgets_values"]) == len(widgets), node["type"]


def test_execution_order_follows_the_links(workflow):
    order = {node["id"]: node["order"] for node in workflow["nodes"]}

    for _, source_id, _, target_id, _, _ in workflow["links"]:
        assert order[source_id] < order[target_id]
