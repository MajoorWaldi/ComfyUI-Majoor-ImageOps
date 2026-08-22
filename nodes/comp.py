from __future__ import annotations

import json
from typing import Any

import torch
from comfy_api.latest import io

from ._helpers import (
    COMP_BLEND_MODES,
    _alpha_mask_from_image,
    _coerce_media_to_tensor,
    _composite_comp_layer,
    _expand_image_batch,
    _make_comp_canvas,
    _scalar,
)
from ._progress import start_progress
from ._preview import build_node_preview_result


def _sorted_layer_numbers(inputs: dict[str, Any]) -> list[int]:
    numbers = set()
    for key in inputs:
        if not isinstance(key, str):
            continue
        if key.startswith("image_") or key.startswith("mask_"):
            suffix = key.split("_", 1)[1]
            try:
                numbers.add(int(suffix))
            except ValueError:
                continue
    return sorted(numbers)


def _default_layer(slot: str, index: int) -> dict[str, Any]:
    offset = min(index, 4) * 0.04
    return {
        "slot": slot,
        "center_x": 0.5 + offset,
        "center_y": 0.5 + offset,
        "scale": 1.0 if index == 0 else 0.5,
        "rotate_deg": 0.0,
        "opacity": 1.0,
        "mode": "over",
        "enabled": True,
        "tl_x": None,
        "tl_y": None,
        "tr_x": None,
        "tr_y": None,
        "bl_x": None,
        "bl_y": None,
        "br_x": None,
        "br_y": None,
    }


def _normalize_layer(entry: dict[str, Any], slot: str, index: int) -> dict[str, Any]:
    default = _default_layer(slot, index)
    data = default | dict(entry or {})
    data["slot"] = slot
    data["center_x"] = _scalar(data.get("center_x", default["center_x"]))
    data["center_y"] = _scalar(data.get("center_y", default["center_y"]))
    data["scale"] = _scalar(max(0.05, min(8.0, _scalar(data.get("scale", default["scale"])))))
    data["rotate_deg"] = _scalar(
        data.get(
            "rotate_deg",
            data.get("rotation_deg", data.get("rotation", default["rotate_deg"])),
        )
    )
    data["opacity"] = _scalar(max(0.0, min(1.0, _scalar(data.get("opacity", default["opacity"])))))
    mode = str(data.get("mode", default["mode"]) or "over").strip().lower().replace("-", "_").replace(" ", "_")
    data["mode"] = mode if mode in COMP_BLEND_MODES else "over"
    data["enabled"] = bool(data.get("enabled", True))
    for key in ("tl_x", "tl_y", "tr_x", "tr_y", "bl_x", "bl_y", "br_x", "br_y"):
        value = data.get(key)
        data[key] = None if value in (None, "") else max(-2.0, min(3.0, _scalar(value)))
    return data


def _parse_layers_state(layers_json: str | dict | list | None, layer_numbers: list[int]) -> list[dict[str, Any]]:
    parsed: dict[str, Any] | list[Any]
    if isinstance(layers_json, (dict, list)):
        parsed = layers_json
    else:
        raw = str(layers_json or "").strip()
        if not raw:
            parsed = {}
        else:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = {}

    if isinstance(parsed, dict):
        source_layers = parsed.get("layers", [])
    elif isinstance(parsed, list):
        source_layers = parsed
    else:
        source_layers = []

    lookup: dict[str, dict[str, Any]] = {}
    for entry in source_layers:
        if not isinstance(entry, dict):
            continue
        slot = str(entry.get("slot") or "").strip()
        if slot:
            lookup[slot] = entry

    layers: list[dict[str, Any]] = []
    for index, number in enumerate(layer_numbers):
        slot = f"image_{number}"
        layers.append(_normalize_layer(lookup.get(slot, {}), slot, index))
    return layers


def _largest_connected_layer_size(tensors: list[tuple[dict[str, Any], torch.Tensor, Any]]) -> tuple[int, int]:
    out_h = max(int(image.shape[1]) for _, image, _ in tensors)
    out_w = max(int(image.shape[2]) for _, image, _ in tensors)
    return out_h, out_w


