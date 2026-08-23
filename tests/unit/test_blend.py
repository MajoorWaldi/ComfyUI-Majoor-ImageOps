"""Tests for blend modes against golden fixtures.

Both this Python test and future frontend/WebGL tests consume the same
blend_modes.json to ensure backend/preview parity.
"""
from __future__ import annotations

import json
import pathlib

import pytest
import torch

# The blend implementation lives in _helpers.py
from nodes._helpers import _blend_rgb


GOLDEN_PATH = pathlib.Path(__file__).resolve().parent.parent / "golden" / "blend_modes.json"


@pytest.fixture(scope="module")
def golden_data():
    with open(GOLDEN_PATH) as f:
        return json.load(f)


def _make_uniform_tensor(value: float) -> torch.Tensor:
    """Create a [1, 1, 1, 3] tensor with all channels set to value."""
    return torch.full((1, 1, 1, 3), value, dtype=torch.float32)


def _blend_modes_from_golden(golden_data):
    """Yield (mode, case) pairs from golden fixture."""
    for mode, spec in golden_data["modes"].items():
        for case in spec["cases"]:
            yield mode, case


class TestBlendModesGolden:
    """Validate _blend_rgb against golden fixture values."""

    def test_golden_file_exists(self):
        assert GOLDEN_PATH.exists(), f"Golden fixture not found: {GOLDEN_PATH}"

    def test_golden_has_modes(self, golden_data):
        assert len(golden_data["modes"]) > 0

    def test_all_blend_cases(self, golden_data):
        tolerance = golden_data["_meta"]["tolerance_abs"]
        failures = []
        for mode, case in _blend_modes_from_golden(golden_data):
            base = _make_uniform_tensor(case["base"])
            top = _make_uniform_tensor(case["top"])
            expected = case["expected"]

            result = _blend_rgb(base[..., :3], top[..., :3], mode)
            actual = float(result[0, 0, 0, 0].item())

            if abs(actual - expected) > tolerance:
                failures.append(
                    f"  {mode}: base={case['base']}, top={case['top']}: "
                    f"expected={expected}, got={actual:.10f}"
                )

        if failures:
            msg = "Blend mode golden mismatches:\n" + "\n".join(failures)
            pytest.fail(msg)

    def test_no_nan_inf(self, golden_data):
        """No blend mode should produce NaN or Inf for any golden input."""
        for mode, case in _blend_modes_from_golden(golden_data):
            base = _make_uniform_tensor(case["base"])
            top = _make_uniform_tensor(case["top"])
            result = _blend_rgb(base[..., :3], top[..., :3], mode)
            assert torch.isfinite(result).all(), (
                f"{mode}: NaN/Inf detected for base={case['base']}, top={case['top']}"
            )

    def test_boundary_values_no_nan(self, golden_data):
        """Run all modes with all boundary values — no NaN/Inf allowed."""
        boundary_values = golden_data["boundary_values"]
        modes = list(golden_data["modes"].keys())
        for mode in modes:
            for bv in boundary_values:
                for tv in boundary_values:
                    base = _make_uniform_tensor(bv)
                    top = _make_uniform_tensor(tv)
                    result = _blend_rgb(base[..., :3], top[..., :3], mode)
                    assert torch.isfinite(result).all(), (
                        f"{mode}: NaN/Inf for base={bv}, top={tv}"
                    )
