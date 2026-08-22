from __future__ import annotations
from comfy_api.latest import io
import torch
from ._helpers import _hex_to_rgb01, _resolve_aspect_ratio, _scalar, ASPECT_RATIO_PRESETS
from ._preview import build_node_preview_result
from ._progress import start_progress
_MODES = ['constant', 'checkerboard']

def _constant_image(batch: int, height: int, width: int, color: str, alpha: float) -> torch.Tensor:
    rgb = torch.tensor(_hex_to_rgb01(color), dtype=torch.float32).view(1, 1, 1, 3)
    image = rgb.expand(batch, height, width, 3).clone()
    a = torch.full((batch, height, width, 1), float(alpha), dtype=torch.float32).clamp(0.0, 1.0)
    return torch.cat([image, a], dim=-1)

def _checkerboard_image(batch: int, height: int, width: int, color_a: str, color_b: str, alpha: float, tile_size: int, offset_x: int, offset_y: int) -> torch.Tensor:
    tile = max(1, int(tile_size))
    yy = (torch.arange(height, dtype=torch.int64).view(height, 1) + int(offset_y)) // tile
    xx = (torch.arange(width, dtype=torch.int64).view(1, width) + int(offset_x)) // tile
    pattern = torch.remainder(xx + yy, 2).to(torch.float32).view(1, height, width, 1)
    rgb_a = torch.tensor(_hex_to_rgb01(color_a), dtype=torch.float32).view(1, 1, 1, 3)
    rgb_b = torch.tensor(_hex_to_rgb01(color_b), dtype=torch.float32).view(1, 1, 1, 3)
    rgb = rgb_a * (1.0 - pattern) + rgb_b * pattern
    rgb = rgb.expand(batch, height, width, 3).clone()
    a = torch.full((batch, height, width, 1), float(alpha), dtype=torch.float32).clamp(0.0, 1.0)
    return torch.cat([rgb, a], dim=-1)

class ImageOpsConstant(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsConstant', display_name='〽️ Image Ops Constant', category='image/imageops', inputs=[io.String.Input('mode', default='constant'), io.Int.Input('width', default=1024, min=1, max=8192, step=1), io.Int.Input('height', default=1024, min=1, max=8192, step=1), io.String.Input('aspect_ratio', default='custom'), io.Int.Input('frame_count', default=1, min=1, max=4096, step=1), io.Color.Input('color', default='#ffffff'), io.Color.Input('color_b', default='#000000'), io.Float.Input('alpha', default=1.0, min=0.0, max=1.0, step=0.01), io.Int.Input('tile_size', default=64, min=1, max=2048, step=1), io.Int.Input('offset_x', default=0, min=-8192, max=8192, step=1), io.Int.Input('offset_y', default=0, min=-8192, max=8192, step=1)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask'), io.Int.Output('width', display_name='width'), io.Int.Output('height', display_name='height'), io.Int.Output('frame_count', display_name='frame_count')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, mode='constant', width=1024, height=1024, aspect_ratio='custom', frame_count=None, frame_length=None, batch_size=None, color='#ffffff', color_b='#000000', alpha=1.0, tile_size=64, offset_x=0, offset_y=0, unique_id=None, **kwargs):
        progress = start_progress(unique_id=unique_id)
        out_w = max(1, _scalar(width, int))
        out_h = max(1, _scalar(height, int))
        ratio_str = _scalar(aspect_ratio, str) if isinstance(aspect_ratio, str) else 'custom'
        preset = ASPECT_RATIO_PRESETS.get(str(ratio_str).lower())
        if preset is not None and preset[1] > 0:
            target_ratio = float(preset[0]) / float(preset[1])
            src_ratio = float(out_w) / float(max(1, out_h))
            if src_ratio > target_ratio:
                out_w = max(1, int(round(out_h * target_ratio)))
            elif src_ratio < target_ratio:
                out_h = max(1, int(round(out_w / target_ratio)))
        frame_count_source = frame_count if frame_count is not None else frame_length if frame_length is not None else batch_size if batch_size is not None else 1
        batch = max(1, _scalar(frame_count_source, int))
        opacity = max(0.0, min(1.0, _scalar(alpha)))
        normalized_mode = str(mode or 'constant').strip().lower().replace('-', '_').replace(' ', '_')
        from .core.memory import check_budget
        check_budget(batch, out_h, out_w, 4, multiplier=1.5, label='ImageOps Constant')
        if normalized_mode == 'checkerboard':
            image = _checkerboard_image(batch, out_h, out_w, color, color_b, opacity, _scalar(tile_size, int), _scalar(offset_x, int), _scalar(offset_y, int))
        else:
            image = _constant_image(batch, out_h, out_w, color, opacity)
        mask = image[..., 3].clamp(0.0, 1.0)
        progress.finish()
        return build_node_preview_result(image, (image, mask, out_w, out_h, batch), prefix='imageops_constant')