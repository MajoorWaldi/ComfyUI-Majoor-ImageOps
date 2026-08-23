"""Tests for core/memory.py — memory budget contract."""
from __future__ import annotations

import pytest
import torch

from nodes.core.memory import MemoryBudgetError, check_budget, estimate_bytes


class TestEstimateBytes:
    def test_basic_float32(self):
        # 1 frame, 64x64, 3 channels, float32 (4 bytes), multiplier 1
        est = estimate_bytes(1, 64, 64, 3, torch.float32, 1.0)
        assert est == 1 * 64 * 64 * 3 * 4

    def test_multiplier(self):
        base = estimate_bytes(1, 64, 64, 3, torch.float32, 1.0)
        doubled = estimate_bytes(1, 64, 64, 3, torch.float32, 2.0)
        assert doubled == base * 2

    def test_fp16(self):
        est = estimate_bytes(1, 64, 64, 3, torch.float16, 1.0)
        assert est == 1 * 64 * 64 * 3 * 2

    def test_batch_scaling(self):
        one = estimate_bytes(1, 64, 64, 3, torch.float32, 1.0)
        four = estimate_bytes(4, 64, 64, 3, torch.float32, 1.0)
        assert four == one * 4


class TestCheckBudget:
    def test_within_budget(self):
        # 1 frame, 64x64, 3ch, float32 — tiny allocation
        result = check_budget(1, 64, 64, 3, budget_mb=100.0, label="test")
        assert result > 0

    def test_exceeds_budget_raises(self):
        # 1000 frames, 8192x8192, 4ch, float32 — absurd allocation
        with pytest.raises(MemoryBudgetError) as exc_info:
            check_budget(
                1000, 8192, 8192, 4,
                budget_mb=1.0,
                label="ImageOps Constant",
            )
        assert "ImageOps Constant" in str(exc_info.value)
        assert "budget" in str(exc_info.value).lower()

    def test_error_attributes(self):
        with pytest.raises(MemoryBudgetError) as exc_info:
            check_budget(1000, 4096, 4096, 4, budget_mb=1.0, label="test")
        err = exc_info.value
        assert err.estimated_mb > 1.0
        assert err.budget_mb == 1.0
        assert err.label == "test"

    def test_custom_multiplier(self):
        # Should pass with multiplier 1 but fail with multiplier 100
        check_budget(100, 1024, 1024, 4, multiplier=1.0, budget_mb=2048.0, label="test")
        with pytest.raises(MemoryBudgetError):
            check_budget(100, 1024, 1024, 4, multiplier=100.0, budget_mb=2048.0, label="test")
