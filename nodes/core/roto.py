"""Vector roto shapes: keyframe evaluation and rasterisation.

Shapes are bezier point lists in normalised image coordinates. Every point is
``(x, y, in_dx, in_dy, out_dx, out_dy)``; the handle offsets are relative to the
point. ``js/preview/roto/shapes.js`` mirrors the evaluation and flattening done
here so the live preview matches the backend.
"""
from __future__ import annotations

import json
import math

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

_OPS = ("add", "subtract", "intersect")
_SUPERSAMPLE_MAX = 4
_SUPERSAMPLE_PIXEL_BUDGET = 3.2e7

# Reject an oversized/absurd roto payload before JSON-parsing it, and cap how many
# shapes/keyframes/points get decoded regardless of how many the JSON claims — mirrors
# the guards in nodes/draw.py for the same reason (untrusted widget/live-editor JSON).
_MAX_JSON_CHARS = 16_000_000
_MAX_SHAPES = 256
_MAX_KEYFRAMES_PER_SHAPE = 512
_MAX_POINTS_PER_SHAPE = 2048


def parse_shapes(text) -> list[dict]:
    """Decode the widget JSON into shape dicts with sorted, validated keyframes."""
    if not text or len(text) > _MAX_JSON_CHARS:
        return []
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        return []
    shapes = []
    raw_shapes = data.get("shapes", []) if isinstance(data, dict) else []
    for raw in raw_shapes[:_MAX_SHAPES]:
        keys = []
        for key in raw.get("keys", [])[:_MAX_KEYFRAMES_PER_SHAPE]:
            pts = [tuple(float(v) for v in p[:6]) for p in key.get("pts", [])[:_MAX_POINTS_PER_SHAPE] if len(p) >= 6]
            if pts:
                keys.append((float(key.get("f", 0.0)), np.asarray(pts, dtype=np.float64)))
        if not keys:
            continue
        keys.sort(key=lambda k: k[0])
        op = raw.get("op", "add")
        shapes.append({
            "keys": keys,
            "closed": bool(raw.get("closed", True)),
            "op": op if op in _OPS else "add",
            "feather": max(0.0, float(raw.get("feather", 0.0))),
            "opacity": min(1.0, max(0.0, float(raw.get("opacity", 1.0)))),
            "visible": bool(raw.get("visible", True)),
        })
    return shapes


def is_animated(shapes: list[dict]) -> bool:
    return any(len(s["keys"]) > 1 for s in shapes)


def eval_shape(shape: dict, frame: float) -> np.ndarray:
    """Linear interpolation between the surrounding keyframes, held outside the range."""
    keys = shape["keys"]
    if len(keys) == 1 or frame <= keys[0][0]:
        return keys[0][1]
    if frame >= keys[-1][0]:
        return keys[-1][1]
    for (f0, p0), (f1, p1) in zip(keys, keys[1:]):
        if f0 <= frame <= f1:
            if p0.shape != p1.shape:
                return p0
            t = (frame - f0) / (f1 - f0)
            return p0 + (p1 - p0) * t
    return keys[-1][1]


def flatten(pts: np.ndarray, closed: bool, width: int, height: int) -> np.ndarray:
    """Sample the bezier path into an (M, 2) polyline in pixel coordinates."""
    n = len(pts)
    scale = np.array([width, height], dtype=np.float64)
    pos = pts[:, 0:2] * scale
    handle_in = pos + pts[:, 2:4] * scale
    handle_out = pos + pts[:, 4:6] * scale
    segments = n if closed else n - 1
    out = []
    for i in range(segments):
        j = (i + 1) % n
        p0, p1, p2, p3 = pos[i], handle_out[i], handle_in[j], pos[j]
        length = np.linalg.norm(p1 - p0) + np.linalg.norm(p2 - p1) + np.linalg.norm(p3 - p2)
        steps = int(min(64, max(6, length / 3.0)))
        t = np.linspace(0.0, 1.0, steps, endpoint=False)[:, None]
        mt = 1.0 - t
        out.append(mt ** 3 * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t ** 3 * p3)
    if not closed:
        out.append(pos[-1][None, :])
    return np.concatenate(out, axis=0) if out else pos


def _supersample(width: int, height: int) -> int:
    fit = int(math.sqrt(_SUPERSAMPLE_PIXEL_BUDGET / max(1, width * height)))
    return max(1, min(_SUPERSAMPLE_MAX, fit))


def _rasterize(poly: np.ndarray, width: int, height: int, expand: float) -> np.ndarray:
    ss = _supersample(width, height)
    image = Image.new("L", (width * ss, height * ss), 0)
    draw = ImageDraw.Draw(image)
    points = [(float(x) * ss, float(y) * ss) for x, y in poly]
    if len(points) >= 3:
        draw.polygon(points, fill=255)
    if expand and len(points) >= 2:
        draw.line(points + [points[0]], fill=255 if expand > 0 else 0,
                  width=max(1, int(round(abs(expand) * 2 * ss))), joint="curve")
    if ss > 1:
        image = image.resize((width, height), Image.BOX)
    return np.asarray(image, dtype=np.float32) / 255.0


def _gaussian_blur(mask: torch.Tensor, sigma: float) -> torch.Tensor:
    radius = max(1, int(math.ceil(sigma * 3.0)))
    xs = torch.arange(-radius, radius + 1, dtype=torch.float32)
    kernel = torch.exp(-(xs * xs) / (2.0 * sigma * sigma))
    kernel = kernel / kernel.sum()
    x = mask[None, None]
    x = F.pad(x, (radius, radius, 0, 0), mode="replicate")
    x = F.conv2d(x, kernel.view(1, 1, 1, -1))
    x = F.pad(x, (0, 0, radius, radius), mode="replicate")
    x = F.conv2d(x, kernel.view(1, 1, -1, 1))
    return x[0, 0]


def render_matte(shapes: list[dict], frame: float, width: int, height: int,
                 expand: float = 0.0, feather: float = 0.0, opacity: float = 1.0,
                 invert: bool = False) -> torch.Tensor:
    """Composite all shapes into a float (H, W) matte in [0, 1]."""
    matte = torch.zeros((height, width), dtype=torch.float32)
    for shape in shapes:
        if not shape["visible"]:
            continue
        pts = eval_shape(shape, frame)
        if len(pts) < 2:
            continue
        op = shape["op"]
        poly = flatten(pts, shape["closed"], width, height)
        layer = torch.from_numpy(_rasterize(poly, width, height, -expand if op == "subtract" else expand))
        if shape["feather"] > 0.0:
            layer = _gaussian_blur(layer, shape["feather"] * 0.5)
        layer = layer * shape["opacity"]
        if op == "subtract":
            matte = matte * (1.0 - layer)
        elif op == "intersect":
            matte = matte * layer
        else:
            matte = layer + matte * (1.0 - layer)
    if feather > 0.0:
        matte = _gaussian_blur(matte, feather * 0.5)
    if invert:
        matte = 1.0 - matte
    return (matte * opacity).clamp(0.0, 1.0)
