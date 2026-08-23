from __future__ import annotations

import base64
import binascii
import io
import json

import numpy as np
import torch
from PIL import Image

from ._helpers import MEDIA_INPUT_TYPE, _hex_to_rgb01, _scalar, _select_media_tensor
from comfy_api.latest import io
from ._progress import start_progress
from ._preview import build_node_preview_result


def _blank_draw_base(width: int, height: int, bg_color: str) -> torch.Tensor:
    target_w = max(1, _scalar(width, int))
    target_h = max(1, _scalar(height, int))
    r, g, b = _hex_to_rgb01(bg_color)
    base = torch.zeros((1, target_h, target_w, 3), dtype=torch.float32)
    base[..., 0] = r
    base[..., 1] = g
    base[..., 2] = b
    return base


def _decode_payload_rgba(
    overlay_data: str | None,
    width: int,
    height: int,
    device,
    dtype,
) -> torch.Tensor:
    target_w = max(1, _scalar(width, int))
    target_h = max(1, _scalar(height, int))
    blank = torch.zeros((1, target_h, target_w, 4), device=device, dtype=dtype)

    raw = str(overlay_data or "").strip()
    if not raw:
        return blank

    bounds = None
    source_w = target_w
    source_h = target_h
    if raw.startswith("{"):
        try:
            payload = json.loads(raw)
            if not isinstance(payload, dict):
                return blank
            raw = str(payload.get("data") or payload.get("overlay_data") or "").strip()
            source_w = max(1, _scalar(payload.get("width", target_w), int))
            source_h = max(1, _scalar(payload.get("height", target_h), int))
            raw_bounds = payload.get("bounds")
            if isinstance(raw_bounds, dict):
                bounds = (
                    _scalar(raw_bounds.get("x", 0), int),
                    _scalar(raw_bounds.get("y", 0), int),
                    max(1, _scalar(raw_bounds.get("width", target_w), int)),
                    max(1, _scalar(raw_bounds.get("height", target_h), int)),
                )
            elif isinstance(raw_bounds, (list, tuple)) and len(raw_bounds) >= 4:
                bounds = (
                    _scalar(raw_bounds[0], int),
                    _scalar(raw_bounds[1], int),
                    max(1, _scalar(raw_bounds[2], int)),
                    max(1, _scalar(raw_bounds[3], int)),
                )
        except (json.JSONDecodeError, ValueError, TypeError, KeyError):
            return blank

    if raw.startswith("data:"):
        _, _, raw = raw.partition(",")
    if not raw:
        return blank

    try:
        decoded = base64.b64decode(raw)
        with Image.open(io.BytesIO(decoded)) as painter:
            overlay = painter.convert("RGBA")
            if bounds is not None:
                x, y, w, h = bounds
                scaled_x = int(round(x * target_w / source_w))
                scaled_y = int(round(y * target_h / source_h))
                scaled_w = max(1, int(round(w * target_w / source_w)))
                scaled_h = max(1, int(round(h * target_h / source_h)))
                if overlay.size != (scaled_w, scaled_h):
                    overlay = overlay.resize((scaled_w, scaled_h), Image.LANCZOS)
                array = np.zeros((target_h, target_w, 4), dtype=np.float32)
                src = np.asarray(overlay).astype(np.float32) / 255.0
                dst_x0 = max(0, scaled_x)
                dst_y0 = max(0, scaled_y)
                dst_x1 = min(target_w, scaled_x + scaled_w)
                dst_y1 = min(target_h, scaled_y + scaled_h)
                if dst_x1 <= dst_x0 or dst_y1 <= dst_y0:
                    return blank
                src_x0 = dst_x0 - scaled_x
                src_y0 = dst_y0 - scaled_y
                src_x1 = src_x0 + (dst_x1 - dst_x0)
                src_y1 = src_y0 + (dst_y1 - dst_y0)
                array[dst_y0:dst_y1, dst_x0:dst_x1, :] = src[src_y0:src_y1, src_x0:src_x1, :]
            else:
                if overlay.size != (target_w, target_h):
                    overlay = overlay.resize((target_w, target_h), Image.LANCZOS)
                array = np.asarray(overlay).astype(np.float32) / 255.0
    except (binascii.Error, OSError, ValueError, TypeError):
        return blank

    tensor = torch.from_numpy(array).to(device=device, dtype=dtype).unsqueeze(0)
    return tensor


