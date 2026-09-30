"""Preview temp files must be pruned across runs, mirroring routes.py's viewmedia
cache — without this, every node execution leaves new uuid4()-named files behind
forever."""
from __future__ import annotations

from pathlib import Path

import torch

import folder_paths
from nodes import preview


def test_save_temp_images_prunes_old_files(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(tmp_path))

    image = torch.zeros(1, 4, 4, 3)
    for _ in range(preview._MAX_PREVIEW_CACHE_FILES + 10):
        preview.save_temp_images(image, prefix="imageops_preview")

    remaining = list(Path(tmp_path).glob("imageops_preview_*"))
    assert len(remaining) == preview._MAX_PREVIEW_CACHE_FILES


def test_save_temp_animated_prunes_old_files(tmp_path, monkeypatch):
    monkeypatch.setattr(folder_paths, "get_temp_directory", lambda: str(tmp_path))

    images = torch.zeros(3, 4, 4, 3)
    for _ in range(preview._MAX_PREVIEW_CACHE_FILES + 10):
        preview.save_temp_animated(images, prefix="imageops_preview", ext="webp")

    remaining = list(Path(tmp_path).glob("imageops_preview_*"))
    assert len(remaining) == preview._MAX_PREVIEW_CACHE_FILES
