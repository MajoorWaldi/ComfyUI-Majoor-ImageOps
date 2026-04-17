from __future__ import annotations

import math
import torch
import torch.nn.functional as F

from ._helpers import MEDIA_INPUT_TYPE, _resize, _resize_mask, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result

_SPHERIZE_MODES = ["spherize", "fisheye", "defisheye", "latlong", "unlatlong"]
_SPHERIZE_EDGE_MODES = ["border", "reflection", "zeros"]
_SPHERIZE_FILTER_MODES = ["bilinear", "bicubic", "nearest"]
_SPHERIZE_SIZE_MODES = ["from_input", "custom"]


def _spherize_frame(
    frame: torch.Tensor,
    mode: str,
    strength: float,
    invert: bool,
    filter_mode: str,
    edge_mode: str,
) -> torch.Tensor:
    """
    Apply spherize distortion to a single frame [1, H, W, C].

    Modes:
      spherize   – classic barrel/pincushion (Photoshop-style).
                   strength > 0 → barrel (bulge out), < 0 → pincushion (converge).
      fisheye    – equidistant fish-eye projection (wider FOV look).
      defisheye  – inverse equidistant (flatten a fish-eye image).
      latlong    – equirectangular → rectilinear (view lat/long panorama centre).
      unlatlong  – rectilinear → equirectangular (project into lat/long texture).
    """
    B, H, W, C = frame.shape
    device = frame.device
    dtype = frame.dtype

    # Normalised coords in [-1, 1]
    ys = torch.linspace(-1.0, 1.0, H, device=device, dtype=torch.float32)
    xs = torch.linspace(-1.0, 1.0, W, device=device, dtype=torch.float32)
    grid_y, grid_x = torch.meshgrid(ys, xs, indexing="ij")  # [H, W]

    s = float(strength)
    m = str(mode).strip().lower()
    inv = bool(invert)

    def _apply_forward(gx: torch.Tensor, gy: torch.Tensor):
        r = torch.sqrt(gx * gx + gy * gy).clamp(max=1.4142135)

        if m == "spherize":
            # barrel: map r → sin(r * pi/2).  strength scales the effect.
            t = (r * (math.pi * 0.5)).clamp(0.0, math.pi * 0.5)
            scale = torch.where(r > 1e-6, torch.sin(t) / r.clamp(min=1e-6), torch.ones_like(r))
            # blend between identity (s=0) and full warp (s=1)
            blend = scale * s + (1.0 - s)
            return gx * blend, gy * blend

        elif m == "fisheye":
            # equidistant: angle from centre → r_out = r_in (already linear),
            # but source UV is r_in = sin(θ) while we want θ for the projection.
            # Forward: r_src = sin(r_dst * pi/2 * s) / (r_dst * pi/2 * s + 1e-6) * r_dst
            angle = r * (math.pi * 0.5) * s
            r_src = torch.where(r > 1e-6, torch.sin(angle) / r.clamp(min=1e-6) * r, torch.zeros_like(r))
            scale = torch.where(r > 1e-6, r_src / r.clamp(min=1e-6), torch.ones_like(r))
            return gx * scale, gy * scale

        elif m == "defisheye":
            # Inverse equidistant: flatten a fish-eye – expand centre outward.
            angle = r * (math.pi * 0.5) * s
            r_dst = torch.where(angle.abs() > 1e-6, torch.tan(angle.clamp(-1.5, 1.5)) / (math.pi * 0.5 * s + 1e-8), r)
            scale = torch.where(r > 1e-6, r_dst / r.clamp(min=1e-6), torch.ones_like(r))
            return gx * scale, gy * scale

        elif m == "latlong":
            # Equirectangular → rectilinear (barrel-like: centre magnified).
            # Each output pixel is in rectilinear perspective space.
            # lon = atan(gx * fov_tan), normalised so corners reach ±1.
            fov_tan = max(s * 2.0, 1e-6)
            atan_fov = float(torch.atan(torch.tensor(fov_tan)))
            lon = torch.atan(gx * fov_tan)
            lat = torch.atan(gy * fov_tan)
            return lon / atan_fov, lat / atan_fov

        elif m == "unlatlong":
            # Rectilinear → equirectangular (pincushion-like: edges stretched).
            # Inverse of latlong: src = tan(gx * atan_fov) / fov_tan.
            fov_tan = max(s * 2.0, 1e-6)
            atan_fov = float(torch.atan(torch.tensor(fov_tan)))
            clamp_val = atan_fov * 0.9999
            src_x = torch.tan((gx * atan_fov).clamp(-clamp_val, clamp_val)) / fov_tan
            src_y = torch.tan((gy * atan_fov).clamp(-clamp_val, clamp_val)) / fov_tan
            return src_x, src_y

        return gx, gy

    def _apply_inverse(gx: torch.Tensor, gy: torch.Tensor):
        """Swap forward ↔ inverse for invert mode by running the complementary projection."""
        r = torch.sqrt(gx * gx + gy * gy).clamp(max=1.4142135)

        if m == "spherize":
            # Inverse of barrel → pincushion (asin instead of sin).
            t = (r * (math.pi * 0.5)).clamp(0.0, math.pi * 0.5)
            scale = torch.where(r > 1e-6, torch.asin(r.clamp(0.0, 1.0)) / r.clamp(min=1e-6) / (math.pi * 0.5), torch.ones_like(r))
            blend = scale * s + (1.0 - s)
            return gx * blend, gy * blend

        elif m == "fisheye":
            # Inverse fisheye = defisheye
            angle = r * (math.pi * 0.5) * s
            r_dst = torch.where(angle.abs() > 1e-6, torch.tan(angle.clamp(-1.5, 1.5)) / (math.pi * 0.5 * s + 1e-8), r)
            scale = torch.where(r > 1e-6, r_dst / r.clamp(min=1e-6), torch.ones_like(r))
            return gx * scale, gy * scale

        elif m == "defisheye":
            # Inverse defisheye = fisheye
            angle = r * (math.pi * 0.5) * s
            r_src = torch.where(r > 1e-6, torch.sin(angle) / r.clamp(min=1e-6) * r, torch.zeros_like(r))
            scale = torch.where(r > 1e-6, r_src / r.clamp(min=1e-6), torch.ones_like(r))
            return gx * scale, gy * scale

        elif m == "latlong":
            # Inverse of latlong = unlatlong forward
            fov_tan = max(s * 2.0, 1e-6)
            atan_fov = float(torch.atan(torch.tensor(fov_tan)))
            clamp_val = atan_fov * 0.9999
            src_x = torch.tan((gx * atan_fov).clamp(-clamp_val, clamp_val)) / fov_tan
            src_y = torch.tan((gy * atan_fov).clamp(-clamp_val, clamp_val)) / fov_tan
            return src_x, src_y

        elif m == "unlatlong":
            # Inverse of unlatlong = latlong forward
            fov_tan = max(s * 2.0, 1e-6)
            atan_fov = float(torch.atan(torch.tensor(fov_tan)))
            lon = torch.atan(gx * fov_tan)
            lat = torch.atan(gy * fov_tan)
            return lon / atan_fov, lat / atan_fov

        return gx, gy

    fn = _apply_inverse if inv else _apply_forward
    src_x, src_y = fn(grid_x, grid_y)

    # grid_sample expects [B, H, W, 2] with values in [-1, 1].
    grid = torch.stack([src_x, src_y], dim=-1).unsqueeze(0)  # [1, H, W, 2]

    safe_filter = str(filter_mode).strip().lower()
    if safe_filter not in ("nearest", "bilinear", "bicubic"):
        safe_filter = "bilinear"
    safe_edge = str(edge_mode).strip().lower()
    if safe_edge not in ("border", "reflection", "zeros"):
        safe_edge = "border"

    img = frame.float().permute(0, 3, 1, 2)  # [B, C, H, W]
    warped = F.grid_sample(img, grid, mode=safe_filter, padding_mode=safe_edge, align_corners=True)
    warped = warped.permute(0, 2, 3, 1).clamp(0.0, 1.0).to(device=device, dtype=dtype)

    # Mask out pixels outside the unit circle (the sphere boundary)
    r2 = grid_x * grid_x + grid_y * grid_y  # [H, W]
    circle = (r2 <= 1.0).to(dtype=warped.dtype)  # 1 inside, 0 outside
    warped = warped * circle.unsqueeze(0).unsqueeze(-1)  # [B, H, W, C]
    return warped


