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
)
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
        "opacity": 1.0,
        "mode": "over",
        "enabled": True,
    }


def _normalize_layer(entry: dict[str, Any], slot: str, index: int) -> dict[str, Any]:
    default = _default_layer(slot, index)
    data = default | dict(entry or {})
    data["slot"] = slot
    data["center_x"] = float(data.get("center_x", default["center_x"]))
    data["center_y"] = float(data.get("center_y", default["center_y"]))
    data["scale"] = float(max(0.05, min(8.0, data.get("scale", default["scale"]))))
    data["opacity"] = float(max(0.0, min(1.0, data.get("opacity", default["opacity"]))))
    mode = str(data.get("mode", default["mode"]) or "over").strip().lower()
    data["mode"] = mode if mode in COMP_BLEND_MODES else "over"
    data["enabled"] = bool(data.get("enabled", True))
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


class ImageOpsComp(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsComp",
            display_name="ImageOps Comp",
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
        )

    @classmethod
    def execute(
        cls,
        bypass: bool = False,
        use_first_layer_size: bool = True,
        width: int = 1024,
        height: int = 1024,
        background_color: str = "#000000",
        layers_json: str = '{"version":1,"layers":[]}',
        invert_mask: bool = False,
        **inputs,
    ):
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
            out_w = max(1, int(width))
            out_h = max(1, int(height))
            blank = _make_comp_canvas(1, out_h, out_w, device="cpu", dtype=torch.float32, background_color=background_color)
            output_mask = blank[..., 3]
            if bool(invert_mask):
                output_mask = 1.0 - output_mask
            return build_node_preview_result(blank, (blank, output_mask), prefix="imageops_comp")

        tensors: list[tuple[dict[str, Any], Any, Any]] = []
        for layer, image_value, mask_value in connected_layers:
            image_tensor = _coerce_media_to_tensor(image_value, layer["slot"]).float().clamp(0.0, 1.0)
            tensors.append((layer, image_tensor, mask_value))

        if bool(use_first_layer_size):
            ref_tensor = tensors[0][1]
            out_h = int(ref_tensor.shape[1])
            out_w = int(ref_tensor.shape[2])
        else:
            out_w = max(1, int(width))
            out_h = max(1, int(height))

        batch = max(int(image.shape[0]) for _, image, _ in tensors)
        device = tensors[0][1].device
        dtype = tensors[0][1].dtype

        if bool(bypass):
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
            if bool(invert_mask):
                output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
            return build_node_preview_result(result, (result, output_mask), prefix="imageops_comp")

        canvas = _make_comp_canvas(batch, out_h, out_w, device=device, dtype=dtype, background_color=background_color)
        for layer, image_tensor, mask_value in tensors:
            if not bool(layer.get("enabled", True)):
                continue
            canvas = _composite_comp_layer(
                canvas,
                image_tensor.to(device=device, dtype=dtype),
                mask_value,
                mode=layer.get("mode", "over"),
                opacity=layer.get("opacity", 1.0),
                center_x=layer.get("center_x", 0.5),
                center_y=layer.get("center_y", 0.5),
                scale=layer.get("scale", 1.0),
            )

        output_mask = canvas[..., 3].clamp(0.0, 1.0)
        if bool(invert_mask):
            output_mask = (1.0 - output_mask).clamp(0.0, 1.0)
        return build_node_preview_result(canvas, (canvas, output_mask), prefix="imageops_comp")
