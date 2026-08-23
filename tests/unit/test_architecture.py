"""Ensure pure unit tests never depend on ComfyUI."""

from __future__ import annotations

import ast
from pathlib import Path


UNIT_DIR = Path(__file__).parent


FORBIDDEN_PREFIXES = (
    "comfy_api",
    "folder_paths",
    "server",
    "execution",
)


ALLOWED_NODES_PREFIXES = (
    "nodes.core",
    "nodes._helpers",
    "nodes._ops_constants",
)


def test_unit_suite_has_no_comfyui_imports():

    violations = []

    for path in UNIT_DIR.glob(
        "test_*.py"
    ):
        if path.name == Path(__file__).name:
            continue

        tree = ast.parse(
            path.read_text(
                encoding="utf-8"
            ),
            filename=str(path),
        )

        for node in ast.walk(tree):

            if isinstance(
                node,
                ast.ImportFrom,
            ):
                module = node.module or ""

                if module.startswith(
                    FORBIDDEN_PREFIXES
                ):
                    violations.append(
                        f"{path.name}: "
                        f"from {module} import ..."
                    )

                if (
                    module.startswith("nodes.")
                    and not module.startswith(
                        ALLOWED_NODES_PREFIXES
                    )
                ):
                    violations.append(
                        f"{path.name}: "
                        f"imports ComfyUI node "
                        f"{module}"
                    )

            elif isinstance(
                node,
                ast.Import,
            ):
                for alias in node.names:
                    name = alias.name

                    if name.startswith(
                        FORBIDDEN_PREFIXES
                    ):
                        violations.append(
                            f"{path.name}: "
                            f"import {name}"
                        )

    assert not violations, (
        "Unit tests must not depend "
        "on ComfyUI:\n"
        + "\n".join(violations)
    )