class ImageOpsSpherize:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "mode": (_SPHERIZE_MODES, {"default": "spherize"}),
                "strength": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 2.0, "step": 0.01, "round": 0.001,
                                        "tooltip": "Effect intensity. 1.0 = full projection. Values > 1 push beyond the normal range."}),
                "invert": ("BOOLEAN", {"default": False,
                                       "tooltip": "Invert the mapping direction (e.g. barrel ↔ pincushion, latlong ↔ unlatlong)."}),
                "filter": (_SPHERIZE_FILTER_MODES, {"default": "bilinear"}),
                "edge_mode": (_SPHERIZE_EDGE_MODES, {"default": "border"}),
                "size_mode": (_SPHERIZE_SIZE_MODES, {"default": "from_input",
                               "tooltip": "from_input: use input image dimensions. custom: resize to width × height before applying spherize."}),
                "width": ("INT", {"default": 512, "min": 64, "max": 8192, "step": 8}),
                "height": ("INT", {"default": 512, "min": 64, "max": 8192, "step": 8}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        bypass=False,
        mode="spherize",
        strength=1.0,
        invert=False,
        filter="bilinear",
        edge_mode="border",
        size_mode="from_input",
        width=512,
        height=512,
        image=None,
        video=None,
        mask=None,
        unique_id=None,
    ):
        src = _select_media_tensor(image, video)
        progress = start_progress(total=src.shape[0] if src is not None else 1, unique_id=unique_id)

        # Resolve target dimensions
        use_custom = str(_scalar(size_mode, str)).strip().lower() == "custom"
        tgt_w = max(64, int(_scalar(width, int)))
        tgt_h = max(64, int(_scalar(height, int)))

        if src is None or _scalar(bypass, bool):
            if src is not None:
                out_mask = mask if mask is not None else torch.ones(src.shape[0], src.shape[1], src.shape[2], device=src.device, dtype=src.dtype)
            else:
                out_mask = mask if mask is not None else torch.ones(1, 64, 64, dtype=torch.float32)
            progress.finish()
            return build_node_preview_result(src, (src, out_mask), prefix="imageops_spherize")

        # Resize input if custom size requested
        if use_custom:
            src = _resize(src, tgt_w, tgt_h, mode="bilinear", antialias=True)
            if mask is not None:
                mask = _resize_mask(mask, tgt_w, tgt_h)

        frames = []
        for fi in range(src.shape[0]):
            frame_mode = _scalar(mode, str, index=fi)
            frame_strength = float(_scalar(strength, float, index=fi))
            frame_invert = bool(_scalar(invert, bool, index=fi))
            frame_filter = _scalar(filter, str, index=fi)
            frame_edge = _scalar(edge_mode, str, index=fi)
            frames.append(
                _spherize_frame(
                    src[fi:fi + 1],
                    mode=frame_mode,
                    strength=frame_strength,
                    invert=frame_invert,
                    filter_mode=frame_filter,
                    edge_mode=frame_edge,
                )
            )
            progress.update()

        out = torch.cat(frames, dim=0).clamp(0.0, 1.0)

        # Build circle mask [H, W] — 1 inside the sphere, 0 outside
        H, W = out.shape[1], out.shape[2]
        ys = torch.linspace(-1.0, 1.0, H, device=out.device, dtype=torch.float32)
        xs = torch.linspace(-1.0, 1.0, W, device=out.device, dtype=torch.float32)
        gy, gx = torch.meshgrid(ys, xs, indexing="ij")
        circle_mask = (gx * gx + gy * gy <= 1.0).float()  # [H, W]
        circle_mask_b = circle_mask.unsqueeze(0).expand(out.shape[0], -1, -1)  # [B, H, W]

        if mask is not None:
            out_mask = circle_mask_b * mask
        else:
            out_mask = circle_mask_b

        progress.finish()
        return build_node_preview_result(out, (out, out_mask), prefix="imageops_spherize")
