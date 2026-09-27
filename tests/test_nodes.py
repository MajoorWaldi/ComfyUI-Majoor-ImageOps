from __future__ import annotations

import importlib.util
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path

import torch


ROOT = Path(__file__).resolve().parents[1]


def _install_comfy_stubs(temp_dir: str) -> None:
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_temp_directory = lambda: temp_dir
    folder_paths.get_input_directory = lambda: temp_dir
    folder_paths.get_output_directory = lambda: temp_dir
    sys.modules["folder_paths"] = folder_paths

    class _Routes:
        def get(self, _path):
            def decorator(fn):
                return fn

            return decorator

    class _PromptServer:
        instance = types.SimpleNamespace(routes=_Routes())

    server = types.ModuleType("server")
    server.PromptServer = _PromptServer
    server.web = types.SimpleNamespace(
        HTTPBadRequest=RuntimeError,
        HTTPForbidden=PermissionError,
        HTTPNotFound=FileNotFoundError,
        FileResponse=lambda **kwargs: kwargs,
        StreamResponse=object,
    )
    sys.modules["server"] = server

    comfy = types.ModuleType("comfy")
    comfy_utils = types.ModuleType("comfy.utils")

    class ProgressBar:
        def __init__(self, *args, **kwargs):
            pass

        def update_absolute(self, *args, **kwargs):
            pass

        def update(self, *args, **kwargs):
            pass

    comfy_utils.ProgressBar = ProgressBar
    comfy.utils = comfy_utils
    sys.modules["comfy"] = comfy
    sys.modules["comfy.utils"] = comfy_utils

    comfy_api = types.ModuleType("comfy_api")
    latest = types.ModuleType("comfy_api.latest")
    io = types.ModuleType("comfy_api.latest.io")

    class ComfyNode:
        pass

    class Schema:
        def __init__(self, *args, **kwargs):
            self.args = args
            self.kwargs = kwargs

        def get_v1_info(self, _cls):
            info = {"required": {}}
            for field in self.kwargs.get("inputs", []):
                kwargs = dict(field.get("kwargs", {}))
                optional = bool(field.get("optional", kwargs.pop("optional", False)))
                group = "optional" if optional else "required"
                info.setdefault(group, {})[field["args"][0]] = (field["io_type"], kwargs)
            return types.SimpleNamespace(input=info)

    class Hidden:
        unique_id = object()

    def _field_factory(io_type):
        class _FieldFactory:
            @staticmethod
            def Input(*args, **kwargs):
                return {"args": args, "kwargs": kwargs, "io_type": io_type}

            @staticmethod
            def Output(*args, **kwargs):
                return {"args": args, "kwargs": kwargs, "io_type": io_type}

        return _FieldFactory

    io.ComfyNode = ComfyNode
    io.Schema = Schema
    io.Hidden = Hidden
    for name, io_type in (
        ("Boolean", "BOOLEAN"),
        ("Int", "INT"),
        ("Color", "COLOR"),
        ("String", "STRING"),
        ("Image", "IMAGE"),
        ("Mask", "MASK"),
    ):
        setattr(io, name, _field_factory(io_type))
    io.Custom = lambda io_type: _field_factory(io_type)

    latest.io = io
    comfy_api.latest = latest
    sys.modules["comfy_api"] = comfy_api
    sys.modules["comfy_api.latest"] = latest
    sys.modules["comfy_api.latest.io"] = io


def _load_plugin_module():
    spec = importlib.util.spec_from_file_location("majoor_imageops_test_root", ROOT / "__init__.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to create import spec for plugin root")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _sample_image(batch: int = 2, height: int = 8, width: int = 8, channels: int = 4) -> torch.Tensor:
    y = torch.linspace(0.0, 1.0, steps=height, dtype=torch.float32).view(1, height, 1, 1)
    x = torch.linspace(0.0, 1.0, steps=width, dtype=torch.float32).view(1, 1, width, 1)
    rgb = torch.cat(
        [
            x.expand(batch, height, width, 1),
            y.expand(batch, height, width, 1),
            torch.full((batch, height, width, 1), 0.5, dtype=torch.float32),
        ],
        dim=-1,
    )
    if channels == 3:
        return rgb
    alpha = torch.full((batch, height, width, 1), 1.0, dtype=torch.float32)
    alpha[:, ::2, ::2, :] = 0.5
    return torch.cat([rgb, alpha], dim=-1)


