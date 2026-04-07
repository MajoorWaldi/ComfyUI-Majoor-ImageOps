from __future__ import annotations

import torch
import torch.nn.functional as F

from ._helpers import MEDIA_INPUT_TYPE, _scalar, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress

_CORNER_PIN_FILTERS = ["nearest", "bilinear", "bicubic"]
_CORNER_PIN_EDGE_MODES = ["border", "reflection", "zeros"]


def _solve_homography(src_points: torch.Tensor, dst_points: torch.Tensor) -> torch.Tensor:
    dtype = src_points.dtype
    device = src_points.device
    A = torch.zeros((8, 8), dtype=dtype, device=device)
    b = torch.zeros((8,), dtype=dtype, device=device)
    for idx in range(4):
        x = src_points[idx, 0]
        y = src_points[idx, 1]
        u = dst_points[idx, 0]
        v = dst_points[idx, 1]

        row = idx * 2
        A[row, 0] = x
        A[row, 1] = y
        A[row, 2] = 1.0
        A[row, 6] = -u * x
        A[row, 7] = -u * y
        b[row] = u

        A[row + 1, 3] = x
        A[row + 1, 4] = y
        A[row + 1, 5] = 1.0
        A[row + 1, 6] = -v * x
        A[row + 1, 7] = -v * y
        b[row + 1] = v

    solved = torch.linalg.solve(A, b)
    H = torch.zeros((3, 3), dtype=dtype, device=device)
    H[0, 0] = solved[0]
    H[0, 1] = solved[1]
    H[0, 2] = solved[2]
    H[1, 0] = solved[3]
    H[1, 1] = solved[4]
    H[1, 2] = solved[5]
    H[2, 0] = solved[6]
    H[2, 1] = solved[7]
    H[2, 2] = 1.0
    return H


def _build_corner_pin_grid(height: int, width: int, Hinv: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    device = Hinv.device
    dtype = Hinv.dtype
    ys = torch.arange(height, device=device, dtype=dtype)
    xs = torch.arange(width, device=device, dtype=dtype)
    yy, xx = torch.meshgrid(ys, xs, indexing="ij")

    denom = Hinv[2, 0] * xx + Hinv[2, 1] * yy + Hinv[2, 2]
    denom = torch.where(torch.abs(denom) < 1e-8, torch.full_like(denom, 1e-8), denom)
    src_x = (Hinv[0, 0] * xx + Hinv[0, 1] * yy + Hinv[0, 2]) / denom
    src_y = (Hinv[1, 0] * xx + Hinv[1, 1] * yy + Hinv[1, 2]) / denom

    norm_x = (src_x / max(1.0, float(width - 1))) * 2.0 - 1.0
    norm_y = (src_y / max(1.0, float(height - 1))) * 2.0 - 1.0
    grid = torch.stack([norm_x, norm_y], dim=-1).unsqueeze(0)

    inside = (src_x >= 0.0) & (src_x <= float(width - 1)) & (src_y >= 0.0) & (src_y <= float(height - 1))
    return grid, inside.unsqueeze(0).to(dtype=dtype)


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
        edge_mode="zeros",
        invert_mask=False,
        video=None,
        unique_id=None,
    ):
        source = _select_media_tensor(image, video).float().clamp(0.0, 1.0)
        batch = int(source.shape[0])
        height = int(source.shape[1])
        width = int(source.shape[2])
        mode = str(filter or "bilinear").strip().lower()
        if mode not in ("nearest", "bilinear", "bicubic"):
            mode = "bilinear"
        padding = str(edge_mode or "zeros").strip().lower()
        if padding not in ("border", "reflection", "zeros"):
            padding = "zeros"

        progress = start_progress(total=max(1, batch), unique_id=unique_id)

        if _scalar(bypass, bool):
            mask = torch.ones((batch, height, width), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
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

        input_nchw = source.permute(0, 3, 1, 2).contiguous()
        warped_frames = []
        mask_frames = []

        for frame_index in range(batch):
            dst_points = torch.tensor(
                [
                    [_scalar(tl_x, index=frame_index) * float(width - 1), _scalar(tl_y, index=frame_index) * float(height - 1)],
                    [_scalar(tr_x, index=frame_index) * float(width - 1), _scalar(tr_y, index=frame_index) * float(height - 1)],
                    [_scalar(bl_x, index=frame_index) * float(width - 1), _scalar(bl_y, index=frame_index) * float(height - 1)],
                    [_scalar(br_x, index=frame_index) * float(width - 1), _scalar(br_y, index=frame_index) * float(height - 1)],
                ],
                device=source.device,
                dtype=source.dtype,
            )

            try:
                H = _solve_homography(src_points, dst_points)
                Hinv = torch.linalg.inv(H)
            except RuntimeError:
                warped_frames.append(input_nchw[frame_index:frame_index + 1])
                mask_frames.append(torch.ones((1, 1, height, width), device=source.device, dtype=source.dtype))
                progress.update()
                continue

            grid, valid = _build_corner_pin_grid(height, width, Hinv)
            warped = F.grid_sample(
                input_nchw[frame_index:frame_index + 1],
                grid,
                mode=mode,
                padding_mode=padding,
                align_corners=True,
            )
            warped_frames.append(warped)
            mask_frames.append(valid.unsqueeze(1))
            progress.update()

        result = torch.cat(warped_frames, dim=0).permute(0, 2, 3, 1).contiguous().clamp(0.0, 1.0)
        mask = torch.cat(mask_frames, dim=0)[:, 0, :, :].clamp(0.0, 1.0)

        if _scalar(invert_mask, bool):
            mask = 1.0 - mask

        progress.finish()
        return build_node_preview_result(result, (result, mask), prefix="imageops_cornerpin")
