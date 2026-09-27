from comfy_api.latest import io
import torch
from ._helpers import CHANNEL_OPTIONS, LUMA_WEIGHTS, MEDIA_INPUT_TYPE, _alpha_mask_from_image, _channel_mask_to_image, _extract_channel_mask, _prepare_mask_tensor, _scalar, _select_media_tensor
from .compat.comfy_v3 import V3NodeBase
from ._progress import start_progress
from ._preview import build_node_preview_result

_SHUFFLE_SOURCES = ['R', 'G', 'B', 'A', 'Luma', 'Zero', 'One', 'Mask']


def _resolve_shuffle_source(image: torch.Tensor, name: str, mask: torch.Tensor | None) -> torch.Tensor:
    rgb = image[..., :3]
    alpha = image[..., 3:4] if image.shape[-1] >= 4 else None
    normalized = str(name or 'R').strip().lower()
    if normalized == 'r':
        return rgb[..., 0:1]
    if normalized == 'g':
        return rgb[..., 1:2]
    if normalized == 'b':
        return rgb[..., 2:3]
    if normalized == 'a':
        return alpha if alpha is not None else torch.ones_like(rgb[..., 0:1])
    if normalized == 'luma':
        lr, lg, lb = LUMA_WEIGHTS
        return (rgb[..., 0:1] * lr + rgb[..., 1:2] * lg + rgb[..., 2:3] * lb)
    if normalized == 'zero':
        return torch.zeros_like(rgb[..., 0:1])
    if normalized == 'one':
        return torch.ones_like(rgb[..., 0:1])
    if normalized == 'mask':
        if mask is None:
            raise ValueError('ImageOps Channel: "Mask" selected as a shuffle source but no mask is connected.')
        return mask.unsqueeze(-1)
    return rgb[..., 0:1]


def _apply_shuffle(image: torch.Tensor, out_r: str, out_g: str, out_b: str, out_a: str, mask: torch.Tensor | None) -> torch.Tensor:
    prepared_mask = _prepare_mask_tensor(mask, batch=image.shape[0], height=image.shape[1], width=image.shape[2], device=image.device, dtype=image.dtype) if mask is not None else None
    channels = [
        _resolve_shuffle_source(image, out_r, prepared_mask),
        _resolve_shuffle_source(image, out_g, prepared_mask),
        _resolve_shuffle_source(image, out_b, prepared_mask),
        _resolve_shuffle_source(image, out_a, prepared_mask),
    ]
    return torch.cat(channels, dim=-1)


class ImageOpsChannel(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsChannel', display_name='〽️ Image Ops Channel', category='image/imageops', search_aliases=['channel', 'channels', 'rgb', 'alpha', 'red', 'green', 'blue', 'shuffle'], inputs=[io.Boolean.Input('bypass', default=False), io.Combo.Input('mode', options=['extract', 'shuffle'], default='extract', tooltip='extract: read one channel out as an image/mask (legacy behavior). shuffle: rebuild an RGBA image by routing each output channel from any source.'), io.Combo.Input('channel', options=['Red', 'Green', 'Blue', 'Alpha'], default='Red', tooltip='Used in extract mode.'), io.Combo.Input('out_r', options=_SHUFFLE_SOURCES, default='R', tooltip='Used in shuffle mode.'), io.Combo.Input('out_g', options=_SHUFFLE_SOURCES, default='G', tooltip='Used in shuffle mode.'), io.Combo.Input('out_b', options=_SHUFFLE_SOURCES, default='B', tooltip='Used in shuffle mode.'), io.Combo.Input('out_a', options=_SHUFFLE_SOURCES, default='A', tooltip='Used in shuffle mode.'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True, tooltip='Available as a "Mask" source in shuffle mode.')], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, bypass=False, mode='extract', channel='Red', out_r='R', out_g='G', out_b='B', out_a='A', video=None, mask=None, unique_id=None, **kwargs):
        source = _select_media_tensor(image, video)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = _alpha_mask_from_image(source)
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix='imageops_channel')
        if str(_scalar(mode, str)).strip().lower() == 'shuffle':
            result = _apply_shuffle(source.float(), out_r, out_g, out_b, out_a, mask)
            output_mask = result[..., 3]
            progress.finish()
            return build_node_preview_result(result, (result, output_mask), prefix='imageops_channel')
        extracted = _extract_channel_mask(source, channel)
        if str(_scalar(channel, str)).strip().lower() == 'alpha':
            result = source.clone()
            if result.shape[-1] < 4:
                result = _channel_mask_to_image(extracted, source)
            else:
                result[..., :3] = 1.0
                result[..., 3] = extracted.to(device=result.device, dtype=result.dtype)
        else:
            result = _channel_mask_to_image(extracted, source)
        progress.finish()
        return build_node_preview_result(result, (result, extracted), prefix='imageops_channel')
