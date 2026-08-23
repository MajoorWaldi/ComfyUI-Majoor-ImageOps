"""Integration tests executed against a real ComfyUI checkout."""

from __future__ import annotations

import pytest


def test_integration_load_nodes(
    imageops_extension,
):
    """Every registered ImageOps node can be instantiated.

    This deliberately does NOT import ComfyUI execution.py.

    execution.py initializes model-management/device selection
    and can require CUDA. Node registry integration does not
    require GPU initialization.
    """

    assert hasattr(
        imageops_extension,
        "NODE_CLASS_MAPPINGS",
    )

    mappings = (
        imageops_extension.NODE_CLASS_MAPPINGS
    )

    assert mappings

    failures = []

    for name, cls in mappings.items():

        try:
            instance = cls()

        except Exception as exc:
            failures.append(
                f"{name} ({cls.__name__}): "
                f"{type(exc).__name__}: {exc}"
            )

            continue

        assert instance is not None

    if failures:
        pytest.fail(
            "Failed to instantiate ImageOps nodes:\n"
            + "\n".join(failures)
        )
