from comfy_api.latest import io
import torch
import torch.nn.functional as F
from ._helpers import MEDIA_INPUT_TYPE, _apply_blur, _hex_to_rgb01, _resize, _scalar, _select_media_tensor
from ._preview import build_node_preview_result
from ._progress import start_progress
_PADOUT_FILL_MODES = ['constant', 'edge_extend', 'reflect', 'blurry']
_PADOUT_TARGET_FORMATS = ['custom', '1:1', '16:9', '9:16', '4:3', '3:4']
_TARGET_RATIOS = {'1:1': (1, 1), 'square': (1, 1), 'nearest_square': (1, 1), '16:9': (16, 9), '9:16': (9, 16), '4:3': (4, 3), '3:4': (3, 4)}

def _build_padout_mask(batch: int, height: int, width: int, top: int, left: int, source_h: int, source_w: int, device, dtype) -> torch.Tensor:
    mask = torch.ones((batch, height, width), device=device, dtype=dtype)
    mask[:, top:top + source_h, left:left + source_w] = 0.0
    return mask

def _normalize_fill_mode(value: str) -> str:
    normalized = str(value or 'constant').strip().lower().replace('-', '_').replace(' ', '_')
    if normalized in ('edge', 'edge_extend', 'replicate', 'extend'):
        return 'edge_extend'
    if normalized in ('blur', 'blurry', 'blurred'):
        return 'blurry'
    if normalized in ('reflect', 'reflection', 'mirror'):
        return 'reflect'
    return 'constant'

