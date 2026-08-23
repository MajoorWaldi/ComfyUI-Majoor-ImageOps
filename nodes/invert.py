from comfy_api.latest import io
from ._helpers import MEDIA_INPUT_TYPE, _apply_invert, _resolve_mask_output_source, _scalar, _select_media_tensor
from .compat.comfy_v3 import V3NodeBase
from ._progress import start_progress
from ._preview import build_node_preview_result

class ImageOpsInvert(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsInvert', display_name='〽️ Image Ops Invert', category='image/imageops', search_aliases=['invert', 'negative', 'alpha invert', 'reverse'], inputs=[io.Boolean.Input('bypass', default=False), io.Boolean.Input('invert_mask', default=False), io.Boolean.Input('invert_alpha', default=False, tooltip='Also invert the alpha channel (only applies to RGBA images).'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, bypass=False, invert_mask=False, invert_alpha=False, video=None, mask=None, unique_id=None, **kwargs):
        src = _select_media_tensor(image, video)
        output_mask = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(src, (src, output_mask), prefix='imageops_invert')
        out = _apply_invert(src, invert_alpha=_scalar(invert_alpha, bool))
        progress.finish()
        return build_node_preview_result(out, (out, output_mask), prefix='imageops_invert')
