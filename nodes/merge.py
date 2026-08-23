from comfy_api.latest import io
from ._helpers import MEDIA_INPUT_TYPE, _apply_merge, _apply_mask_to_image, _coerce_media_to_tensor, _prepare_effect_mask, _resolve_mask_output_source, _scalar
from ._progress import start_progress
from ._preview import build_node_preview_result

def _all_zero_mix(mix) -> bool:
    if isinstance(mix, (list, tuple)):
        if len(mix) == 0:
            return True
        return all((_scalar(mix, index=i) <= 0.0 for i in range(len(mix))))
    return _scalar(mix) <= 0.0

class ImageOpsMerge(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsMerge', display_name='〽️ Image Ops Merge', category='image/imageops', search_aliases=['merge', 'blend', 'mix', 'combine', 'over', 'composite'], inputs=[io.MultiType.Input('A', types=[io.Image, io.Video], tooltip='Background Images/Video input.', display_name='Background'), io.MultiType.Input('B', types=[io.Image, io.Video], tooltip='Foreground Images/Video input.', display_name='Foreground'), io.Boolean.Input('bypass', default=False), io.Combo.Input('mode', options=['over', 'add', 'multiply', 'screen', 'overlay', 'soft_light', 'difference', 'lighten', 'darken', 'color_dodge', 'color_burn', 'exclusion'], default='over'), io.Float.Input('mix', default=1.0, min=0.0, max=1.0, step=0.01, round=0.001), io.Combo.Input('foreground_fit', options=['stretch', 'contain', 'fit', 'letterbox', 'pad', 'none', 'center', 'original'], default='stretch'), io.Combo.Input('blend_space', options=['linear', 'srgb'], default='linear'), io.Boolean.Input('invert_mask', default=False), io.Mask.Input('mask', tooltip='Optional mask applied to the merged result', display_name='Mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, A, B, bypass=False, mode='over', mix=1.0, foreground_fit='stretch', blend_space='linear', invert_mask=False, mask=None, unique_id=None, **kwargs):
        A = _coerce_media_to_tensor(A, 'A')
        effect_mask = _prepare_effect_mask(mask, A, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, A, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if _scalar(bypass, bool):
            output_mask = effect_mask if effect_mask is not None else output_mask_source
            progress.finish()
            return build_node_preview_result(A, (A, output_mask), prefix='imageops_merge')
        if _all_zero_mix(mix):
            output_mask = effect_mask if effect_mask is not None else output_mask_source
            progress.finish()
            return build_node_preview_result(A, (A, output_mask), prefix='imageops_merge')
        B = _coerce_media_to_tensor(B, 'B')
        out = _apply_merge(A, B, mode, mix, foreground_fit, blend_space)
        out = _apply_mask_to_image(A, out, effect_mask)
        output_mask = effect_mask if effect_mask is not None else output_mask_source
        progress.finish()
        return build_node_preview_result(out, (out, output_mask), prefix='imageops_merge')