def _resolve_target_padding(source_w: int, source_h: int, left: int, top: int, right: int, bottom: int, target_format: str) -> tuple[int, int, int, int]:
    normalized = str(target_format or 'custom').strip().lower().replace(' ', '_')
    ratio = _TARGET_RATIOS.get(normalized)
    if ratio is None:
        return (left, top, right, bottom)
    out_w = max(1, int(source_w) + int(left) + int(right))
    out_h = max(1, int(source_h) + int(top) + int(bottom))
    ratio_w, ratio_h = ratio
    target_w = out_w
    target_h = out_h
    if out_w * ratio_h < out_h * ratio_w:
        target_w = int((out_h * ratio_w + ratio_h - 1) // ratio_h)
    elif out_w * ratio_h > out_h * ratio_w:
        target_h = int((out_w * ratio_h + ratio_w - 1) // ratio_w)
    extra_w = max(0, target_w - out_w)
    extra_h = max(0, target_h - out_h)
    extra_left = extra_w // 2
    extra_top = extra_h // 2
    return (int(left) + extra_left, int(top) + extra_top, int(right) + (extra_w - extra_left), int(bottom) + (extra_h - extra_top))

def _make_constant_pad(source: torch.Tensor, out_h: int, out_w: int, fill_color: str) -> torch.Tensor:
    batch, _, _, channels = source.shape
    out = torch.zeros((batch, out_h, out_w, channels), device=source.device, dtype=source.dtype)
    r, g, b = _hex_to_rgb01(fill_color)
    if channels >= 1:
        out[..., 0] = r
    if channels >= 2:
        out[..., 1] = g
    if channels >= 3:
        out[..., 2] = b
    if channels >= 4:
        out[..., 3] = 1.0
    return out

def _make_blurry_pad(source: torch.Tensor, out_h: int, out_w: int, blur_radius: int) -> torch.Tensor:
    background = _resize(source, out_w, out_h, mode='bicubic', antialias=True)
    radius = int(max(0, blur_radius))
    if radius > 0:
        background = _apply_blur(background, radius, max(1.0, radius / 3.0))
    if background.shape[-1] >= 4:
        background = torch.cat([background[..., :3], torch.ones_like(background[..., 3:4])], dim=-1)
    return background

def _make_edge_pad(source: torch.Tensor, left: int, top: int, right: int, bottom: int, mode: str) -> torch.Tensor:
    if left == 0 and right == 0 and (top == 0) and (bottom == 0):
        return source
    pad_mode = 'reflect' if mode == 'reflect' else 'replicate'
    x = source.permute(0, 3, 1, 2).contiguous()
    if pad_mode == 'reflect' and (left >= source.shape[2] or right >= source.shape[2] or top >= source.shape[1] or (bottom >= source.shape[1])):
        pad_mode = 'replicate'
    out = F.pad(x, (left, right, top, bottom), mode=pad_mode)
    return out.permute(0, 2, 3, 1).contiguous()

class ImageOpsPadOut(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsPadOut', display_name='〽️ Image Ops Pad Out', category='image/imageops', search_aliases=['pad', 'pad out', 'padding', 'border', 'expand canvas', 'outpaint'], inputs=[io.Boolean.Input('bypass', default=False), io.Int.Input('pad_left', default=128, min=0, max=4096, step=1), io.Int.Input('pad_top', default=128, min=0, max=4096, step=1), io.Int.Input('pad_right', default=128, min=0, max=4096, step=1), io.Int.Input('pad_bottom', default=128, min=0, max=4096, step=1), io.Combo.Input('target_format', options=['custom', '1:1', '3:4', '4:3', '16:9', '9:16'], default='custom', tooltip='Add extra padding to hit a target aspect ratio without scaling the image.'), io.Combo.Input('fill_mode', options=['constant', 'edge_extend', 'reflect', 'blurry'], default='constant'), io.Color.Input('fill_color', default='#000000'), io.Int.Input('blur_radius', default=32, min=0, max=512, step=1, tooltip='Used by blurry padding.'), io.Boolean.Input('invert_mask', default=False, tooltip='By default the output mask marks the *padded* area as 1 and the original source as 0. Toggle to invert (source=1, padding=0).'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True})], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask'), io.Int.Output('width', display_name='width'), io.Int.Output('height', display_name='height')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, bypass=False, pad_left=128, pad_top=128, pad_right=128, pad_bottom=128, target_format='custom', fill_mode='constant', fill_color='#000000', blur_radius=32, invert_mask=False, video=None, unique_id=None, **kwargs):
        source = _select_media_tensor(image, video).float()
        progress = start_progress(unique_id=unique_id)
        batch = int(source.shape[0])
        source_h = int(source.shape[1])
        source_w = int(source.shape[2])
        if _scalar(bypass, bool):
            mask = torch.zeros((batch, source_h, source_w), device=source.device, dtype=source.dtype)
            if _scalar(invert_mask, bool):
                mask = 1.0 - mask
            progress.finish()
            meta = {'imageops_padout_source': {'source_w': source_w, 'source_h': source_h, 'pad_left': 0, 'pad_top': 0}}
            return build_node_preview_result(source, (source, mask, source_w, source_h), prefix='imageops_padout', metadata=meta)
        left = max(0, _scalar(pad_left, int))
        top = max(0, _scalar(pad_top, int))
        right = max(0, _scalar(pad_right, int))
        bottom = max(0, _scalar(pad_bottom, int))
        left, top, right, bottom = _resolve_target_padding(source_w, source_h, left, top, right, bottom, _scalar(target_format, str))
        out_w = source_w + left + right
        out_h = source_h + top + bottom
        from .core.memory import check_budget
        check_budget(batch, out_h, out_w, int(source.shape[-1]), multiplier=2.0, label='ImageOps PadOut')
        mode = _normalize_fill_mode(_scalar(fill_mode, str))
        if mode in ('edge_extend', 'reflect'):
            out = _make_edge_pad(source, left, top, right, bottom, mode)
        elif mode == 'blurry':
            out = _make_blurry_pad(source, out_h, out_w, _scalar(blur_radius, int))
        else:
            out = _make_constant_pad(source, out_h, out_w, _scalar(fill_color, str))
        if out is not source:
            out[:, top:top + source_h, left:left + source_w, :] = source
        stitch_mask = _build_padout_mask(batch=batch, height=out_h, width=out_w, top=top, left=left, source_h=source_h, source_w=source_w, device=source.device, dtype=source.dtype).clamp(0.0, 1.0)
        mask = stitch_mask
        if _scalar(invert_mask, bool):
            mask = 1.0 - mask
        progress.finish()
        meta = {'imageops_padout_source': {'source_w': source_w, 'source_h': source_h, 'pad_left': left, 'pad_top': top}}
        return build_node_preview_result(out, (out, mask.clamp(0.0, 1.0), out_w, out_h), prefix='imageops_padout', metadata=meta)
