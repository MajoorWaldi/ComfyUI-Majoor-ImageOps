"""Tests for the public nodes.core.blend engine against the shared golden fixture.

This is the same fixture js/preview/shared/blend-modes.js is tested against
(tests/frontend/node-modules.test.cjs), so a change here that breaks parity
will be caught on both sides.
"""
from __future__ import annotations

import json
import pathlib

import pytest
import torch

from nodes.core.blend import blend_rgb, blend_rgb_extended, normalize_blend_mode

GOLDEN_PATH = pathlib.Path(__file__).resolve().parent.parent / "golden" / "blend_modes.json"


@pytest.fixture(scope="module")
def golden_data():
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        return json.load(f)


def _scalar_blend(base: float, top: float, mode: str) -> float:
    base_t = torch.tensor([base])
    top_t = torch.tensor([top])
    return float(blend_rgb(base_t, top_t, mode)[0])


def test_golden_cases(golden_data):
    tolerance = golden_data["_meta"]["tolerance_abs"]
    failures = []

    for mode, spec in golden_data["modes"].items():
        for case in spec["cases"]:
            actual = _scalar_blend(case["base"], case["top"], mode)
            if abs(actual - case["expected"]) > tolerance:
                failures.append((mode, case, actual))

    assert not failures, f"Blend golden mismatches: {failures}"


def test_normalize_blend_mode_aliases():
    assert normalize_blend_mode("Normal") == "over"
    assert normalize_blend_mode("Color-Dodge") == "color_dodge"
    assert normalize_blend_mode(None) == "over"


def test_extended_subtract():
    base = torch.tensor([0.75])
    top = torch.tensor([0.5])

    assert torch.allclose(blend_rgb_extended(base, top, "subtract"), torch.tensor([0.25]))


def test_extended_hard_mix_is_binary():
    base = torch.tensor([0.9, 0.1])
    top = torch.tensor([0.9, 0.1])

    result = blend_rgb_extended(base, top, "hard_mix")

    assert set(result.tolist()) <= {0.0, 1.0}


def test_extended_falls_back_to_base_modes():
    base = torch.tensor([0.5])
    top = torch.tensor([0.5])

    assert torch.allclose(
        blend_rgb_extended(base, top, "multiply"),
        blend_rgb(base, top, "multiply"),
    )
