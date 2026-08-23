from __future__ import annotations

import asyncio


EXPECTED_NODE_COUNT = 26


def test_imageops_extension_loads(imageops_extension):
    """ImageOps package must load under a real ComfyUI checkout."""

    assert imageops_extension is not None


def test_all_26_nodes_are_registered(imageops_extension):
    """The extension must expose all expected ImageOps nodes."""

    assert hasattr(imageops_extension, "NODES")

    nodes = imageops_extension.NODES

    assert len(nodes) == EXPECTED_NODE_COUNT

    names = [node.__name__ for node in nodes]

    assert len(names) == EXPECTED_NODE_COUNT
    assert len(set(names)) == EXPECTED_NODE_COUNT


def test_all_nodes_have_v3_schema(imageops_extension):
    """Every registered node must expose a valid V3 schema."""

    for node in imageops_extension.NODES:

        assert hasattr(node, "define_schema"), (
            f"{node.__name__} is missing define_schema()"
        )

        schema = node.define_schema()

        assert schema is not None, (
            f"{node.__name__}.define_schema() returned None"
        )


def test_extension_get_node_list(imageops_extension):
    """ComfyExtension must expose exactly the registered nodes."""

    assert hasattr(
        imageops_extension,
        "MajoorImageOpsExtension",
    )

    extension = imageops_extension.MajoorImageOpsExtension()

    nodes = asyncio.run(
        extension.get_node_list()
    )

    assert nodes == imageops_extension.NODES
    assert len(nodes) == EXPECTED_NODE_COUNT


def test_legacy_mapping_matches_v3_registry(
    imageops_extension,
):
    """Legacy compatibility mapping must not drift from V3 registry."""

    mappings = imageops_extension.NODE_CLASS_MAPPINGS

    assert len(mappings) == EXPECTED_NODE_COUNT

    assert set(mappings.values()) == set(
        imageops_extension.NODES
    )
