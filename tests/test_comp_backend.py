import unittest
from unittest.mock import patch
import sys
import types
import io
import base64
from pathlib import Path

import torch
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
else:
    sys.path.remove(str(ROOT))
    sys.path.insert(0, str(ROOT))

# Ensure the plugin's local nodes package wins over ComfyUI's top-level nodes.py.
loaded_nodes = sys.modules.get("nodes")
if loaded_nodes is not None:
    loaded_path = getattr(loaded_nodes, "__file__", "") or ""
    if Path(loaded_path).resolve() == ROOT.parent.parent / "nodes.py":
        sys.modules.pop("nodes", None)

folder_paths_stub = types.ModuleType("folder_paths")
folder_paths_stub.get_temp_directory = lambda: "."
sys.modules.setdefault("folder_paths", folder_paths_stub)

io_stub = types.SimpleNamespace(ComfyNode=object)
comfy_api_stub = types.ModuleType("comfy_api")
comfy_api_latest_stub = types.ModuleType("comfy_api.latest")
comfy_api_latest_stub.io = io_stub
comfy_api_stub.latest = comfy_api_latest_stub
sys.modules.setdefault("comfy_api", comfy_api_stub)
sys.modules.setdefault("comfy_api.latest", comfy_api_latest_stub)

from nodes.comp import ImageOpsComp
from nodes.blur import ImageOpsBlur
from nodes.channel import ImageOpsChannel
from nodes.crop import ImageOpsCrop
from nodes.crop_stitch import ImageOpsCropStitch
from nodes.color_ajust import ImageOpsColorAjust
from nodes.draw import ImageOpsDraw
from nodes.invert import ImageOpsInvert
from nodes.mask_convert import ImageOpsMaskConvert
from nodes.merge import ImageOpsMerge
from nodes.spherize import ImageOpsSpherize
from nodes.transform import ImageOpsTransform
from nodes.corner_pin import ImageOpsCornerPin
from nodes.frame_range import ImageOpsFrameRange
from nodes.padout import ImageOpsPadOut
from nodes._helpers import _apply_mask_to_image, _gaussian_effective_radius, _dispatch_blur


def _preview_result_passthrough(images, result, **kwargs):
    return result


class ImageOpsCompBackendTests(unittest.TestCase):
    def _execute(self, **kwargs):
        with patch("nodes.comp.build_node_preview_result", side_effect=_preview_result_passthrough):
            return ImageOpsComp.execute(**kwargs)

    def test_invert_mask_applies_to_output_mask(self):
        image = torch.tensor(
            [[[[1.0, 0.0, 0.0, 1.0]]]],
            dtype=torch.float32,
        )
        result, output_mask = self._execute(
            layers_json='{"version":1,"layers":[{"slot":"image_1","enabled":true}]}',
            invert_mask=True,
            image_1=image,
        )
        self.assertEqual(tuple(result.shape), (1, 1, 1, 4))
        self.assertTrue(torch.allclose(output_mask, torch.zeros_like(output_mask)))

    def test_layer_mask_controls_comp_output_mask(self):
        image = torch.tensor(
            [[[[1.0, 0.0, 0.0, 1.0]]]],
            dtype=torch.float32,
        )
        mask = torch.zeros((1, 1, 1), dtype=torch.float32)
        _, output_mask = self._execute(
            layers_json='{"version":1,"layers":[{"slot":"image_1","enabled":true}]}',
            image_1=image,
            mask_1=mask,
        )
        self.assertTrue(torch.allclose(output_mask, torch.zeros_like(output_mask)))

    def test_background_color_influences_rgb(self):
        image = torch.tensor(
            [[[[1.0, 0.0, 0.0, 0.5]]]],
            dtype=torch.float32,
        )
        result, output_mask = self._execute(
            background_color="#00ff00",
            layers_json='{"version":1,"layers":[{"slot":"image_1","enabled":true}]}',
            image_1=image,
        )
        expected_rgb = torch.tensor([0.5, 0.5, 0.0], dtype=torch.float32)
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], expected_rgb, atol=1e-5))
        self.assertTrue(torch.allclose(output_mask, torch.full_like(output_mask, 0.5), atol=1e-5))

    def test_rotate_layer_rotates_composited_pixels(self):
        image = torch.tensor(
            [[
                [[1.0, 0.0, 0.0, 1.0]],
                [[0.0, 1.0, 0.0, 1.0]],
            ]],
            dtype=torch.float32,
        )
        result, output_mask = self._execute(
            use_first_layer_size=False,
            width=2,
            height=2,
            background_color="#000000",
            layers_json='{"version":1,"layers":[{"slot":"image_1","enabled":true,"rotate_deg":90}]}',
            image_1=image,
        )
        self.assertTrue(torch.allclose(output_mask[0, 0], torch.ones(2, dtype=torch.float32)))
        self.assertTrue(torch.allclose(output_mask[0, 1], torch.zeros(2, dtype=torch.float32)))
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.tensor([0.0, 1.0, 0.0]), atol=1e-5))
        self.assertTrue(torch.allclose(result[0, 0, 1, :3], torch.tensor([1.0, 0.0, 0.0]), atol=1e-5))

    def test_comp_layer_corner_pin_can_warp_to_quad(self):
        image = torch.ones((1, 4, 4, 4), dtype=torch.float32)
        result, output_mask = self._execute(
            use_first_layer_size=False,
            width=8,
            height=8,
            background_color="#000000",
            layers_json='{"version":1,"layers":[{"slot":"image_1","enabled":true,"tl_x":0.0,"tl_y":0.0,"tr_x":1.0,"tr_y":0.0,"bl_x":0.25,"bl_y":1.0,"br_x":0.75,"br_y":1.0}]}',
            image_1=image,
        )
        self.assertGreater(result[0, 0, 0, 0].item(), 0.9)
        self.assertGreater(output_mask[0, 0, 0].item(), 0.9)


