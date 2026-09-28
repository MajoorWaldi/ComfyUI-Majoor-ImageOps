"""Unit tests for ImageOpsCrop including mask synchronization."""
from __future__ import annotations

import pytest
import torch

from nodes.crop import ImageOpsCrop


def _unwrap(result):
    if isinstance(result, dict):
        return result["result"]
    return result


class TestImageOpsCrop:
    def test_crop_with_mask_synchronized(self):
        node = ImageOpsCrop()
        image = torch.zeros(1, 100, 100, 3, dtype=torch.float32)
        # Put distinct values in quadrant
        image[0, :50, :50, 0] = 1.0

        mask = torch.zeros(1, 100, 100, dtype=torch.float32)
        mask[0, :50, :50] = 1.0

        result = _unwrap(node.execute(
            image=image,
            mask=mask,
            aspect_ratio="1:1",
            width=50,
            height=50,
            crop_center_x=0.25,
            crop_center_y=0.25,
            crop_scale=0.5,
        ))

        out_image = result[0]
        out_mask = result[1]

        assert out_image.shape == (1, 50, 50, 3)
        assert out_mask.shape == (1, 50, 50)
        # Cropped region should capture the white area in both image and mask
        assert (out_image[..., 0] > 0.9).all()
        assert (out_mask > 0.9).all()

    def test_crop_bypass(self):
        node = ImageOpsCrop()
        image = torch.rand(1, 80, 80, 3, dtype=torch.float32)
        mask = torch.rand(1, 80, 80, dtype=torch.float32)

        result = _unwrap(node.execute(image=image, mask=mask, bypass=True))
        out_image = result[0]
        out_mask = result[1]

        assert torch.allclose(out_image, image)
        assert torch.allclose(out_mask, mask)


class TestCropBoundingBox:
    def _crop(self):
        image = torch.rand(1, 100, 120, 3, dtype=torch.float32)
        result = _unwrap(ImageOpsCrop().execute(
            image=image,
            aspect_ratio="1:1",
            width=40,
            height=40,
            crop_center_x=0.25,
            crop_center_y=0.75,
            crop_scale=0.5,
        ))
        return image, result

    def test_bounding_box_output_is_core_bbox_and_appended_last(self):
        _, result = self._crop()

        assert [type(item).__name__ for item in result[:3]] == ["Tensor", "Tensor", "dict"]
        assert set(result[3]) == {"x", "y", "width", "height"}
        frame = result[2]["bbox"]
        assert result[3] == {key: frame[key] for key in ("x", "y", "width", "height")}
        assert all(isinstance(value, int) for value in result[3].values())

    def test_crop_stitch_accepts_core_bounding_box(self):
        from nodes.crop_stitch import ImageOpsCropStitch

        image, result = self._crop()
        patch = torch.ones_like(result[0])

        with_payload = _unwrap(ImageOpsCropStitch().execute(original=image, crop=patch, crop_bbox=result[2]))
        with_core_bbox = _unwrap(ImageOpsCropStitch().execute(original=image, crop=patch, bounding_box=result[3]))

        assert torch.allclose(with_payload[0], with_core_bbox[0])
        assert not torch.allclose(with_core_bbox[0], image)
