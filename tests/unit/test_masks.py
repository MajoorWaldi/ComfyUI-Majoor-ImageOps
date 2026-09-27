from __future__ import annotations

import pytest
import torch

from nodes.core.batch import BatchMismatchError
from nodes.core.masks import apply_mask_mix, normalize_mask


def test_normalize_mask_none_passes_through():
    assert normalize_mask(None, target_batch=3) is None


def test_normalize_mask_clamps_out_of_range_values():
    mask = torch.tensor([[[-1.0, 2.0]]])

    normalized = normalize_mask(mask, target_batch=1)

    assert normalized.min() >= 0.0
    assert normalized.max() <= 1.0


def test_normalize_mask_invert():
    mask = torch.tensor([[[0.0, 1.0]]])

    inverted = normalize_mask(mask, target_batch=1, invert=True)

    assert torch.allclose(inverted, torch.tensor([[[1.0, 0.0]]]))


def test_normalize_mask_broadcasts_singleton_batch():
    mask = torch.zeros((1, 2, 2))

    normalized = normalize_mask(mask, target_batch=4)

    assert normalized.shape[0] == 4


def test_normalize_mask_rejects_mismatched_non_singleton_batch():
    mask = torch.zeros((2, 2, 2))

    with pytest.raises(BatchMismatchError):
        normalize_mask(mask, target_batch=5)


def test_apply_mask_mix_mask_zero_is_original():
    source = torch.zeros((1, 2, 2, 3))
    processed = torch.ones((1, 2, 2, 3))
    mask = torch.zeros((1, 2, 2))

    out = apply_mask_mix(source, processed, mask)

    assert torch.allclose(out, source)


def test_apply_mask_mix_mask_one_is_processed():
    source = torch.zeros((1, 2, 2, 3))
    processed = torch.ones((1, 2, 2, 3))
    mask = torch.ones((1, 2, 2))

    out = apply_mask_mix(source, processed, mask)

    assert torch.allclose(out, processed)


def test_apply_mask_mix_no_mask_uses_mix_only():
    source = torch.zeros((1, 2, 2, 3))
    processed = torch.ones((1, 2, 2, 3))

    out = apply_mask_mix(source, processed, None, mix=0.5)

    assert torch.allclose(out, torch.full_like(source, 0.5))


def test_apply_mask_mix_zero_mix_is_original_even_with_mask_one():
    source = torch.zeros((1, 2, 2, 3))
    processed = torch.ones((1, 2, 2, 3))
    mask = torch.ones((1, 2, 2))

    out = apply_mask_mix(source, processed, mask, mix=0.0)

    assert torch.allclose(out, source)
