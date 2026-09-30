"""Grain RNG must generate on the tensor's own device for CUDA/MPS instead of
always paying a CPU round-trip, while staying on CPU for backends torch.Generator
doesn't support directly (DirectML, XPU, NPU)."""
from __future__ import annotations

import torch

from nodes.grain import _grain_generator_device, _grain_noise_like


class _DeviceStub:
    def __init__(self, type_name):
        self.type = type_name


class _TensorStub:
    def __init__(self, type_name):
        self.device = _DeviceStub(type_name)


def test_generator_device_matches_supported_backends():
    assert _grain_generator_device(_TensorStub("cuda")).type == "cuda"
    assert _grain_generator_device(_TensorStub("mps")).type == "mps"
    assert _grain_generator_device(_TensorStub("cpu")).type == "cpu"


def test_generator_device_falls_back_to_cpu_for_unsupported_backends():
    # torch.Generator has no native support for DirectML/XPU/NPU backends.
    assert _grain_generator_device(_TensorStub("privateuseone")).type == "cpu"
    assert _grain_generator_device(_TensorStub("xpu")).type == "cpu"


def test_grain_noise_like_still_produces_correct_shape_and_device_on_cpu():
    source = torch.zeros(2, 8, 8, 3)

    noise = _grain_noise_like(source, seed=1, monochrome=False, animated=True)

    assert noise.shape == source.shape
    assert noise.device == source.device
