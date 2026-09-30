"""Tests for core/memory.py — memory budget contract."""
from __future__ import annotations

import pytest
import torch
import types
import sys

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

    def test_cuda_probe_failure_falls_back_to_static_budget(self, monkeypatch):
        mm = types.ModuleType("comfy.model_management")

        def _raise_assertion():
            raise AssertionError("Torch not compiled with CUDA enabled")

        mm.get_torch_device = _raise_assertion
        mm.get_free_memory = lambda _device: 0

        comfy = types.ModuleType("comfy")
        comfy.model_management = mm
        monkeypatch.setitem(sys.modules, "comfy", comfy)
        monkeypatch.setitem(sys.modules, "comfy.model_management", mm)

        result = check_budget(1, 64, 64, 3, budget_mb=100.0, label="test")
        assert result > 0

    def test_device_param_checks_free_memory_for_that_device_not_compute_device(self, monkeypatch):
        # Regression: check_budget used to always ask for the compute device's
        # (GPU) free memory even when the allocation was actually going to land on
        # CPU, so a CPU-bound run could be rejected/accepted based on GPU headroom.
        mm = types.ModuleType("comfy.model_management")
        seen_devices = []

        def _get_free_memory(device):
            seen_devices.append(device)
            return 100 if device == torch.device("cpu") else 10 ** 12

        mm.get_torch_device = lambda: torch.device("cuda")
        mm.get_free_memory = _get_free_memory
        comfy = types.ModuleType("comfy")
        comfy.model_management = mm
        monkeypatch.setitem(sys.modules, "comfy", comfy)
        monkeypatch.setitem(sys.modules, "comfy.model_management", mm)

        # 1 frame, 64x64, 3ch, float32 fits easily under the GPU's fake 10^12 bytes free...
        check_budget(1, 64, 64, 3, label="test", device=torch.device("cuda"))
        # ...but the CPU device is deliberately starved to ~100 bytes free, so passing
        # it explicitly must make the same allocation fail against CPU headroom instead.
        with pytest.raises(MemoryBudgetError):
            check_budget(1, 64, 64, 3, label="test", device=torch.device("cpu"))

        assert torch.device("cpu") in seen_devices
        assert torch.device("cuda") in seen_devices

    def test_device_param_omitted_preserves_default_behavior(self, monkeypatch):
        mm = types.ModuleType("comfy.model_management")
        seen_devices = []

        def _get_free_memory(device):
            seen_devices.append(device)
            return 10 ** 12

        mm.get_torch_device = lambda: torch.device("cuda")
        mm.get_free_memory = _get_free_memory
        comfy = types.ModuleType("comfy")
        comfy.model_management = mm
        monkeypatch.setitem(sys.modules, "comfy", comfy)
        monkeypatch.setitem(sys.modules, "comfy.model_management", mm)

        check_budget(1, 64, 64, 3, label="test")

        assert seen_devices == [torch.device("cuda")]


class TestComputeDevice:
    @pytest.fixture
    def fake_mm(self, monkeypatch):
        mm = types.ModuleType("comfy.model_management")
        mm.free = 10 ** 12
        mm.get_torch_device = lambda: torch.device("meta")
        mm.get_free_memory = lambda _device: mm.free
        mm.intermediate_device = lambda: torch.device("cpu")
        comfy = types.ModuleType("comfy")
        comfy.model_management = mm
        monkeypatch.setitem(sys.modules, "comfy", comfy)
        monkeypatch.setitem(sys.modules, "comfy.model_management", mm)
        return mm

    def test_moves_when_working_set_fits(self, fake_mm):
        from nodes.core.memory import to_compute_device

        assert to_compute_device(torch.zeros(2, 8, 8, 3), 4.0).device.type == "meta"

    def test_stays_when_working_set_does_not_fit(self, fake_mm):
        from nodes.core.memory import to_compute_device

        fake_mm.free = 2 * 8 * 8 * 3 * 4 * 3
        assert to_compute_device(torch.zeros(2, 8, 8, 3), 4.0).device.type == "cpu"

    def test_env_override_keeps_input_device(self, fake_mm, monkeypatch):
        from nodes.core import memory

        monkeypatch.setattr(memory, "COMPUTE_DEVICE", "cpu")
        assert memory.to_compute_device(torch.zeros(1, 4, 4, 3), 4.0).device.type == "cpu"

    def test_no_comfy_keeps_input_device(self, monkeypatch):
        from nodes.core.memory import to_compute_device, to_intermediate_device

        monkeypatch.setitem(sys.modules, "comfy", None)
        monkeypatch.setitem(sys.modules, "comfy.model_management", None)
        tensor = torch.zeros(1, 4, 4, 3)
        assert to_compute_device(tensor, 4.0) is tensor
        assert to_intermediate_device(tensor) is tensor
