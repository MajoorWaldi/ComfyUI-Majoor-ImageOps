"""Tests for nodes.core.roto: keyframe evaluation and matte rasterisation."""
from __future__ import annotations

import json

import numpy as np

from nodes.core.roto import (
    _MAX_JSON_CHARS,
    _MAX_KEYFRAMES_PER_SHAPE,
    _MAX_POINTS_PER_SHAPE,
    _MAX_SHAPES,
    eval_shape,
    flatten,
    is_animated,
    parse_shapes,
    render_matte,
)

K = 0.5522847498


def _rect(x0, y0, x1, y1):
    return [[x0, y0, 0, 0, 0, 0], [x1, y0, 0, 0, 0, 0], [x1, y1, 0, 0, 0, 0], [x0, y1, 0, 0, 0, 0]]


def _ellipse(cx, cy, rx, ry):
    kx, ky = K * rx, K * ry
    return [
        [cx, cy - ry, -kx, 0, kx, 0],
        [cx + rx, cy, 0, -ky, 0, ky],
        [cx, cy + ry, kx, 0, -kx, 0],
        [cx - rx, cy, 0, ky, 0, -ky],
    ]


def _doc(*shapes):
    return json.dumps({"v": 1, "shapes": list(shapes)})


def _shape(pts, op="add", **extra):
    return {"id": "s", "keys": [{"f": 0, "pts": pts}], "op": op, **extra}


def test_parse_ignores_garbage():
    assert parse_shapes("") == []
    assert parse_shapes("not json") == []
    assert parse_shapes(json.dumps({"shapes": [{"keys": []}]})) == []


def test_rect_matte_covers_expected_area():
    shapes = parse_shapes(_doc(_shape(_rect(0.25, 0.25, 0.75, 0.75))))
    matte = render_matte(shapes, 0, 64, 64)
    assert matte.shape == (64, 64)
    assert matte[32, 32] == 1.0
    assert matte[2, 2] == 0.0
    assert abs(float(matte.sum()) - 32 * 32) < 40


def test_ellipse_area_matches_formula():
    shapes = parse_shapes(_doc(_shape(_ellipse(0.5, 0.5, 0.25, 0.25))))
    matte = render_matte(shapes, 0, 128, 128)
    expected = np.pi * (0.25 * 128) ** 2
    assert abs(float(matte.sum()) - expected) / expected < 0.02


def test_subtract_and_intersect():
    base = _shape(_rect(0.0, 0.0, 1.0, 1.0))
    hole = _shape(_rect(0.25, 0.25, 0.75, 0.75), op="subtract")
    matte = render_matte(parse_shapes(_doc(base, hole)), 0, 32, 32)
    assert matte[16, 16] == 0.0 and matte[1, 1] == 1.0
    clip = _shape(_rect(0.0, 0.0, 0.5, 1.0), op="intersect")
    matte = render_matte(parse_shapes(_doc(base, clip)), 0, 32, 32)
    assert matte[16, 4] == 1.0 and matte[16, 28] == 0.0


def test_expand_feather_invert_opacity():
    shapes = parse_shapes(_doc(_shape(_rect(0.25, 0.25, 0.75, 0.75))))
    plain = render_matte(shapes, 0, 64, 64)
    grown = render_matte(shapes, 0, 64, 64, expand=4.0)
    shrunk = render_matte(shapes, 0, 64, 64, expand=-4.0)
    assert grown.sum() > plain.sum() > shrunk.sum()
    soft = render_matte(shapes, 0, 64, 64, feather=8.0)
    assert 0.0 < float(soft[16, 32]) < 1.0
    inverted = render_matte(shapes, 0, 64, 64, invert=True)
    assert inverted[32, 32] == 0.0 and inverted[2, 2] == 1.0
    assert abs(float(render_matte(shapes, 0, 64, 64, opacity=0.5)[32, 32]) - 0.5) < 1e-6


def test_keyframes_interpolate_and_hold():
    shape = _shape(_rect(0.0, 0.0, 0.2, 0.2))
    shape["keys"].append({"f": 10, "pts": _rect(0.6, 0.6, 0.8, 0.8)})
    parsed = parse_shapes(_doc(shape))
    assert is_animated(parsed)
    assert np.allclose(eval_shape(parsed[0], -5)[0, :2], [0.0, 0.0])
    assert np.allclose(eval_shape(parsed[0], 5)[0, :2], [0.3, 0.3])
    assert np.allclose(eval_shape(parsed[0], 50)[0, :2], [0.6, 0.6])
    early = render_matte(parsed, 0, 50, 50)
    late = render_matte(parsed, 10, 50, 50)
    assert early[5, 5] == 1.0 and early[35, 35] == 0.0
    assert late[35, 35] == 1.0 and late[5, 5] == 0.0


def test_open_path_flatten_keeps_endpoint():
    pts = np.asarray(_rect(0.0, 0.0, 1.0, 1.0), dtype=np.float64)
    assert np.allclose(flatten(pts, False, 10, 10)[-1], [0.0, 10.0])
    assert len(flatten(pts, True, 10, 10)) > len(flatten(pts, False, 10, 10))


def test_js_parity_anchor():
    """Same document and expected values as tests/frontend/roto-shapes.test.cjs."""
    shape = {"id": "s1", "closed": True, "keys": [
        {"f": 0, "pts": _ellipse(0.4, 0.5, 0.2, 0.3)},
        {"f": 10, "pts": _ellipse(0.6, 0.4, 0.25, 0.2)},
    ]}
    parsed = parse_shapes(_doc(shape))
    poly = flatten(eval_shape(parsed[0], 4), True, 200, 100)
    assert len(poly) == 80
    assert np.allclose(poly[0], [96, 20], atol=1e-4)


def test_oversized_json_payload_is_rejected():
    huge = "x" * (_MAX_JSON_CHARS + 1)
    assert parse_shapes(huge) == []


def test_shape_count_is_capped():
    shapes = [_shape(_rect(0.0, 0.0, 0.1, 0.1)) for _ in range(_MAX_SHAPES + 50)]
    parsed = parse_shapes(_doc(*shapes))
    assert len(parsed) == _MAX_SHAPES


def test_keyframe_count_is_capped():
    shape = _shape(_rect(0.0, 0.0, 0.1, 0.1))
    shape["keys"] = [{"f": i, "pts": _rect(0.0, 0.0, 0.1, 0.1)} for i in range(_MAX_KEYFRAMES_PER_SHAPE + 20)]
    parsed = parse_shapes(_doc(shape))
    assert len(parsed[0]["keys"]) == _MAX_KEYFRAMES_PER_SHAPE


def test_point_count_per_key_is_capped():
    shape = _shape([[0.0, 0.0, 0.0, 0.0, 0.0, 0.0]] * (_MAX_POINTS_PER_SHAPE + 20))
    parsed = parse_shapes(_doc(shape))
    assert len(parsed[0]["keys"][0][1]) == _MAX_POINTS_PER_SHAPE
