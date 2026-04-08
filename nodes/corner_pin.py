from __future__ import annotations

import torch
import torch.nn.functional as F

from ._helpers import EPSILON, MEDIA_INPUT_TYPE, _param_tensor, _scalar, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress

_CORNER_PIN_FILTERS = ["nearest", "bilinear", "bicubic"]
_CORNER_PIN_EDGE_MODES = ["border", "reflection", "zeros"]
_CORNER_PIN_SUPERSAMPLE_MAX = 4


def _normalize_filter(filter_mode: str) -> str:
    normalized = str(filter_mode or "bilinear").strip().lower()
    return normalized if normalized in ("nearest", "bilinear", "bicubic") else "bilinear"


def _normalize_padding(edge_mode: str) -> str:
    normalized = str(edge_mode or "zeros").strip().lower()
    return normalized if normalized in ("border", "reflection", "zeros") else "zeros"


def _normalize_supersample(value) -> int:
    return max(1, min(_CORNER_PIN_SUPERSAMPLE_MAX, int(round(float(value)))))


def _solve_homography_batch(src_points: torch.Tensor, dst_points: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    batch = int(dst_points.shape[0])
    dtype = src_points.dtype
    device = src_points.device
    A = torch.zeros((batch, 8, 8), dtype=dtype, device=device)
    b = torch.zeros((batch, 8), dtype=dtype, device=device)

    x = src_points[:, 0].view(1, 4).expand(batch, 4)
    y = src_points[:, 1].view(1, 4).expand(batch, 4)
    u = dst_points[:, :, 0]
    v = dst_points[:, :, 1]

    A[:, 0::2, 0] = x
    A[:, 0::2, 1] = y
    A[:, 0::2, 2] = 1.0
    A[:, 0::2, 6] = -u * x
    A[:, 0::2, 7] = -u * y
    b[:, 0::2] = u

    A[:, 1::2, 3] = x
    A[:, 1::2, 4] = y
    A[:, 1::2, 5] = 1.0
    A[:, 1::2, 6] = -v * x
    A[:, 1::2, 7] = -v * y
    b[:, 1::2] = v

    try:
        solved, info = torch.linalg.solve_ex(A, b)
        valid = info.eq(0)
    except (AttributeError, RuntimeError):
        try:
            solved = torch.linalg.solve(A, b)
            valid = torch.ones((batch,), device=device, dtype=torch.bool)
        except RuntimeError:
            solved = torch.matmul(torch.linalg.pinv(A), b.unsqueeze(-1)).squeeze(-1)
            valid = torch.isfinite(solved).all(dim=1)

    H = torch.zeros((batch, 3, 3), dtype=dtype, device=device)
    H[:, 0, 0] = solved[:, 0]
    H[:, 0, 1] = solved[:, 1]
    H[:, 0, 2] = solved[:, 2]
    H[:, 1, 0] = solved[:, 3]
    H[:, 1, 1] = solved[:, 4]
    H[:, 1, 2] = solved[:, 5]
    H[:, 2, 0] = solved[:, 6]
    H[:, 2, 1] = solved[:, 7]
    H[:, 2, 2] = 1.0

    valid = valid & torch.isfinite(H).flatten(1).all(dim=1)
    identity = torch.eye(3, dtype=dtype, device=device).expand(batch, 3, 3)
    H = torch.where(valid.view(batch, 1, 1), H, identity)
    return H, valid


def _invert_homography_batch(H: torch.Tensor, valid: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    batch = int(H.shape[0])
    try:
        Hinv, info = torch.linalg.inv_ex(H)
        valid = valid & info.eq(0)
    except (AttributeError, RuntimeError):
        try:
            Hinv = torch.linalg.inv(H)
        except RuntimeError:
            Hinv = torch.linalg.pinv(H)
    valid = valid & torch.isfinite(Hinv).flatten(1).all(dim=1)
    identity = torch.eye(3, dtype=H.dtype, device=H.device).expand(batch, 3, 3)
    Hinv = torch.where(valid.view(batch, 1, 1), Hinv, identity)
    return Hinv, valid


def _build_corner_pin_grid(height: int, width: int, Hinv: torch.Tensor, supersample: int = 1) -> tuple[torch.Tensor, torch.Tensor]:
    batch = int(Hinv.shape[0])
    device = Hinv.device
    dtype = Hinv.dtype
    out_h = max(1, int(height) * int(supersample))
    out_w = max(1, int(width) * int(supersample))
    ys = torch.linspace(0.0, float(max(0, height - 1)), out_h, device=device, dtype=dtype)
    xs = torch.linspace(0.0, float(max(0, width - 1)), out_w, device=device, dtype=dtype)
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")

    denom = Hinv[:, 2, 0].view(batch, 1, 1) * xx + Hinv[:, 2, 1].view(batch, 1, 1) * yy + Hinv[:, 2, 2].view(batch, 1, 1)
    denom = torch.where(torch.abs(denom) < 1e-8, torch.full_like(denom, 1e-8), denom)
    src_x = (Hinv[:, 0, 0].view(batch, 1, 1) * xx + Hinv[:, 0, 1].view(batch, 1, 1) * yy + Hinv[:, 0, 2].view(batch, 1, 1)) / denom
    src_y = (Hinv[:, 1, 0].view(batch, 1, 1) * xx + Hinv[:, 1, 1].view(batch, 1, 1) * yy + Hinv[:, 1, 2].view(batch, 1, 1)) / denom

    if width > 1:
        norm_x = (src_x / float(width - 1)) * 2.0 - 1.0
    else:
        norm_x = torch.zeros_like(src_x)
    if height > 1:
        norm_y = (src_y / float(height - 1)) * 2.0 - 1.0
    else:
        norm_y = torch.zeros_like(src_y)
    grid = torch.stack([norm_x, norm_y], dim=-1)

    inside = (src_x >= 0.0) & (src_x <= float(width - 1)) & (src_y >= 0.0) & (src_y <= float(height - 1))
    return grid, inside.unsqueeze(1).to(dtype=dtype)


def _corner_pin_dst_points(batch: int, height: int, width: int, device, dtype, tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y) -> torch.Tensor:
    w = float(max(0, width - 1))
    h = float(max(0, height - 1))
    points = torch.stack([
        torch.stack([_param_tensor(tl_x, batch, device, dtype).view(batch) * w, _param_tensor(tl_y, batch, device, dtype).view(batch) * h], dim=1),
        torch.stack([_param_tensor(tr_x, batch, device, dtype).view(batch) * w, _param_tensor(tr_y, batch, device, dtype).view(batch) * h], dim=1),
        torch.stack([_param_tensor(bl_x, batch, device, dtype).view(batch) * w, _param_tensor(bl_y, batch, device, dtype).view(batch) * h], dim=1),
        torch.stack([_param_tensor(br_x, batch, device, dtype).view(batch) * w, _param_tensor(br_y, batch, device, dtype).view(batch) * h], dim=1),
    ], dim=1)
    return points


def _premultiply_alpha_for_warp(source: torch.Tensor) -> torch.Tensor:
    if source.shape[-1] < 4:
        return source
    alpha = source[..., 3:4].clamp(0.0, 1.0)
    return torch.cat([source[..., :3] * alpha, source[..., 3:]], dim=-1)


def _unpremultiply_alpha_after_warp(source: torch.Tensor) -> torch.Tensor:
    if source.shape[-1] < 4:
        return source
    alpha = source[..., 3:4].clamp(0.0, 1.0)
    safe_alpha = torch.where(alpha > EPSILON, alpha, torch.ones_like(alpha))
    rgb = torch.where(alpha > EPSILON, source[..., :3] / safe_alpha, torch.zeros_like(source[..., :3]))
    return torch.cat([rgb.clamp(0.0, 1.0), source[..., 3:]], dim=-1)


def _downsample_nchw(x: torch.Tensor, height: int, width: int, mode: str, antialias: bool = True) -> torch.Tensor:
    if int(x.shape[-2]) == int(height) and int(x.shape[-1]) == int(width):
        return x
    resize_mode = "area" if mode == "nearest" else mode
    kwargs = {"size": (int(height), int(width)), "mode": resize_mode}
    if resize_mode in ("bilinear", "bicubic"):
        kwargs["align_corners"] = False
        kwargs["antialias"] = bool(antialias)
    try:
        return F.interpolate(x, **kwargs)
    except TypeError:
        kwargs.pop("antialias", None)
        return F.interpolate(x, **kwargs)


def _warp_corner_pin_group(input_nchw: torch.Tensor, Hinv: torch.Tensor, height: int, width: int, mode: str, padding: str, supersample: int) -> tuple[torch.Tensor, torch.Tensor]:
    grid, valid = _build_corner_pin_grid(height, width, Hinv, supersample=supersample)
    warped = F.grid_sample(
        input_nchw,
        grid,
        mode=mode,
        padding_mode=padding,
        align_corners=True,
    )
    if supersample > 1:
        warped = _downsample_nchw(warped, height, width, mode, antialias=True)
        valid = _downsample_nchw(valid, height, width, "bilinear", antialias=True)
    return warped, valid.clamp(0.0, 1.0)


class ImageOpsCornerPin:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "tl_x": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "tl_y": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "tr_x": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "tr_y": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "bl_x": ("FLOAT", {"default": 0.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "bl_y": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "br_x": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "br_y": ("FLOAT", {"default": 1.0, "min": -2.0, "max": 2.0, "step": 0.001}),
                "filter": (_CORNER_PIN_FILTERS, {"default": "bilinear"}),
                "supersample": ("INT", {"default": 1, "min": 1, "max": _CORNER_PIN_SUPERSAMPLE_MAX, "step": 1, "tooltip": "Render at 2x-4x and downsample to reduce perspective aliasing."}),
                "edge_mode": (_CORNER_PIN_EDGE_MODES, {"default": "zeros"}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(
        self,
        image=None,
        bypass=False,
        tl_x=0.0,
        tl_y=0.0,
        tr_x=1.0,
        tr_y=0.0,
        bl_x=0.0,
        bl_y=1.0,
        br_x=1.0,
        br_y=1.0,
        filter="bilinear",
        supersample=1,
        edge_mode="zeros",
        invert_mask=False,
        video=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        batch = int(source.shape[0])
        height = int(source.shape[1])
        width = int(source.shape[2])
        channels = int(source.shape[3])

        progress = start_progress(total=max(1, batch), unique_id=unique_id)

        if _scalar(bypass, bool):
            mask = torch.ones((batch, height, width), device=source.device, dtype=source.dtype)
            invert = _param_tensor(invert_mask, batch, source.device, source.dtype).view(batch, 1, 1)
            mask = torch.where(invert >= 0.5, 1.0 - mask, mask)
            progress.finish()
            return build_node_preview_result(source, (source, mask), prefix="imageops_cornerpin")

        src_points = torch.tensor(
            [
                [0.0, 0.0],
                [float(width - 1), 0.0],
                [0.0, float(height - 1)],
                [float(width - 1), float(height - 1)],
            ],
            device=source.device,
            dtype=source.dtype,
        )

        dst_points = _corner_pin_dst_points(
            batch, height, width, source.device, source.dtype,
            tl_x, tl_y, tr_x, tr_y, bl_x, bl_y, br_x, br_y,
        )
        H, valid_h = _solve_homography_batch(src_points, dst_points)
        Hinv, valid_h = _invert_homography_batch(H, valid_h)

        input_nchw = _premultiply_alpha_for_warp(source).permute(0, 3, 1, 2).contiguous()
        warped_nchw = torch.empty_like(input_nchw)
        valid_nchw = torch.empty((batch, 1, height, width), device=source.device, dtype=source.dtype)

        groups: dict[tuple[str, str, int], list[int]] = {}
        for frame_index in range(batch):
            key = (
                _normalize_filter(_scalar(filter, str, index=frame_index)),
                _normalize_padding(_scalar(edge_mode, str, index=frame_index)),
                _normalize_supersample(_scalar(supersample, int, index=frame_index)),
            )
            groups.setdefault(key, []).append(frame_index)

        for (mode, padding, sample_factor), indices in groups.items():
            index_tensor = torch.tensor(indices, device=source.device, dtype=torch.long)
            group_warped, group_valid = _warp_corner_pin_group(
                input_nchw.index_select(0, index_tensor),
                Hinv.index_select(0, index_tensor),
                height,
                width,
                mode,
                padding,
                sample_factor,
            )
            warped_nchw.index_copy_(0, index_tensor, group_warped)
            valid_nchw.index_copy_(0, index_tensor, group_valid)
            progress.update(len(indices))

        result = warped_nchw.permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)
        result = _unpremultiply_alpha_after_warp(result).clamp(0.0, 1.0)
        mask = valid_nchw[:, 0, :, :].clamp(0.0, 1.0)
        if channels >= 4:
            mask = (mask * result[..., 3].clamp(0.0, 1.0)).clamp(0.0, 1.0)

        mask = torch.where(valid_h.view(batch, 1, 1), mask, torch.ones_like(mask))
        invert = _param_tensor(invert_mask, batch, source.device, source.dtype).view(batch, 1, 1)
        mask = torch.where(invert >= 0.5, 1.0 - mask, mask)

        progress.finish()
        return build_node_preview_result(result, (result, mask), prefix="imageops_cornerpin")
