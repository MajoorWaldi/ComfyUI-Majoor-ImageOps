import json
import os
import torch
import pytest

from nodes._helpers import _blend_rgb

def load_blend_cases():
    golden_path = os.path.join(os.path.dirname(__file__), "..", "golden", "blend_modes.json")
    with open(golden_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    cases = []
    # Use max(1e-4, json_tolerance) as requested
    tolerance = max(data.get("_meta", {}).get("tolerance_abs", 1e-5), 1e-4)
    
    for mode_name, mode_data in data["modes"].items():
        for case in mode_data["cases"]:
            cases.append((mode_name, case["base"], case["top"], case["expected"], tolerance))
            
    return cases

@pytest.mark.parametrize("mode, base_val, top_val, expected, tolerance", load_blend_cases())
def test_blend_mode_parity(mode, base_val, top_val, expected, tolerance):
    base_tensor = torch.tensor([base_val], dtype=torch.float32)
    top_tensor = torch.tensor([top_val], dtype=torch.float32)
    
    result = _blend_rgb(base_tensor, top_tensor, mode)
    result_val = result.item()
    
    assert abs(result_val - expected) <= tolerance, (
        f"Mode '{mode}' with base={base_val}, top={top_val}: "
        f"expected {expected}, got {result_val}"
    )