if __name__ == "__main__":
    unittest.main()


class ImageOpsBackendFastPathTests(unittest.TestCase):
    def test_padout_target_format_no_longer_adds_implicit_padding(self):
        image = torch.zeros((1, 10, 10, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        with patch("nodes.padout.build_node_preview_result", side_effect=_preview_result_passthrough):
            result_custom = ImageOpsPadOut().apply(
                image=image,
                pad_left=2,
                pad_top=1,
                pad_right=3,
                pad_bottom=4,
                target_format="custom",
            )
            result_locked = ImageOpsPadOut().apply(
                image=image,
                pad_left=2,
                pad_top=1,
                pad_right=3,
                pad_bottom=4,
                target_format="16:9",
            )
        self.assertEqual(result_custom[2:], result_locked[2:])
        self.assertEqual(tuple(result_locked[0].shape), (1, 15, 15, 4))

    def test_padout_snap_quantizes_explicit_pads_only(self):
        image = torch.zeros((1, 10, 10, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        with patch("nodes.padout.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _, out_w, out_h = ImageOpsPadOut().apply(
                image=image,
                pad_left=3,
                pad_top=5,
                pad_right=7,
                pad_bottom=9,
                snap_to_multiple=4,
                target_format="9:16",
            )
        self.assertEqual(tuple(result.shape), (1, 22, 22, 4))
        self.assertEqual((out_w, out_h), (22, 22))

    def test_padout_uses_fixed_black_padding(self):
        image = torch.ones((1, 2, 2, 4), dtype=torch.float32)
        with patch("nodes.padout.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _, out_w, out_h = ImageOpsPadOut().apply(
                image=image,
                pad_left=1,
                pad_top=1,
                pad_right=1,
                pad_bottom=1,
            )
        self.assertEqual((out_w, out_h), (4, 4))
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.zeros(3, dtype=torch.float32)))
        self.assertAlmostEqual(result[0, 0, 0, 3].item(), 1.0, places=6)

    def test_frame_selector_freeze_clamps_to_trimmed_range(self):
        image = torch.zeros((6, 1, 1, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        for index in range(6):
            image[index, 0, 0, 0] = float(index)
        with patch("nodes.frame_range.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, frame_count = ImageOpsFrameRange().apply(
                image=image,
                trim_start=1,
                trim_end=3,
                frame_hold=True,
                hold_frame=5,
            )
        self.assertEqual(frame_count, 1)
        self.assertTrue(torch.allclose(result[:, 0, 0, 0], torch.tensor([3.0])))

    def test_frame_selector_freeze_without_repeat_outputs_single_frame(self):
        image = torch.zeros((6, 1, 1, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        for index in range(6):
            image[index, 0, 0, 0] = float(index)
        with patch("nodes.frame_range.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, frame_count = ImageOpsFrameRange().apply(
                image=image,
                trim_start=1,
                trim_end=3,
                frame_hold=True,
                hold_frame=2,
            )
        self.assertEqual(frame_count, 1)
        self.assertTrue(torch.allclose(result[:, 0, 0, 0], torch.tensor([2.0])))

    def test_frame_selector_repeat_uses_input_duration(self):
        image = torch.zeros((6, 1, 1, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        for index in range(6):
            image[index, 0, 0, 0] = float(index)
        with patch("nodes.frame_range.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, frame_count = ImageOpsFrameRange().apply(
                image=image,
                trim_start=1,
                trim_end=3,
                frame_hold=True,
                hold_frame=2,
                repeat=True,
                repeat_mode="input_duration",
            )
        self.assertEqual(frame_count, 6)
        self.assertTrue(torch.allclose(result[:, 0, 0, 0], torch.tensor([2.0] * 6)))

    def test_frame_selector_repeat_uses_custom_count(self):
        image = torch.zeros((6, 1, 1, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        for index in range(6):
            image[index, 0, 0, 0] = float(index)
        with patch("nodes.frame_range.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, frame_count = ImageOpsFrameRange().apply(
                image=image,
                trim_start=1,
                trim_end=3,
                frame_hold=True,
                hold_frame=2,
                repeat=True,
                repeat_mode="custom_count",
                custom_frame_count=4,
            )
        self.assertEqual(frame_count, 4)
        self.assertTrue(torch.allclose(result[:, 0, 0, 0], torch.tensor([2.0] * 4)))

    def test_frame_selector_freeze_on_empty_input_is_safe(self):
        image = torch.empty((0, 1, 1, 4), dtype=torch.float32)
        with patch("nodes.frame_range.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, frame_count = ImageOpsFrameRange().apply(
                image=image,
                frame_hold=True,
                hold_frame=0,
                repeat=True,
                repeat_mode="custom_count",
                custom_frame_count=8,
            )
        self.assertEqual(frame_count, 0)
        self.assertEqual(tuple(result.shape), (0, 1, 1, 4))

    def test_blur_radius_zero_and_sigma_zero_returns_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsBlur().apply(image=image, radius=0, sigma=0.0)
        self.assertTrue(torch.allclose(result, image))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))

    def test_blur_radius_zero_with_default_sigma_returns_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsBlur().apply(image=image, radius=0)
        self.assertTrue(torch.allclose(result, image))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))

    def test_blur_effective_radius_stays_tied_to_radius(self):
        self.assertEqual(_gaussian_effective_radius(0, 1.5), 0)
        self.assertEqual(_gaussian_effective_radius(1, 1.5), 1)
        self.assertEqual(_gaussian_effective_radius(4, 0.1), 4)

    def test_blur_radius_zero_overrides_sigma_and_returns_input(self):
        image = torch.zeros((1, 5, 5, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 2, 2, :3] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsBlur().apply(image=image, radius=0, sigma=1.5)
        self.assertTrue(torch.allclose(result, image))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))

    def test_blur_box_blurs_image(self):
        image = torch.zeros((1, 9, 9, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 4, 4, :3] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _ = ImageOpsBlur().apply(image=image, blur_type="box", radius=2)
        self.assertFalse(torch.allclose(result, image))
        # Box blur must spread the centre pixel to its neighbours.
        self.assertGreater(result[0, 4, 5, 0].item(), 0.0)

    def test_blur_defocus_blurs_image(self):
        image = torch.zeros((1, 11, 11, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 5, 5, :3] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _ = ImageOpsBlur().apply(image=image, blur_type="defocus", radius=2)
        self.assertFalse(torch.allclose(result, image))
        # Defocus disk should spread energy in a roughly circular pattern.
        self.assertGreater(result[0, 5, 6, 0].item(), 0.0)
        self.assertGreater(result[0, 6, 5, 0].item(), 0.0)

    def test_blur_surface_blurs_uniform_area(self):
        """Surface blur must blend in uniform regions (no edges to preserve there)."""
        image = torch.zeros((1, 9, 9, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 4, 4, :3] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _ = ImageOpsBlur().apply(image=image, blur_type="surface", radius=2, sigma=0.5)
        self.assertFalse(torch.allclose(result, image))

    def test_blur_all_types_radius_zero_is_noop(self):
        image = torch.rand((1, 5, 5, 4), dtype=torch.float32)
        for bt in ["gaussian", "box", "defocus", "surface"]:
            with self.subTest(blur_type=bt):
                with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
                    result, _ = ImageOpsBlur().apply(image=image, blur_type=bt, radius=0)
                self.assertTrue(torch.allclose(result, image), f"{bt} radius=0 should be noop")

    def test_dispatch_blur_box_spreads_pixel(self):
        image = torch.zeros((1, 5, 5, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 2, 2, :3] = 1.0
        result = _dispatch_blur(image, 1, 0.0, "box")
        self.assertGreater(result[0, 2, 3, 0].item(), 0.0)

    def test_dispatch_blur_defocus_disk_shape(self):
        image = torch.zeros((1, 7, 7, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 3, 3, :3] = 1.0
        result = _dispatch_blur(image, 1, 0.0, "defocus")
        # Disk kernel covers all 8-connected neighbours.
        self.assertGreater(result[0, 3, 3, 0].item(), 0.0)
        self.assertGreater(result[0, 2, 2, 0].item(), 0.0)

    def test_dispatch_blur_tiled_produces_exact_match(self):
        from nodes._helpers import _apply_blur_tiled
        image = torch.rand((1, 128, 128, 4), dtype=torch.float32)
        # Apply standard blur
        standard_blur = _dispatch_blur(image, 5, 1.5, "gaussian", tiling_enabled=False)
        # Apply tiled blur with tile_size=32
        tiled_blur = _apply_blur_tiled(image, 5, 1.5, "gaussian", tile_size=32)
        # Verify they are mathematically identical
        self.assertTrue(torch.allclose(standard_blur, tiled_blur, atol=1e-5))

    def test_transform_identity_returns_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.transform.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsTransform().apply(
                image=image,
                translate_x=0,
                translate_y=0,
                rotate_deg=0.0,
                scale=1.0,
                expand=False,
            )
        self.assertTrue(torch.allclose(result, image))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))

    def test_transform_color_fill_mode_fills_scaled_hole(self):
        image = torch.ones((1, 6, 6, 4), dtype=torch.float32)
        with patch("nodes.transform.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsTransform().apply(
                image=image,
                scale=0.5,
                fill_mode="color",
                fill_color="#ff0000",
            )
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.tensor([1.0, 0.0, 0.0]), atol=5e-2))
        self.assertGreater(output_mask[0, 0, 0].item(), 0.95)

    def test_transform_horizontal_flip_mirrors_pixels(self):
        image = torch.tensor(
            [[
                [[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
            ]],
            dtype=torch.float32,
        )
        with patch("nodes.transform.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsTransform().apply(
                image=image,
                flip="horizontal",
            )
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.tensor([0.0, 0.0, 1.0]), atol=1e-5))
        self.assertTrue(torch.allclose(result[0, 0, 1, :3], torch.tensor([1.0, 0.0, 0.0]), atol=1e-5))
        self.assertTrue(torch.allclose(output_mask, torch.ones_like(output_mask), atol=1e-5))

    def test_corner_pin_color_fill_mode_fills_uncovered_area(self):
        image = torch.ones((1, 6, 6, 4), dtype=torch.float32)
        with patch("nodes.corner_pin.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsCornerPin().apply(
                image=image,
                tl_x=0.25,
                tl_y=0.25,
                tr_x=0.85,
                tr_y=0.15,
                bl_x=0.2,
                bl_y=0.8,
                br_x=0.8,
                br_y=0.85,
                fill_mode="color",
                fill_color="#00ff00",
            )
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.tensor([0.0, 1.0, 0.0]), atol=5e-2))
        self.assertGreater(output_mask[0, 0, 0].item(), 0.95)

    def test_merge_mix_zero_returns_a(self):
        image_a = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        image_b = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.merge.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsMerge().apply(A=image_a, B=image_b, mix=0.0)
        self.assertTrue(torch.allclose(result, image_a))
        self.assertTrue(torch.allclose(output_mask, image_a[..., 3]))

    def test_crop_identity_returns_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.crop.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask, width, height, crop_mask = ImageOpsCrop().apply(
                image=image,
                aspect_ratio="1:1",
                width=4,
                height=4,
                crop_center_x=0.5,
                crop_center_y=0.5,
                crop_scale=1.0,
            )
        self.assertTrue(torch.allclose(result, image))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))
        self.assertTrue(torch.allclose(crop_mask, torch.ones_like(output_mask)))
        self.assertEqual(width, 4)
        self.assertEqual(height, 4)

    def test_blur_list_radius_does_not_fast_path_on_nonzero_frame(self):
        image = torch.rand((2, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _ = ImageOpsBlur().apply(image=image, radius=[0, 1], sigma=1.5)
        self.assertFalse(torch.allclose(result, image))

    def test_merge_list_mix_does_not_fast_path_on_nonzero_frame(self):
        image_a = torch.zeros((2, 2, 2, 4), dtype=torch.float32)
        image_b = torch.ones((2, 2, 2, 4), dtype=torch.float32)
        with patch("nodes.merge.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _ = ImageOpsMerge().apply(A=image_a, B=image_b, mix=[0.0, 1.0])
        self.assertTrue(torch.allclose(result[0], image_a[0]))
        self.assertFalse(torch.allclose(result[1], image_a[1]))

    def test_crop_list_params_do_not_false_fast_path(self):
        image = torch.rand((2, 4, 4, 4), dtype=torch.float32)
        with patch("nodes.crop.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, _, _, _, crop_mask = ImageOpsCrop().apply(
                image=image,
                aspect_ratio=["1:1", "1:1"],
                width=[4, 4],
                height=[4, 4],
                crop_center_x=[0.5, 0.5],
                crop_center_y=[0.5, 0.5],
                crop_scale=[1.0, 0.5],
            )
        self.assertFalse(torch.allclose(result, image))
        self.assertEqual(tuple(crop_mask.shape), (2, 4, 4))

    def test_crop_stitch_places_edited_crop_back_on_original(self):
        original = torch.zeros((1, 6, 10, 4), dtype=torch.float32)
        original[..., 3] = 1.0
        crop = torch.ones((1, 4, 4, 4), dtype=torch.float32)
        crop[..., 3] = 1.0
        crop_mask = torch.zeros((1, 6, 10), dtype=torch.float32)
        crop_mask[:, :, 2:8] = 1.0
        crop_bbox = '{"frames":[{"x":2,"y":0,"width":6,"height":6}]}'

        with patch("nodes.crop_stitch.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, stitch_mask = ImageOpsCropStitch().apply(
                original=original,
                crop=crop,
                crop_mask=crop_mask,
                crop_bbox=crop_bbox,
            )

        self.assertEqual(tuple(result.shape), tuple(original.shape))
        self.assertTrue(torch.allclose(result[0, :, 2:8, :3], torch.ones((6, 6, 3)), atol=1e-5))
        self.assertTrue(torch.allclose(result[0, :, :2, :3], torch.zeros((6, 2, 3)), atol=1e-5))
        self.assertTrue(torch.allclose(result[0, :, 8:, :3], torch.zeros((6, 2, 3)), atol=1e-5))
        self.assertTrue(torch.allclose(stitch_mask, crop_mask, atol=1e-5))


class _VideoStub:
    def __init__(self, images):
        self._images = images

    def get_components(self):
        return types.SimpleNamespace(images=self._images)


def _encode_overlay_rgba(width, height, pixels):
    image = Image.new("RGBA", (width, height))
    image.putdata(pixels)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


class ImageOpsInputContractTests(unittest.TestCase):
    def test_channel_accepts_video_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        video = _VideoStub(image)
        with patch("nodes.channel.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsChannel().apply(video=video, channel="Alpha")
        self.assertEqual(tuple(result.shape), (1, 4, 4, 4))
        self.assertTrue(torch.allclose(result[..., :3], torch.ones_like(result[..., :3]), atol=1e-5))
        self.assertTrue(torch.allclose(result[..., 3], image[..., 3], atol=1e-5))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))

    def test_crop_accepts_video_input(self):
        image = torch.rand((1, 4, 4, 4), dtype=torch.float32)
        video = _VideoStub(image)
        with patch("nodes.crop.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask, width, height, crop_mask = ImageOpsCrop().apply(
                video=video,
                aspect_ratio="1:1",
                width=4,
                height=4,
                crop_center_x=0.5,
                crop_center_y=0.5,
                crop_scale=1.0,
            )
        self.assertEqual(tuple(result.shape), (1, 4, 4, 4))
        self.assertTrue(torch.allclose(output_mask, image[..., 3]))
        self.assertTrue(torch.allclose(crop_mask, torch.ones_like(output_mask)))
        self.assertEqual(width, 4)
        self.assertEqual(height, 4)


class ImageOpsMaskAlphaBehaviorTests(unittest.TestCase):
    def test_blur_masked_composites_back_over_original(self):
        image = torch.full((1, 5, 5, 3), 0.2, dtype=torch.float32)
        image[:, 2, 2, :] = 1.0
        mask = torch.zeros((1, 5, 5), dtype=torch.float32)
        mask[:, 2, 2] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsBlur().apply(
                image=image,
                mask=mask,
                radius=1,
                sigma=1.0,
            )
        self.assertTrue(torch.allclose(result[0, 0, 0], image[0, 0, 0], atol=1e-5))
        self.assertAlmostEqual(output_mask[0, 0, 0].item(), 0.0, places=5)

    def test_blur_preserves_external_mask_output(self):
        image = torch.zeros((1, 5, 5, 3), dtype=torch.float32)
        image[:, 2, 2, :] = 1.0
        mask = torch.zeros((1, 5, 5), dtype=torch.float32)
        mask[:, 1:4, 1:4] = 1.0
        with patch("nodes.blur.build_node_preview_result", side_effect=_preview_result_passthrough):
            _, output_mask = ImageOpsBlur().apply(
                image=image,
                mask=mask,
                radius=2,
                sigma=1.0,
            )
        self.assertTrue(torch.allclose(output_mask, mask, atol=1e-5))

    def test_draw_returns_drawn_clean_and_mask(self):
        source = torch.tensor(
            [[[[0.0, 0.0, 1.0]]]],
            dtype=torch.float32,
        )
        overlay_data = _encode_overlay_rgba(1, 1, [(255, 0, 0, 255)])
        with patch("nodes.draw.build_node_preview_result", side_effect=_preview_result_passthrough):
            drawn, clean, mask = ImageOpsDraw().apply(
                image=source,
                overlay_data=overlay_data,
            )
        self.assertTrue(torch.allclose(clean, source, atol=1e-5))
        self.assertTrue(torch.allclose(drawn[0, 0, 0, :3], torch.tensor([1.0, 0.0, 0.0]), atol=1e-5))
        self.assertAlmostEqual(mask[0, 0, 0].item(), 1.0, places=5)

    def test_draw_bypass_keeps_drawn_and_clean_identical(self):
        source = torch.tensor(
            [[[[0.1, 0.2, 0.3]]]],
            dtype=torch.float32,
        )
        with patch("nodes.draw.build_node_preview_result", side_effect=_preview_result_passthrough):
            drawn, clean, mask = ImageOpsDraw().apply(
                image=source,
                bypass=True,
            )
        self.assertTrue(torch.allclose(drawn, source, atol=1e-5))
        self.assertTrue(torch.allclose(clean, source, atol=1e-5))
        self.assertTrue(torch.allclose(mask, torch.zeros_like(mask), atol=1e-5))

    def test_mask_convert_turns_mask_into_preview_image(self):
        mask = torch.tensor([[[0.25, 0.75]]], dtype=torch.float32)
        with patch("nodes.mask_convert.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsMaskConvert().apply(mask=mask, reverse=False)
        self.assertEqual(tuple(result.shape), (1, 1, 2, 4))
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.tensor([1.0, 1.0, 1.0]), atol=1e-5))
        self.assertTrue(torch.allclose(result[0, 0, 1, :3], torch.tensor([1.0, 1.0, 1.0]), atol=1e-5))
        self.assertAlmostEqual(result[0, 0, 0, 3].item(), 0.25, places=5)
        self.assertAlmostEqual(result[0, 0, 1, 3].item(), 0.75, places=5)
        self.assertTrue(torch.allclose(output_mask, mask, atol=1e-5))

    def test_mask_convert_reverse_prefers_useful_alpha(self):
        image = torch.tensor(
            [[
                [[0.1, 0.2, 0.3, 0.2], [0.9, 0.8, 0.7, 0.9]],
            ]],
            dtype=torch.float32,
        )
        expected = image[..., 3]
        with patch("nodes.mask_convert.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsMaskConvert().apply(image=image, reverse=True)
        self.assertTrue(torch.allclose(output_mask, expected, atol=1e-5))
        self.assertTrue(torch.allclose(result[..., :3], torch.ones_like(result[..., :3]), atol=1e-5))
        self.assertTrue(torch.allclose(result[..., 3], expected, atol=1e-5))

    def test_mask_convert_reverse_falls_back_to_luma(self):
        image = torch.tensor(
            [[
                [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            ]],
            dtype=torch.float32,
        )
        expected = torch.tensor([[[0.2126, 0.7152]]], dtype=torch.float32)
        with patch("nodes.mask_convert.build_node_preview_result", side_effect=_preview_result_passthrough):
            _, output_mask = ImageOpsMaskConvert().apply(image=image, reverse=True)
        self.assertTrue(torch.allclose(output_mask, expected, atol=1e-4))

    def test_color_adjust_respects_effect_mask(self):
        image = torch.tensor(
            [[
                [[0.2, 0.2, 0.2, 1.0], [0.2, 0.2, 0.2, 1.0]],
            ]],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[1.0, 0.0]]], dtype=torch.float32)
        with patch("nodes.color_ajust.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsColorAjust().apply(
                image=image,
                brightness=100.0,
                contrast=0.0,
                saturation=0.0,
                gamma=1.0,
                mask=mask,
            )
        self.assertGreater(result[0, 0, 0, 0].item(), image[0, 0, 0, 0].item())
        self.assertTrue(torch.allclose(result[0, 0, 1], image[0, 0, 1], atol=1e-5))
        self.assertTrue(torch.allclose(output_mask, mask, atol=1e-5))

    def test_merge_invert_mask_flips_external_mask(self):
        image_a = torch.zeros((1, 1, 1, 4), dtype=torch.float32)
        image_b = torch.ones((1, 1, 1, 4), dtype=torch.float32)
        mask = torch.ones((1, 1, 1), dtype=torch.float32)
        with patch("nodes.merge.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsMerge().apply(
                A=image_a,
                B=image_b,
                mask=mask,
                invert_mask=True,
            )
        self.assertTrue(torch.allclose(result, image_a, atol=1e-5))
        self.assertTrue(torch.allclose(output_mask, torch.zeros_like(output_mask), atol=1e-5))

    def test_apply_mask_to_image_blends_alpha_without_dark_fringe(self):
        original = torch.tensor(
            [[[[1.0, 0.0, 0.0, 0.0]]]],
            dtype=torch.float32,
        )
        processed = torch.tensor(
            [[[[1.0, 1.0, 1.0, 1.0]]]],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[0.5]]], dtype=torch.float32)
        result = _apply_mask_to_image(original, processed, mask)
        self.assertAlmostEqual(result[0, 0, 0, 3].item(), 0.5, places=5)
        self.assertTrue(torch.allclose(result[0, 0, 0, :3], torch.ones(3, dtype=torch.float32), atol=1e-5))

    def test_spherize_prepares_and_resizes_input_mask(self):
        image = torch.zeros((2, 4, 4, 3), dtype=torch.float32)
        mask = torch.ones((1, 2, 2), dtype=torch.float32)
        with patch("nodes.spherize.build_node_preview_result", side_effect=_preview_result_passthrough):
            result, output_mask = ImageOpsSpherize().apply(
                image=image,
                mask=mask,
                size_mode="custom",
                width=64,
                height=72,
            )
        self.assertEqual(tuple(result.shape), (2, 72, 64, 3))
        self.assertEqual(tuple(output_mask.shape), (2, 72, 64))
        self.assertTrue(torch.allclose(output_mask[0], output_mask[1], atol=1e-5))
        self.assertGreater(output_mask.max().item(), 0.9)
        self.assertLess(output_mask[0, 0, 0].item(), 0.1)
