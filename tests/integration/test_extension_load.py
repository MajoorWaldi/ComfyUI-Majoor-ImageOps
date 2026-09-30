from __future__ import annotations

import asyncio


EXPECTED_NODE_COUNT = 31


def test_imageops_extension_loads(imageops_extension):
    """ImageOps package must load under a real ComfyUI checkout."""

    assert imageops_extension is not None


def test_all_nodes_are_registered(imageops_extension):
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


def test_entrypoint_returns_extension_and_registers_routes(
    imageops_extension,
    monkeypatch,
):
    """Comfy skips comfy_entrypoint when NODE_CLASS_MAPPINGS exists, so it must not exist."""

    assert not hasattr(imageops_extension, "NODE_CLASS_MAPPINGS")

    registered = []
    monkeypatch.setattr(
        imageops_extension,
        "register_imageops_routes",
        lambda: registered.append(True),
    )

    extension = asyncio.run(imageops_extension.comfy_entrypoint())
    asyncio.run(extension.on_load())

    assert isinstance(extension, imageops_extension.ComfyExtension)
    assert registered == [True]


def test_node_ids_are_unique(imageops_extension):
    ids = [node.define_schema().node_id for node in imageops_extension.NODES]

    assert len(set(ids)) == EXPECTED_NODE_COUNT


def test_nodes_with_backend_ui_replay_cached_output(imageops_extension):
    """Frontend widgets read backend-computed values from `ui`; cached runs must resend it."""

    flagged = {
        node.define_schema().node_id
        for node in imageops_extension.NODES
        if node.define_schema().has_intermediate_output
    }

    assert flagged == {
        "ImageOpsPadOut",
        "ImageOpsFrameRange",
        "ImageOpsAppend",
    }


def test_nodes_are_listed_in_the_essentials_tab(imageops_extension):
    categories = {
        node.define_schema().node_id: node.define_schema().essentials_category
        for node in imageops_extension.NODES
    }

    assert set(categories.values()) == {"Image Tools", "Video Tools"}
    assert {k for k, v in categories.items() if v == "Video Tools"} == {"ImageOpsAppend", "ImageOpsFrameRange"}
