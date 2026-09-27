from __future__ import annotations

import pytest
import torch

from nodes.core.parameters import resolve_frame_parameter


def test_scalar_broadcasts_to_all_frames():
    out = resolve_frame_parameter(0.5, 4, device="cpu")

    assert out.shape == (4,)
    assert torch.allclose(out, torch.full((4,), 0.5))


def test_single_element_sequence_broadcasts():
    out = resolve_frame_parameter([0.25], 3, device="cpu")

    assert torch.allclose(out, torch.full((3,), 0.25))


def test_exact_length_sequence_passes_through():
    out = resolve_frame_parameter([0.0, 1.0, 2.0], 3, device="cpu")

    assert torch.allclose(out, torch.tensor([0.0, 1.0, 2.0]))


def test_hold_policy_repeats_last_value():
    out = resolve_frame_parameter([0.0, 1.0], 5, device="cpu", policy="hold")

    assert torch.allclose(out, torch.tensor([0.0, 1.0, 1.0, 1.0, 1.0]))


def test_loop_policy_cycles_values():
    out = resolve_frame_parameter([0.0, 1.0], 5, device="cpu", policy="loop")

    assert torch.allclose(out, torch.tensor([0.0, 1.0, 0.0, 1.0, 0.0]))


def test_tensor_input_supported():
    out = resolve_frame_parameter(torch.tensor([1.0, 2.0, 3.0]), 3, device="cpu")

    assert torch.allclose(out, torch.tensor([1.0, 2.0, 3.0]))


def test_unknown_policy_with_mismatched_length_raises():
    with pytest.raises(ValueError):
        resolve_frame_parameter([0.0, 1.0], 5, device="cpu", policy="bogus")