def _sample_mask(batch: int = 2, height: int = 8, width: int = 8) -> torch.Tensor:
    mask = torch.zeros((batch, height, width), dtype=torch.float32)
    mask[:, 1:-1, 1:-1] = 1.0
    return mask


class TestAllNodes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.mkdtemp(prefix="majoor-imageops-tests-")
        _install_comfy_stubs(cls.temp_dir)
        cls.plugin = _load_plugin_module()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def setUp(self):
        self.image = _sample_image()
        self.image_b = torch.flip(self.image, dims=[2])
        self.mask = _sample_mask()

    def _node_kwargs(self, node_name: str):
        if node_name == "ImageOpsComp":
            return {
                "width": 8,
                "height": 8,
                "background_color": "#112233",
                "layers_json": '{"version":1,"layers":[{"slot":"image_1","enabled":true,"opacity":1.0,"mode":"over"}]}',
                "image_1": self.image,
                "mask_1": self.mask,
            }

        kwargs = {}

        if node_name in {
            "ImageOpsBlur",
            "ImageOpsCameraShake",
            "ImageOpsChannel",
            "ImageOpsClamp",
            "ImageOpsColorAjust",
            "ImageOpsCornerPin",
            "ImageOpsCrop",
            "ImageOpsDistort",
            "ImageOpsInvert",
            "ImageOpsFrameRange",
            "ImageOpsGrain",
            "ImageOpsKeyer",
            "ImageOpsMaskConvert",
            "ImageOpsPadOut",
            "ImageOpsPreview",
            "ImageOpsSpherize",
            "ImageOpsText",
            "ImageOpsTransform",
        }:
            kwargs["image"] = self.image

        if node_name in {"ImageOpsBlur", "ImageOpsCameraShake", "ImageOpsCrop", "ImageOpsDistort", "ImageOpsGrain", "ImageOpsInvert", "ImageOpsKeyer", "ImageOpsMaskConvert", "ImageOpsPreview", "ImageOpsSpherize", "ImageOpsText", "ImageOpsTransform"}:
            kwargs["mask"] = self.mask

        if node_name == "ImageOpsCropStitch":
            kwargs.update({"original": self.image, "crop": self.image[:, 1:7, 1:7, :], "crop_mask": self.mask})

        if node_name == "ImageOpsDraw":
            kwargs.update({"width": 8, "height": 8, "image": self.image})

        if node_name == "ImageOpsMerge":
            kwargs.update({"A": self.image, "B": self.image_b, "mask": self.mask})

        if node_name == "ImageOpsAppend":
            kwargs.update({"image_1": self.image, "image_2": self.image_b})

        if node_name == "ImageOpsFrameRange":
            kwargs["image"] = self.image

        if node_name == "ImageOpsNoise":
            kwargs.update(
                {
                    "width": 8,
                    "height": 8,
                    "batch_size": 2,
                    "frame_length": 2,
                    "compute_device": "cpu",
                }
            )

        if node_name == "ImageOpsConstant":
            kwargs.update({"width": 8, "height": 8, "frame_count": 2, "mode": "checkerboard", "tile_size": 2})

        if node_name == "ImageOpsRamp":
            kwargs.update({"width": 8, "height": 8, "frame_count": 2})

        if node_name == "ImageOpsGrain":
            kwargs.update({"amount": 0.1, "seed": 42})

        if node_name == "ImageOpsCameraShake":
            kwargs.update({"translate_px": 1.0, "rotate_deg": 0.0, "zoom": 0.0, "seed": 42})

        if node_name == "ImageOpsText":
            kwargs.update({"text": "T", "font_size": 10, "x": 0.25, "y": 0.25})

        if node_name == "ImageOpsCrop":
            kwargs.update({"width": 8, "height": 8})

        if node_name == "ImageOpsPadOut":
            kwargs.update({"pad_left": 1, "pad_top": 1, "pad_right": 1, "pad_bottom": 1})

        if node_name == "ImageOpsPreview":
            kwargs.update({"mode": "images", "preview_target": "image"})

        return kwargs

    def _call_node(self, node_name: str):
        cls = self.plugin.NODE_CLASS_MAPPINGS[node_name]
        kwargs = self._node_kwargs(node_name)
        if node_name == "ImageOpsComp":
            return cls.execute(**kwargs)

        node = cls()
        fn = getattr(node, cls.FUNCTION)
        return fn(**kwargs)

    def test_keyer_multi_color_selection_preserves_multiple_regions(self):
        keyer_cls = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsKeyer"]
        image = torch.zeros((1, 2, 2, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[0, 0, 0, :3] = torch.tensor([1.0, 0.0, 0.0])
        image[0, 0, 1, :3] = torch.tensor([0.0, 1.0, 0.0])
        image[0, 1, 0, :3] = torch.tensor([0.0, 0.0, 1.0])
        image[0, 1, 1, :3] = torch.tensor([1.0, 1.0, 0.0])

        result = keyer_cls().apply(
            image=image,
            key_color="#ff0000",
            key_colors='["#ff0000", "#00ff00"]',
            tolerance=0.05,
            softness=0.0,
        )
        output_image, output_mask = result[0], result[1]
        self.assertLess(float(output_mask[0, 0, 0]), 0.1)
        self.assertLess(float(output_mask[0, 0, 1]), 0.1)
        self.assertGreater(float(output_mask[0, 1, 0]), 0.9)
        self.assertGreater(float(output_mask[0, 1, 1]), 0.9)
        self.assertLess(float(output_image[0, 0, 0, 3]), 0.1)
        self.assertLess(float(output_image[0, 0, 1, 3]), 0.1)

    def _call_node_node20(self, node_name: str):
        cls = self.plugin.NODE_CLASS_MAPPINGS[node_name]
        return cls.execute(**self._node_kwargs(node_name))

    def _unwrap_result(self, result):
        if isinstance(result, dict):
            self.assertIn("result", result)
            self.assertIn("ui", result)
            return result["result"]
        return result

    def test_node_registry_exports_all_nodes(self):
        expected = {
            "ImageOpsBlur",
            "ImageOpsCameraShake",
            "ImageOpsChannel",
            "ImageOpsClamp",
            "ImageOpsColorAjust",
            "ImageOpsComp",
            "ImageOpsConstant",
            "ImageOpsCornerPin",
            "ImageOpsCrop",
            "ImageOpsCropStitch",
            "ImageOpsDistort",
            "ImageOpsDraw",
            "ImageOpsFrameRange",
            "ImageOpsGrain",
            "ImageOpsInvert",
            "ImageOpsAppend",
            "ImageOpsKeyer",
            "ImageOpsMaskConvert",
            "ImageOpsMerge",
            "ImageOpsNoise",
            "ImageOpsPadOut",
            "ImageOpsPreview",
            "ImageOpsRamp",
            "ImageOpsSpherize",
            "ImageOpsText",
            "ImageOpsTransform",
        }
        self.assertEqual(expected, set(self.plugin.NODE_CLASS_MAPPINGS))

    def test_every_node_smoke_executes(self):
        for node_name, cls in self.plugin.NODE_CLASS_MAPPINGS.items():
            with self.subTest(node=node_name):
                result = self._unwrap_result(self._call_node(node_name))
                self.assertIsInstance(result, tuple)
                if hasattr(cls, "RETURN_TYPES"):
                    expected_outputs = len(cls.RETURN_TYPES)
                else:
                    expected_outputs = len(cls.define_schema().kwargs["outputs"])
                self.assertEqual(len(result), expected_outputs)
                return_types = getattr(cls, "RETURN_TYPES", ())
                for i, value in enumerate(result):
                    rtype = return_types[i] if i < len(return_types) else None
                    if rtype == "INT":
                        self.assertIsInstance(value, int)
                    elif rtype == "FLOAT":
                        self.assertIsInstance(value, (int, float))
                    elif rtype == "STRING":
                        self.assertIsInstance(value, str)
                    else:
                        self.assertIsInstance(value, torch.Tensor)
                        self.assertGreaterEqual(value.numel(), 1)
                        self.assertTrue(torch.isfinite(value).all().item())

    def test_every_node_exposes_node20_entrypoints(self):
        for node_name, cls in self.plugin.NODE_CLASS_MAPPINGS.items():
            with self.subTest(node=node_name):
                self.assertTrue(callable(getattr(cls, "define_schema", None)))
                self.assertTrue(callable(getattr(cls, "execute", None)))
                schema = cls.define_schema()
                self.assertIsNotNone(schema)
                result = self._unwrap_result(self._call_node_node20(node_name))
                self.assertIsInstance(result, tuple)
                self.assertGreaterEqual(len(result), 1)

    def test_crop_exposes_sync_dimensions_toggle(self):
        crop_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsCrop"].INPUT_TYPES()
        self.assertIn("sync_dimensions", crop_inputs["required"])

    def test_crop_returns_final_width_and_height(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsCrop"]()
        image = torch.rand((2, 6, 10, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        mask = torch.ones((2, 6, 10), dtype=torch.float32)

        result, output_mask, width, height, crop_mask = self._unwrap_result(
            node.apply(image=image, mask=mask, width=8, height=5, aspect_ratio="custom")
        )

        self.assertEqual(tuple(result.shape), (2, 5, 8, 4))
        self.assertEqual(tuple(output_mask.shape), (2, 5, 8))
        self.assertEqual(tuple(crop_mask.shape), (2, 6, 10))
        self.assertTrue(torch.allclose(crop_mask, torch.ones_like(crop_mask)))
        self.assertEqual((width, height), (8, 5))

    def test_crop_returns_source_space_crop_mask(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsCrop"]()
        image = torch.rand((1, 6, 10, 4), dtype=torch.float32)
        image[..., 3] = 1.0

        _, _, _, _, crop_mask = self._unwrap_result(
            node.apply(
                image=image,
                width=4,
                height=4,
                aspect_ratio="1:1",
                crop_center_x=0.5,
                crop_center_y=0.5,
                crop_scale=1.0,
            )
        )

        expected = torch.zeros((1, 6, 10), dtype=torch.float32)
        expected[:, :, 2:8] = 1.0
        self.assertTrue(torch.allclose(crop_mask, expected))

    def test_crop_does_not_expose_mask_socket(self):
        crop_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsCrop"].INPUT_TYPES()
        self.assertNotIn("mask", crop_inputs["optional"])

    def test_constant_and_ramp_expose_frame_count(self):
        for node_name in ("ImageOpsConstant", "ImageOpsRamp"):
            cls = self.plugin.NODE_CLASS_MAPPINGS[node_name]
            inputs = cls.INPUT_TYPES()["required"]
            self.assertIn("frame_count", inputs)
            self.assertNotIn("frame_length", inputs)
            self.assertEqual(cls.RETURN_NAMES[-1], "frame_count")

    def test_constant_generates_solid_and_checkerboard(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsConstant"]()
        solid, solid_mask, solid_width, solid_height, solid_frame_count = self._unwrap_result(
            node.generate(width=3, height=2, frame_count=4, color="#ff0000", alpha=0.5)
        )
        self.assertEqual(tuple(solid.shape), (4, 2, 3, 4))
        self.assertEqual(tuple(solid_mask.shape), (4, 2, 3))
        self.assertEqual((solid_width, solid_height), (3, 2))
        self.assertEqual(solid_frame_count, 4)
        self.assertTrue(torch.allclose(solid[..., 0], torch.ones_like(solid[..., 0])))
        self.assertTrue(torch.allclose(solid[..., 1], torch.zeros_like(solid[..., 1])))
        self.assertTrue(torch.allclose(solid_mask, torch.full_like(solid_mask, 0.5)))

        checker, _, checker_width, checker_height, checker_frame_count = self._unwrap_result(
            node.generate(mode="checkerboard", width=2, height=2, color="#000000", color_b="#ffffff", tile_size=1)
        )
        self.assertEqual((checker_width, checker_height), (2, 2))
        self.assertEqual(checker_frame_count, 1)
        self.assertTrue(torch.allclose(checker[0, 0, 0, :3], torch.zeros(3)))
        self.assertTrue(torch.allclose(checker[0, 0, 1, :3], torch.ones(3)))
        self.assertTrue(torch.allclose(checker[0, 1, 0, :3], torch.ones(3)))
        self.assertTrue(torch.allclose(checker[0, 1, 1, :3], torch.zeros(3)))

    def test_ramp_generates_gradient_between_edges(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsRamp"]()
        ramp, mask, ramp_width, ramp_height, ramp_frame_count = self._unwrap_result(
            node.generate(width=3, height=1, frame_count=3, color_a="#000000", color_b="#ffffff", start_x=0.0, start_y=0.0, end_x=1.0, end_y=0.0)
        )
        self.assertEqual(tuple(ramp.shape), (3, 1, 3, 4))
        self.assertEqual(tuple(mask.shape), (3, 1, 3))
        self.assertEqual((ramp_width, ramp_height), (3, 1))
        self.assertEqual(ramp_frame_count, 3)
        self.assertTrue(torch.allclose(ramp[0, 0, 0, :3], torch.zeros(3)))
        self.assertTrue(torch.allclose(ramp[0, 0, 1, :3], torch.full((3,), 0.5), atol=1e-6))
        self.assertTrue(torch.allclose(ramp[0, 0, 2, :3], torch.ones(3)))
        self.assertTrue(torch.allclose(mask, torch.ones_like(mask)))

        inverted, _, inverted_width, inverted_height, inverted_frame_count = self._unwrap_result(
            node.generate(width=2, height=1, color_a="#000000", color_b="#ffffff", invert=True)
        )
        self.assertEqual((inverted_width, inverted_height), (2, 1))
        self.assertEqual(inverted_frame_count, 1)
        self.assertTrue(torch.allclose(inverted[0, 0, 0, :3], torch.ones(3)))
        self.assertTrue(torch.allclose(inverted[0, 0, 1, :3], torch.zeros(3)))

        radial, _, radial_width, radial_height, radial_frame_count = self._unwrap_result(
            node.generate(
                width=3,
                height=3,
                color_a="#000000",
                color_b="#ffffff",
                start_x=0.5,
                start_y=0.5,
                end_x=1.0,
                end_y=0.5,
                ramp_shape="radial",
            )
        )
        self.assertEqual((radial_width, radial_height), (3, 3))
        self.assertEqual(radial_frame_count, 1)
        self.assertTrue(torch.allclose(radial[0, 1, 1, :3], torch.zeros(3), atol=1e-6))
        self.assertTrue(torch.allclose(radial[0, 1, 2, :3], torch.ones(3), atol=1e-6))

    def test_grain_adds_deterministic_synthetic_noise(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsGrain"]()
        image = torch.full((2, 4, 4, 4), 0.5, dtype=torch.float32)
        image[..., 3] = 1.0
        result_a, mask_a = self._unwrap_result(
            node.apply(image=image, amount=0.25, seed=7, monochrome=True, animated=False)
        )
        result_b, _ = self._unwrap_result(
            node.apply(image=image, amount=0.25, seed=7, monochrome=True, animated=False)
        )
        self.assertTrue(torch.allclose(result_a, result_b))
        self.assertFalse(torch.allclose(result_a[..., :3], image[..., :3]))
        self.assertTrue(torch.allclose(result_a[0, ..., :3], result_a[1, ..., :3]))
        self.assertTrue(torch.allclose(result_a[..., 3], image[..., 3]))
        self.assertTrue(torch.allclose(mask_a, torch.ones_like(mask_a)))

        animated, _ = self._unwrap_result(
            node.apply(image=image, amount=0.25, seed=7, monochrome=True, animated=True)
        )
        self.assertFalse(torch.allclose(animated[0, ..., :3], animated[1, ..., :3]))

    def test_text_adds_overlay_without_changing_alpha(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsText"]()
        image = torch.zeros((1, 64, 64, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        result, output_mask = self._unwrap_result(
            node.apply(image=image, text="Hi", x=0.1, y=0.1, font_size=20, color="#ffffff", opacity=1.0)
        )
        self.assertEqual(tuple(result.shape), tuple(image.shape))
        self.assertGreater(float(result[..., :3].sum()), 0.0)
        self.assertTrue(torch.allclose(result[..., 3], image[..., 3]))
        self.assertTrue(torch.allclose(output_mask, torch.ones_like(output_mask)))

    def test_camera_shake_is_deterministic_and_changes_sequence(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsCameraShake"]()
        image = torch.zeros((3, 8, 8, 4), dtype=torch.float32)
        image[..., 3] = 1.0
        image[:, 2:6, 2:6, 0] = 1.0
        result_a, mask_a = self._unwrap_result(
            node.apply(image=image, translate_px=2.0, rotate_deg=0.0, zoom=0.0, smoothing=0.0, seed=9, frame_length=3, fill_mode="transparent")
        )
        result_b, _ = self._unwrap_result(
            node.apply(image=image, translate_px=2.0, rotate_deg=0.0, zoom=0.0, smoothing=0.0, seed=9, frame_length=3, fill_mode="transparent")
        )
        self.assertTrue(torch.allclose(result_a, result_b))
        self.assertFalse(torch.allclose(result_a, image))
        self.assertEqual(tuple(mask_a.shape), (3, 8, 8))

    def test_media_inputs_keep_video_socket_type(self):
        blur_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsBlur"].INPUT_TYPES()
        self.assertEqual(blur_inputs["optional"]["image"][0], "IMAGE,VIDEO")

        merge_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsMerge"].INPUT_TYPES()
        self.assertEqual(merge_inputs["required"]["A"][0], "IMAGE,VIDEO")
        self.assertEqual(merge_inputs["required"]["B"][0], "IMAGE,VIDEO")

        selector_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsFrameRange"].INPUT_TYPES()
        self.assertEqual(selector_inputs["required"]["image"][0], "IMAGE,VIDEO")

    def test_keyer_exposes_current_schema(self):
        keyer_inputs = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsKeyer"].INPUT_TYPES()
        self.assertEqual(
            {"bypass", "mode", "key_color", "key_colors", "tolerance", "softness", "gain", "blur", "invert", "invert_mask"},
            set(keyer_inputs["required"]),
        )
        self.assertEqual({"image", "mask"}, set(keyer_inputs["optional"]))

    def test_keyer_applies_color_key_and_invert(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsKeyer"]()
        image = torch.tensor(
            [[
                [[0.0, 1.0, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0]],
            ]],
            dtype=torch.float32,
        )
        mask = torch.tensor([[[1.0, 0.0]]], dtype=torch.float32)

        result, matte = self._unwrap_result(
            node.apply(image=image, key_color="#00ff00", tolerance=0.01, softness=0.0, mask=mask)
        )
        self.assertEqual(tuple(result.shape), (1, 1, 2, 4))
        self.assertEqual(tuple(matte.shape), (1, 1, 2))
        self.assertAlmostEqual(float(matte[0, 0, 0]), 0.0, places=6)
        self.assertAlmostEqual(float(matte[0, 0, 1]), 0.0, places=6)
        self.assertAlmostEqual(float(result[0, 0, 0, 3]), 0.0, places=6)
        self.assertAlmostEqual(float(result[0, 0, 1, 3]), 0.0, places=6)

        unmasked_result, unmasked_matte = self._unwrap_result(
            node.apply(image=image, key_color="#00ff00", tolerance=0.01, softness=0.0)
        )
        self.assertAlmostEqual(float(unmasked_matte[0, 0, 0]), 0.0, places=6)
        self.assertAlmostEqual(float(unmasked_matte[0, 0, 1]), 1.0, places=6)
        self.assertAlmostEqual(float(unmasked_result[0, 0, 0, 3]), 0.0, places=6)
        self.assertAlmostEqual(float(unmasked_result[0, 0, 1, 3]), 1.0, places=6)

        inv_result, inv_matte = self._unwrap_result(
            node.apply(image=image, key_color="#00ff00", tolerance=0.01, softness=0.0, invert=True)
        )
        self.assertAlmostEqual(float(inv_matte[0, 0, 0]), 1.0, places=6)
        self.assertAlmostEqual(float(inv_matte[0, 0, 1]), 0.0, places=6)
        self.assertAlmostEqual(float(inv_result[0, 0, 0, 3]), 1.0, places=6)
        self.assertAlmostEqual(float(inv_result[0, 0, 1, 3]), 0.0, places=6)

    def test_keyer_gain_and_blur_boost_and_feather_matte(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsKeyer"]()
        image = torch.tensor(
            [[
                [[0.0, 0.8, 0.0, 1.0], [0.0, 0.65, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0]],
            ]],
            dtype=torch.float32,
        )

        _, matte_base = self._unwrap_result(
            node.apply(image=image, key_color="#00ff00", tolerance=0.10, softness=0.20, gain=1.0, blur=0.0)
        )
        _, matte_gain = self._unwrap_result(
            node.apply(image=image, key_color="#00ff00", tolerance=0.10, softness=0.20, gain=2.0, blur=0.0)
        )

        blur_image = torch.tensor(
            [[
                [[0.0, 1.0, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0], [1.0, 0.0, 0.0, 1.0]],
            ]],
            dtype=torch.float32,
        )
        _, matte_blur = self._unwrap_result(
            node.apply(image=blur_image, key_color="#00ff00", tolerance=0.01, softness=0.0, gain=1.0, blur=2.0)
        )

        self.assertGreater(float(matte_gain[0, 0, 1]), float(matte_base[0, 0, 1]))
        self.assertGreater(float(matte_blur[0, 0, 1]), 0.0)
        self.assertLess(float(matte_blur[0, 0, 1]), 1.0)

    def test_frame_selector_timeline_controls(self):
        frames = torch.arange(5, dtype=torch.float32).view(5, 1, 1, 1).expand(5, 2, 2, 3)
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsFrameRange"]()

        trimmed, count = self._unwrap_result(node.apply(frames, trim_start=1, trim_end=3))
        self.assertEqual(count, 3)
        self.assertEqual(trimmed[:, 0, 0, 0].tolist(), [1.0, 2.0, 3.0])

        reversed_trim, count = self._unwrap_result(node.apply(frames, trim_start=3, trim_end=1))
        self.assertEqual(count, 3)
        self.assertEqual(reversed_trim[:, 0, 0, 0].tolist(), [1.0, 2.0, 3.0])

        hold, count = self._unwrap_result(node.apply(frames, trim_start=1, trim_end=3, frame_hold=True, hold_frame=4))
        self.assertEqual(count, 1)
        self.assertEqual(hold[:, 0, 0, 0].tolist(), [3.0])

        repeated_loop, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, repeat=True, repeat_mode="loop", custom_frame_count=7)
        )
        self.assertEqual(count, 7)
        self.assertEqual(repeated_loop[:, 0, 0, 0].tolist(), [1.0, 2.0, 3.0, 1.0, 2.0, 3.0, 1.0])

        repeated_bounce, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, repeat=True, repeat_mode="bounce", custom_frame_count=7)
        )
        self.assertEqual(count, 7)
        self.assertEqual(repeated_bounce[:, 0, 0, 0].tolist(), [1.0, 2.0, 3.0, 2.0, 1.0, 2.0, 3.0])

        repeated_reverse, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, frame_hold=True, hold_frame=4, repeat=True, repeat_mode="reverse", custom_frame_count=5)
        )
        self.assertEqual(count, 5)
        self.assertEqual(repeated_reverse[:, 0, 0, 0].tolist(), [3.0, 2.0, 1.0, 3.0, 2.0])

        repeated_input_duration, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, repeat=True, repeat_mode="input_duration", custom_frame_count=2)
        )
        self.assertEqual(count, 5)
        self.assertEqual(repeated_input_duration[:, 0, 0, 0].tolist(), [1.0, 2.0, 3.0, 1.0, 2.0])

        repeated_custom_hold, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, frame_hold=True, hold_frame=2, repeat=True, repeat_mode="custom_count", custom_frame_count=4)
        )
        self.assertEqual(count, 4)
        self.assertEqual(repeated_custom_hold[:, 0, 0, 0].tolist(), [2.0, 2.0, 2.0, 2.0])

        repeated_freeze, count = self._unwrap_result(
            node.apply(frames, trim_start=1, trim_end=3, hold_frame=3, repeat=True, repeat_mode="freeze", custom_frame_count=3)
        )
        self.assertEqual(count, 3)
        self.assertEqual(repeated_freeze[:, 0, 0, 0].tolist(), [3.0, 3.0, 3.0])

    def test_append_emits_per_clip_counts_metadata(self):
        a = torch.zeros((5, 2, 2, 3), dtype=torch.float32)
        b = torch.zeros((4, 2, 2, 3), dtype=torch.float32)
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsAppend"]()
        result = node.apply(
            image_1=a,
            image_2=b,
            trims_json='{"version":1,"clips":[{"slot":"image_1","start":1,"end":3},{"slot":"image_2","start":0,"end":0}]}',
        )
        ui = result.get("ui", {})
        self.assertEqual(ui.get("imageops_append_frame_count"), [4])
        clip_counts = ui.get("imageops_append_clip_counts", [[]])[0]
        self.assertEqual(clip_counts[0]["source_count"], 5)
        self.assertEqual(clip_counts[0]["trimmed_count"], 3)
        self.assertEqual(clip_counts[1]["source_count"], 4)
        self.assertEqual(clip_counts[1]["trimmed_count"], 1)

    def test_preview_node_emits_temp_preview_ui(self):
        result = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsPreview"]().preview(
            image=self.image,
            preview_target="image",
            mode="images",
        )
        self.assertIsInstance(result, dict)
        self.assertIn("ui", result)
        self.assertIn("images", result["ui"])
        self.assertGreaterEqual(len(result["ui"]["images"]), 1)

    def test_join_concatenates_multiple_trimmed_clips(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsAppend"]()
        a = torch.zeros((3, 4, 4, 3), dtype=torch.float32)
        b = torch.ones((4, 4, 4, 3), dtype=torch.float32)
        c = torch.full((2, 4, 4, 3), 0.5, dtype=torch.float32)
        image, frame_count, width, height = self._unwrap_result(node.apply(
            image_1=a,
            image_2=b,
            image_3=c,
            trims_json='{"version":1,"clips":[{"slot":"image_1","start":1,"end":2},{"slot":"image_2","start":1,"end":2}]}',
        ))
        self.assertEqual(frame_count, 6)
        self.assertEqual((width, height), (4, 4))
        self.assertTrue(torch.allclose(image[:2], torch.zeros_like(image[:2])))
        self.assertTrue(torch.allclose(image[2:4], torch.ones_like(image[2:4])))
        self.assertTrue(torch.allclose(image[4:], torch.full_like(image[4:], 0.5)))

    def test_join_bypass_returns_first_trimmed_clip(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsAppend"]()
        a = torch.stack([
            torch.full((2, 2, 3), value, dtype=torch.float32)
            for value in (0.0, 0.25, 0.5, 0.75, 1.0)
        ], dim=0)
        b = torch.full((3, 2, 2, 3), 9.0, dtype=torch.float32)

        image, frame_count, width, height = self._unwrap_result(node.apply(
            bypass=True,
            image_1=a,
            image_2=b,
            trims_json='{"version":1,"clips":[{"slot":"image_1","start":1,"end":3},{"slot":"image_2","start":0,"end":0}]}',
        ))

        self.assertEqual(frame_count, 3)
        self.assertEqual((width, height), (2, 2))
        self.assertEqual(image[:, 0, 0, 0].tolist(), [0.25, 0.5, 0.75])

    def test_join_channel_coercion_mixed_inputs(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsAppend"]()
        # Grayscale (1-channel)
        a = torch.zeros((2, 4, 4, 1), dtype=torch.float32)
        # RGB (3-channel)
        b = torch.ones((2, 4, 4, 3), dtype=torch.float32)
        # RGBA (4-channel) with customized alpha
        c = torch.full((2, 4, 4, 4), 0.5, dtype=torch.float32)
        c[..., 3] = 0.5

        # Check coercion when the target max channel is 4 (RGBA)
        image, frame_count, width, height = self._unwrap_result(node.apply(
            image_1=a,
            image_2=b,
            image_3=c,
            fit_mode="strict",
        ))

        self.assertEqual(frame_count, 6)
        self.assertEqual(image.shape[3], 4)

        # Grayscale promoted to RGBA (values 0.0, alpha 1.0)
        self.assertTrue(torch.allclose(image[:2, ..., :3], torch.zeros((2, 4, 4, 3))))
        self.assertTrue(torch.allclose(image[:2, ..., 3], torch.ones((2, 4, 4))))

        # RGB promoted to RGBA (values 1.0, alpha 1.0)
        self.assertTrue(torch.allclose(image[2:4, ..., :3], torch.ones((2, 4, 4, 3))))
        self.assertTrue(torch.allclose(image[2:4, ..., 3], torch.ones((2, 4, 4))))

        # RGBA preserved (values 0.5, alpha 0.5)
        self.assertTrue(torch.allclose(image[4:, ..., :3], torch.full((2, 4, 4, 3), 0.5)))
        self.assertTrue(torch.allclose(image[4:, ..., 3], torch.full((2, 4, 4), 0.5)))

    def test_join_strict_mode_dimension_mismatch(self):
        node = self.plugin.NODE_CLASS_MAPPINGS["ImageOpsAppend"]()
        # image_a is 4x4
        a = torch.zeros((1, 4, 4, 3), dtype=torch.float32)
        # image_b is 8x8
        b = torch.ones((1, 8, 8, 3), dtype=torch.float32)

        with self.assertRaises(ValueError) as ctx:
            node.apply(
                image_1=a,
                image_2=b,
                fit_mode="strict",
            )

        self.assertIn("ImageOps Append requires matching dimensions in strict mode", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
