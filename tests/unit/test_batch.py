from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
import torch


ROOT = Path(__file__).resolve().parents[2]
BATCH_FILE = ROOT / "nodes" / "core" / "batch.py"

spec = importlib.util.spec_from_file_location(
    "imageops_batch_test_module",
    BATCH_FILE,
)

assert spec is not None
assert spec.loader is not None

batch_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch_module)


match_batch = batch_module.match_batch
match_mask_batch = batch_module.match_mask_batch
BatchMismatchError = batch_module.BatchMismatchError


def test_equal_batches_unchanged():
    a = torch.zeros(4, 8, 8, 3)
    b = torch.ones(4, 8, 8, 3)

    aa, bb = match_batch(a, b)

    assert aa.shape == a.shape
    assert bb.shape == b.shape


def test_singleton_broadcast():
    a = torch.zeros(1, 8, 8, 3)
    b = torch.ones(4, 8, 8, 3)

    aa, bb = match_batch(a, b)

    assert aa.shape[0] == 4
    assert bb.shape[0] == 4


def test_strict_mismatch_raises():
    a = torch.zeros(3, 8, 8, 3)
    b = torch.ones(7, 8, 8, 3)

    with pytest.raises(BatchMismatchError):
        match_batch(a, b)


def test_hold_last():
    a = torch.arange(3).view(3, 1)
    b = torch.arange(5).view(5, 1)

    aa, bb = match_batch(
        a,
        b,
        policy="hold_last",
    )

    assert aa[:, 0].tolist() == [0, 1, 2, 2, 2]
    assert bb[:, 0].tolist() == [0, 1, 2, 3, 4]


def test_loop_is_explicit():
    a = torch.arange(3).view(3, 1)
    b = torch.arange(7).view(7, 1)

    aa, _ = match_batch(
        a,
        b,
        policy="loop",
    )

    assert aa[:, 0].tolist() == [
        0, 1, 2,
        0, 1, 2,
        0,
    ]


def test_mask_singleton_broadcast():
    mask = torch.ones(1, 16, 16)

    result = match_mask_batch(
        mask,
        target_batch=4,
    )

    assert result.shape == (4, 16, 16)


def test_mask_mismatch_raises():
    mask = torch.ones(3, 16, 16)

    with pytest.raises(BatchMismatchError):
        match_mask_batch(
            mask,
            target_batch=7,
        )
