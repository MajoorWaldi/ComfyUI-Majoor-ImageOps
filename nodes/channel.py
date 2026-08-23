from comfy_api.latest import io
from ._helpers import CHANNEL_OPTIONS, MEDIA_INPUT_TYPE, _alpha_mask_from_image, _channel_mask_to_image, _extract_channel_mask, _scalar, _select_media_tensor
from .compat.comfy_v3 import V3NodeBase
from ._progress import start_progress
from ._preview import build_node_preview_result

class ImageOpsChannel(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsChannel', display_name='〽️ Image Ops Channel', category='image/imageops', search_aliases=['channel', 'channels', 'rgb', 'alpha', 'red', 'green', 'blue'], inputs=[io.Boolean.Input('bypass', default=False), io.Combo.Input('channel', options=['Red', 'Green', 'Blue', 'Alpha'], default='Red'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True})], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, bypass=False, channel='Red', video=None, unique_id=None, **kwargs):
        source = _select_media_tensor(image, video)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = _alpha_mask_from_image(source)
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix='imageops_channel')
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