def _iter_overlay_layers(overlay_data: str | None, overlay_layers: str | None):
    raw_layers = str(overlay_layers or "").strip()
    parsed_layers = False
    emitted = False
    if raw_layers:
        try:
            payload = json.loads(raw_layers)
            entries = payload.get("layers", []) if isinstance(payload, dict) else payload
            if isinstance(entries, list):
                parsed_layers = True
                for entry in entries:
                    enabled = True
                    opacity = 1.0
                    data = entry
                    if isinstance(entry, dict):
                        enabled = bool(entry.get("enabled", True))
                        try:
                            opacity = float(entry.get("opacity", 1.0))
                        except Exception:
                            opacity = 1.0
                        data = entry.get("data") or entry.get("overlay_data") or entry.get("payload") or ""
                    if not enabled:
                        continue
                    raw = str(data or "").strip()
                    if not raw:
                        continue
                    emitted = True
                    yield raw, max(0.0, min(1.0, opacity))
        except Exception:
            emitted = False

    raw = str(overlay_data or "").strip()
    if raw and not emitted and not parsed_layers:
        yield raw, 1.0


def _decode_overlay_rgba(
    overlay_data: str | None,
    overlay_layers: str | None,
    width: int,
    height: int,
    batch: int,
    device,
    dtype,
) -> torch.Tensor:
    target_w = max(1, _scalar(width, int))
    target_h = max(1, _scalar(height, int))
    safe_batch = max(1, _scalar(batch, int))
    acc_rgb = torch.zeros((1, target_h, target_w, 3), device=device, dtype=dtype)
    acc_alpha = torch.zeros((1, target_h, target_w, 1), device=device, dtype=dtype)

    for payload, opacity in _iter_overlay_layers(overlay_data, overlay_layers):
        layer = _decode_payload_rgba(payload, target_w, target_h, device=device, dtype=dtype).clamp(0.0, 1.0)
        alpha = (layer[..., 3:4] * opacity).clamp(0.0, 1.0)
        acc_rgb = layer[..., :3] * alpha + acc_rgb * (1.0 - alpha)
        acc_alpha = alpha + acc_alpha * (1.0 - alpha)

    out_rgb = torch.where(acc_alpha > 1.0e-6, acc_rgb / acc_alpha.clamp_min(1.0e-6), torch.zeros_like(acc_rgb))
    overlay = torch.cat([out_rgb, acc_alpha], dim=-1).clamp(0.0, 1.0)
    return overlay.expand(safe_batch, -1, -1, -1)


