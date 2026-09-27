from __future__ import annotations

from nodes.core.bbox import BBox


def test_width_and_height():
    box = BBox(10, 20, 40, 50)

    assert box.width == 30
    assert box.height == 30


def test_negative_extent_reports_zero_size():
    box = BBox(40, 40, 10, 10)

    assert box.width == 0
    assert box.height == 0
    assert box.is_empty


def test_expand_grows_in_all_directions():
    box = BBox(10, 10, 20, 20).expand(5)

    assert box == BBox(5, 5, 25, 25)


def test_intersect():
    a = BBox(0, 0, 10, 10)
    b = BBox(5, 5, 15, 15)

    assert a.intersect(b) == BBox(5, 5, 10, 10)


def test_intersect_disjoint_is_empty():
    a = BBox(0, 0, 5, 5)
    b = BBox(10, 10, 15, 15)

    assert a.intersect(b).is_empty


def test_union():
    a = BBox(0, 0, 10, 10)
    b = BBox(5, 5, 20, 15)

    assert a.union(b) == BBox(0, 0, 20, 15)


def test_clamp_to_frame():
    box = BBox(-10, -10, 200, 200)

    assert box.clamp_to_frame(100, 80) == BBox(0, 0, 100, 80)
