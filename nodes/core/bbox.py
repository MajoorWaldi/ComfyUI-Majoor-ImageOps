"""Bounding-box helper for internal ROI bookkeeping.

This is an internal optimization hint (e.g. "only this region changed, only
process/union this region"), never a replacement for the public ComfyUI IMAGE
tensor. Coordinates are pixel-space, x1/y1 exclusive (like a Python slice end).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    x0: int
    y0: int
    x1: int
    y1: int

    @property
    def width(self) -> int:
        return max(0, self.x1 - self.x0)

    @property
    def height(self) -> int:
        return max(0, self.y1 - self.y0)

    @property
    def is_empty(self) -> bool:
        return self.width <= 0 or self.height <= 0

    def expand(self, pixels: int) -> "BBox":
        return BBox(self.x0 - pixels, self.y0 - pixels, self.x1 + pixels, self.y1 + pixels)

    def intersect(self, other: "BBox") -> "BBox":
        return BBox(
            max(self.x0, other.x0),
            max(self.y0, other.y0),
            min(self.x1, other.x1),
            min(self.y1, other.y1),
        )

    def union(self, other: "BBox") -> "BBox":
        return BBox(
            min(self.x0, other.x0),
            min(self.y0, other.y0),
            max(self.x1, other.x1),
            max(self.y1, other.y1),
        )

    def clamp_to_frame(self, width: int, height: int) -> "BBox":
        return BBox(
            max(0, min(self.x0, width)),
            max(0, min(self.y0, height)),
            max(0, min(self.x1, width)),
            max(0, min(self.y1, height)),
        )
