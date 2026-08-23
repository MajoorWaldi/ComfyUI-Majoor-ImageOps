import torch
import pytest
from nodes.transform import ImageOpsTransform

def test_transform_expand():
    node = ImageOpsTransform()
    
    # 100x100 white image
    image = torch.ones((1, 100, 100, 3))
    
    # Translate by 50 in X, and expand
    # Center of original is at (50, 50).
    # Translation shifts center by 50 to the right. 
    # New X coordinates will span from -50+50 = 0 to 50+50 = 100.
    # So max_x = 100, min_x = 0.
    # Expand is currently disabled (fixed-size canvas).
    # W_out = 100, H_out = 100.
    # New image should be 100x100.
    result, mask = node.execute(
        image=image,
        translate_x=50.0,
        translate_y=0.0,
        rotate_deg=0.0,
        scale=1.0,
        expand=True,
        fill_mode="transparent",
        filter="nearest"
    )
    
    assert result.shape == (1, 100, 100, 3)
    
    # Rotate by 90 degrees, W=100, H=200
    image2 = torch.ones((1, 200, 100, 3))
    # After 90 deg rotation, corners swap. W_out should be 200, H_out should be 100.
    result2, mask2 = node.execute(
        image=image2,
        translate_x=0.0,
        translate_y=0.0,
        rotate_deg=90.0,
        scale=1.0,
        expand=True,
        fill_mode="transparent",
        filter="nearest"
    )
    
    assert result2.shape == (1, 200, 100, 3)
