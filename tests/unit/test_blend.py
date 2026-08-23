"""Tests for blend modes against golden fixtures."""

from __future__ import annotations

import json
import pathlib

import pytest
import torch

from nodes._helpers import _blend_rgb


GOLDEN_PATH = (
    pathlib.Path(__file__).resolve().parent.parent
    / "golden"
    / "blend_modes.json"
)


@pytest.fixture(scope="module")
def golden_data():
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        return json.load(f)


def _make_uniform_tensor(value: float) -> torch.Tensor:
    return torch.full(
        (1, 1, 1, 3),
        value,
        dtype=torch.float32,
    )


def _blend_modes_from_golden(golden_data):
    for mode, spec in golden_data["modes"].items():
        for case in spec["cases"]:
            yield mode, case


class TestBlendModesGolden:

    def test_golden_file_exists(self):
        assert GOLDEN_PATH.exists()

    def test_golden_has_modes(self, golden_data):
        assert len(golden_data["modes"]) > 0

    def test_all_blend_cases(self, golden_data):
        tolerance = golden_data["_meta"]["tolerance_abs"]

        failures = []

        for mode, case in _blend_modes_from_golden(
            golden_data
        ):
            base = _make_uniform_tensor(case["base"])
            top = _make_uniform_tensor(case["top"])

            result = _blend_rgb(
                base[..., :3],
                top[..., :3],
                mode,
            )

            actual = float(
                result[0, 0, 0, 0].item()
            )

            expected = case["expected"]

            if abs(actual - expected) > tolerance:
                failures.append(
                    f"{mode}: "
                    f"base={case['base']} "
                    f"top={case['top']} "
                    f"expected={expected} "
                    f"got={actual}"
                )

        if failures:
            pytest.fail(
                "Blend golden mismatches:\n"
                + "\n".join(failures)
            )

    def test_no_nan_inf(self, golden_data):

        for mode, case in _blend_modes_from_golden(
            golden_data
        ):
            base = _make_uniform_tensor(case["base"])
            top = _make_uniform_tensor(case["top"])

            result = _blend_rgb(
                base[..., :3],
                top[..., :3],
                mode,
            )

            assert torch.isfinite(result).all()

    def test_boundary_values_no_nan(
        self,
        golden_data,
    ):
        boundary_values = golden_data[
            "boundary_values"
        ]

        modes = list(
            golden_data["modes"].keys()
        )

        for mode in modes:
            for base_value in boundary_values:
                for top_value in boundary_values:

                    base = _make_uniform_tensor(
                        base_value
                    )

                    top = _make_uniform_tensor(
                        top_value
                    )

                    result = _blend_rgb(
                        base[..., :3],
                        top[..., :3],
                        mode,
                    )

                    assert torch.isfinite(
                        result
                    ).all()
