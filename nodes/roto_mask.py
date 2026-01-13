import json

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFilter

from ._helpers import _select_media_tensor


def _catmull_rom_to_bezier(p0, p1, p2, p3):
    c1 = (p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0)
    c2 = (p2[0] - (p3[0] - p1[0]) / 6.0, p2[1] - (p3[1] - p1[1]) / 6.0)
    return p1, c1, c2, p2


def _sample_cubic_bezier(b0, b1, b2, b3, steps):
    pts = []
    for i in range(steps + 1):
        t = i / float(steps)
        mt = 1.0 - t
        x = (
            (mt ** 3) * b0[0]
            + 3.0 * (mt ** 2) * t * b1[0]
            + 3.0 * mt * (t ** 2) * b2[0]
            + (t ** 3) * b3[0]
        )
        y = (
            (mt ** 3) * b0[1]
            + 3.0 * (mt ** 2) * t * b1[1]
            + 3.0 * mt * (t ** 2) * b2[1]
            + (t ** 3) * b3[1]
        )
        pts.append((x, y))
    return pts


def _safe_json_loads(s):
    if s is None:
        return {}
    if isinstance(s, (dict, list)):
        return s
    try:
        return json.loads(str(s))
    except Exception:
        return {}


class ImageOpsRotoMask:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("MASK",)
    FUNCTION = "render"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "roto_data": ("STRING", {"default": "{\"version\":1,\"mode\":\"paint\"}", "multiline": True, "tooltip": "Auto data for Roto Mask (edited by the canvas UI)"}),
                "invert": ("BOOLEAN", {"default": False}),
                "feather": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 256.0, "step": 0.5, "display": "slider", "round": 0.001}),
                "opacity": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "display": "slider", "round": 0.001}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
            }
        }

    def render(self, image, roto_data, invert, feather, opacity, video=None):
        source = _select_media_tensor(image, video)
        batch, height, width, _ = source.shape

        data = _safe_json_loads(roto_data)
        mode = str(data.get("mode") or "paint").lower()

        mask_img = Image.new("L", (width, height), 0)
        draw = ImageDraw.Draw(mask_img)

        if mode == "bezier":
            pts = data.get("points") or []
            pts = [(float(p.get("x", 0.0)), float(p.get("y", 0.0))) for p in pts if isinstance(p, dict)]
            if len(pts) >= 3:
                pts_px = [(p[0] * width, p[1] * height) for p in pts]
                n = len(pts_px)
                sampled = []
                steps = int(max(8, min(256, data.get("steps", 48))))
                for i in range(n):
                    p0 = pts_px[(i - 1) % n]
                    p1 = pts_px[i]
                    p2 = pts_px[(i + 1) % n]
                    p3 = pts_px[(i + 2) % n]
                    b0, b1, b2, b3 = _catmull_rom_to_bezier(p0, p1, p2, p3)
                    seg = _sample_cubic_bezier(b0, b1, b2, b3, steps=steps)
                    if i > 0:
                        seg = seg[1:]
                    sampled.extend(seg)
                if len(sampled) >= 3:
                    draw.polygon(sampled, fill=255)

        else:  # paint
            strokes = data.get("strokes") or []
            for s in strokes:
                if not isinstance(s, dict):
                    continue
                points = s.get("points") or []
                if len(points) < 2:
                    continue
                pts_px = [(float(p[0]) * width, float(p[1]) * height) for p in points if isinstance(p, (list, tuple)) and len(p) >= 2]
                if len(pts_px) < 2:
                    continue
                brush = float(s.get("brush") or 24.0)
                brush_px = max(1, int(round(brush)))
                erase = bool(s.get("erase", False))
                color = 0 if erase else 255
                draw.line(pts_px, fill=color, width=brush_px, joint="curve")
                # Ensure stroke endpoints are solid
                r = max(1, brush_px // 2)
                for x, y in (pts_px[0], pts_px[-1]):
                    draw.ellipse((x - r, y - r, x + r, y + r), fill=color)

        feather = float(feather)
        if feather > 0.0:
            mask_img = mask_img.filter(ImageFilter.GaussianBlur(radius=feather))

        arr = np.array(mask_img).astype(np.float32) / 255.0
        arr = np.clip(arr * float(opacity), 0.0, 1.0)
        if invert:
            arr = 1.0 - arr

        mask = torch.from_numpy(arr).unsqueeze(0).repeat(batch, 1, 1)
        return (mask,)