class ImageOpsComp(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsComp",
            display_name="〽️ ImageOps Comp",
            category="image/imageops",
            search_aliases=["comp", "composite", "compositor", "image comp", "image composite"],
            accept_all_inputs=True,
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Boolean.Input(
                    "use_first_layer_size",
                    default=True,
                    label_on="From First Layer",
                    label_off="Custom Format",
                    tooltip="Use the first connected layer as the comp format. Disable to force Width/Height.",
                ),
                io.Boolean.Input(
                    "auto_layering",
                    default=False,
                    label_on="Largest Layer",
                    label_off="First/Custom",
                    tooltip="Use the largest connected layer dimensions as the canvas format.",
                ),
                io.Int.Input("width", default=1024, min=1, max=8192, step=1),
                io.Int.Input("height", default=1024, min=1, max=8192, step=1),
                io.Color.Input("background_color", default="#000000"),
                io.String.Input("layers_json", default='{"version":1,"layers":[]}', socketless=True),
                io.Boolean.Input("invert_mask", default=False),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Mask.Output("mask", display_name="mask"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        bypass: bool = False,
        use_first_layer_size: bool = True,
        auto_layering: bool = False,
        width: int = 1024,
        height: int = 1024,
        background_color: str = "#000000",
        layers_json: str = '{"version":1,"layers":[]}',
        invert_mask: bool = False,
        **inputs,
    ):
        progress_unique_id = getattr(getattr(cls, "hidden", None), "unique_id", None)
        layer_numbers = _sorted_layer_numbers(inputs)
        layers = _parse_layers_state(layers_json, layer_numbers)
        connected_layers: list[tuple[dict[str, Any], Any, Any]] = []

        for layer in layers:
            suffix = layer["slot"].split("_", 1)[1]
            image_value = inputs.get(layer["slot"])
            if image_value is None:
                continue
            mask_value = inputs.get(f"mask_{suffix}")
            connected_layers.append((layer, image_value, mask_value))

        if not connected_layers:
            progress = start_progress(unique_id=progress_unique_id)
            out_w = max(1, _scalar(width, int))
            out_h = max(1, _scalar(height, int))
            from .core.memory import check_budget
            check_budget(1, out_h, out_w, 4, multiplier=1.5, label="ImageOps Comp (empty)")
            blank = _make_comp_canvas(1, out_h, out_w, device="cpu", dtype=torch.float32, background_color=background_color)
            output_mask = blank[..., 3]
            if _scalar(invert_mask, bool):
                output_mask = 1.0 - output_mask
            progress.finish()
            return build_node_preview_result(blank, (blank, output_mask), prefix="imageops_comp")

        enabled_count = sum(1 for layer, _, _ in connected_layers if bool(layer.get("enabled", True)))
        progress = start_progress(total=max(1, len(connected_layers) + enabled_count), unique_id=progress_unique_id)
        tensors: list[tuple[dict[str, Any], Any, Any]] = []
        for layer, image_value, mask_value in connected_layers:
            image_tensor = _coerce_media_to_tensor(image_value, layer["slot"]).float().clamp(0.0, 1.0)
            tensors.append((layer, image_tensor, mask_value))
            progress.update()

        if _scalar(auto_layering, bool):
            out_h, out_w = _largest_connected_layer_size(tensors)
        elif _scalar(use_first_layer_size, bool):
            ref_tensor = tensors[0][1]
            out_h = int(ref_tensor.shape[1])
            out_w = int(ref_tensor.shape[2])
        else:
            out_w = max(1, _scalar(width, int))
            out_h = max(1, _scalar(height, int))

        batch = max(int(image.shape[0]) for _, image, _ in tensors)
        device = tensors[0][1].device
        dtype = tensors[0][1].dtype
        from .core.memory import check_budget
        # multiplier=2.0 covers canvas + per-layer accumulation during compositing
        check_budget(batch, out_h, out_w, 4, multiplier=2.0, label="ImageOps Comp")
        enabled_layers = [(layer, image_tensor, mask_value) for layer, image_tensor, mask_value in tensors if bool(layer.get("enabled", True))]

        if _scalar(bypass, bool):
            _, first_image, first_mask = tensors[0]
            result = _expand_image_batch(first_image, batch).to(device=device, dtype=dtype)
            output_mask = _alpha_mask_from_image(result)
            if first_mask is not None:
                from ._helpers import _prepare_mask_tensor

                prepared = _prepare_mask_tensor(
                    first_mask,
                    batch=batch,
                    height=result.shape[1],
                    width=result.shape[2],
                    device=result.device,
                    dtype=result.dtype,
                )
                if prepared is not None:
                    output_mask = prepared
            if _scalar(invert_mask, bool):
                output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_comp")

        canvas = _make_comp_canvas(batch, out_h, out_w, device=device, dtype=dtype, background_color=background_color)
        for layer, image_tensor, mask_value in enabled_layers:
            canvas = _composite_comp_layer(
                canvas,
                image_tensor,
                mask_value,
                mode=layer.get("mode", "over"),
                opacity=layer.get("opacity", 1.0),
                center_x=layer.get("center_x", 0.5),
                center_y=layer.get("center_y", 0.5),
                scale=layer.get("scale", 1.0),
                rotate_deg=layer.get("rotate_deg", 0.0),
                tl_x=layer.get("tl_x"),
                tl_y=layer.get("tl_y"),
                tr_x=layer.get("tr_x"),
                tr_y=layer.get("tr_y"),
                bl_x=layer.get("bl_x"),
                bl_y=layer.get("bl_y"),
                br_x=layer.get("br_x"),
                br_y=layer.get("br_y"),
            )
            progress.update()

        output_mask = canvas[..., 3].clamp(0.0, 1.0)
        if _scalar(invert_mask, bool):
            output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(canvas, (canvas, output_mask), prefix="imageops_comp")