def _composite_overlay(base: torch.Tensor, overlay_rgba: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    if base.dim() != 4:
        raise ValueError(f"Expected base image as [B,H,W,C], got {tuple(base.shape)}")
    if overlay_rgba.dim() != 4 or overlay_rgba.shape[-1] < 4:
        raise ValueError(f"Expected overlay image as [B,H,W,4], got {tuple(overlay_rgba.shape)}")

    base = base.float()
    overlay_rgba = overlay_rgba.float().clamp(0.0, 1.0)

    if base.shape[0] != overlay_rgba.shape[0]:
        from .core.batch import match_batch
        overlay_rgba, _ = match_batch(overlay_rgba, base, policy="loop")

    overlay_rgb = overlay_rgba[..., :3]
    overlay_alpha = overlay_rgba[..., 3:4]
    base_rgb = base[..., :3]
    out_rgb = overlay_rgb * overlay_alpha + base_rgb * (1.0 - overlay_alpha)

    if base.shape[-1] >= 4:
        base_alpha = base[..., 3:4].clamp(0.0, 1.0)
        out_alpha = overlay_alpha + base_alpha * (1.0 - overlay_alpha)
        result = torch.cat([out_rgb, out_alpha.clamp(0.0, 1.0)], dim=-1)
    else:
        result = out_rgb

    return result, overlay_alpha[..., 0].clamp(0.0, 1.0)


class ImageOpsDraw(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsDraw",
            display_name="〽️ ImageOps Paint",
            category="image/imageops",
            search_aliases=['paint', 'draw', 'brush', 'eraser', 'sketch', 'mask paint'], inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Int.Input("width", default=1024, min=64, max=4096, step=64),
                io.Int.Input("height", default=1024, min=64, max=4096, step=64),
                io.Boolean.Input("sync_dimensions", default=True, label_on="Linked", label_off="Free"),
                io.Color.Input("bg_color", default="#000000"),
                io.Combo.Input("tool", options=["brush", "eraser"], default="brush"),
                io.Combo.Input("brush_edge", options=["hard", "soft"], default="hard"),
                io.Float.Input("brush_softness", default=0.5, min=0.0, max=1.0, step=0.01, tooltip="How feathered the soft brush is. 0 = nearly hard, 1 = max falloff. Ignored when brush_edge=hard."),
                io.Color.Input("brush_color", default="#FFFFFF"),
                io.Float.Input("brush_opacity", default=1.0, min=0.0, max=1.0, step=0.01),
                io.Int.Input("brush_size", default=10, min=1, max=256, step=1),
                io.Boolean.Input("brush_pressure_size", default=True),
                io.Boolean.Input("brush_pressure_opacity", default=True),
                io.Boolean.Input("brush_tilt_size", default=False),
                io.Combo.Input("overlay_format", options=["png", "webp"], default="png"),
                io.String.Input("overlay_data", default="", multiline=False),
                io.String.Input("overlay_layers", default="", multiline=False),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], optional=True, display_name="Images/Video", tooltip="Images/Video input. Accepts IMAGE batches and VIDEO frame sources."),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Image.Output("source_image", display_name="source_image"),
                io.Mask.Output("mask", display_name="mask"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        bypass: bool = False,
        width: int = 1024,
        height: int = 1024,
        sync_dimensions: bool = True,
        bg_color: str = "#000000",
        tool: str = "brush",
        brush_edge: str = "hard",
        brush_softness: float = 0.5,
        brush_color: str = "#FFFFFF",
        brush_opacity: float = 1.0,
        brush_size: int = 10,
        brush_pressure_size: bool = True,
        brush_pressure_opacity: bool = True,
        brush_tilt_size: bool = False,
        overlay_format: str = "png",
        overlay_data: str = "",
        overlay_layers: str = "",
        invert_mask: bool = False,
        image=None,
        video=None,
        unique_id=None,
    ):
        # These widget values are owned by the frontend paint UI and serialized into
        # overlay_data / overlay_layers. Keep them in the signature for workflow
        # compatibility, but the backend compositor only needs the resolved overlay payload.
        progress = start_progress(unique_id=unique_id)

        source = None
        if image is not None or video is not None:
            source = _select_media_tensor(image, video).float()
        else:
            source = _blank_draw_base(width, height, bg_color)

        batch = int(source.shape[0])
        target_h = int(source.shape[1])
        target_w = int(source.shape[2])

        if _scalar(bypass, bool):
            mask = torch.zeros((batch, target_h, target_w), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
            progress.finish()
            return build_node_preview_result(source, (source, source, mask), prefix="imageops_draw")

        from .core.memory import check_budget
        # multiplier=2.0 covers source + overlay RGBA workspace
        check_budget(batch, target_h, target_w, 4, multiplier=2.0, label="ImageOps Draw")

        overlay = _decode_overlay_rgba(
            overlay_data,
            overlay_layers,
            target_w,
            target_h,
            batch=batch,
            device=source.device,
            dtype=source.dtype,
        )

        result, mask = _composite_overlay(source, overlay)
        if _scalar(invert_mask, bool):
            mask = 1.0 - mask
        progress.finish()
        return build_node_preview_result(result, (result, source, mask.clamp(0.0, 1.0)), prefix="imageops_draw")
