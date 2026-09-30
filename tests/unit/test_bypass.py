"""apply_per_frame_bypass must treat tuples the same as lists.

A non-empty tuple is always truthy in Python regardless of its contents, so the
fallback branch (`return source if bypass else processed`) silently bypassed the
whole batch for any all-False tuple before this was fixed.
"""
from __future__ import annotations

import torch

from nodes._helpers import apply_per_frame_bypass


def test_all_false_tuple_returns_processed():
    source = torch.zeros((3, 1, 1, 3))
    processed = torch.ones((3, 1, 1, 3))

    out = apply_per_frame_bypass(source, processed, (False, False, False))

    assert torch.allclose(out, processed)


def test_all_true_tuple_returns_source():
    source = torch.zeros((3, 1, 1, 3))
    processed = torch.ones((3, 1, 1, 3))

    out = apply_per_frame_bypass(source, processed, (True, True, True))

    assert torch.allclose(out, source)


def test_mixed_tuple_selects_per_frame():
    source = torch.zeros((3, 1, 1, 3))
    processed = torch.ones((3, 1, 1, 3))

    out = apply_per_frame_bypass(source, processed, (True, False, True))

    assert torch.allclose(out[0], source[0])
    assert torch.allclose(out[1], processed[1])
    assert torch.allclose(out[2], source[2])


def test_mixed_list_still_works():
    source = torch.zeros((2, 1, 1, 3))
    processed = torch.ones((2, 1, 1, 3))

    out = apply_per_frame_bypass(source, processed, [False, True])

    assert torch.allclose(out[0], processed[0])
    assert torch.allclose(out[1], source[1])
