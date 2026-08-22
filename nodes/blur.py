from comfy_api.latest import io
from ._helpers import _apply_mask_to_image, _apply_blur_with_mask_pair, _dispatch_blur, _gaussian_effective_radius, MEDIA_INPUT_TYPE, _prepare_effect_mask, _resolve_mask_output_source, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result
_BLUR_TYPES = ['gaussian', 'box', 'defocus', 'surface']

def _blur_is_noop(radius) -> bool:
    """All blur types are no-ops when radius is zero for every frame."""
    if isinstance(radius, (list, tuple)):
        r_len = len(radius)
        if r_len <= 0:
            return True
        return all((int(max(0, _scalar(radius, int, index=i))) <= 0 for i in range(r_len)))
    return int(max(0, _scalar(radius, int))) <= 0

class ImageOpsBlur(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsBlur', display_name='〽️ Image Ops Blur', category='image/imageops', inputs=[io.Boolean.Input('bypass', default=False), io.String.Input('blur_type', default='gaussian'), io.Int.Input('radius', default=3, min=0, max=128, step=1, tooltip='Blur extent in pixels. 0 = no blur (disables all types).'), io.Float.Input('sigma', default=0.0, min=0.0, max=64.0, step=0.01, round=0.001, tooltip='gaussian: Gaussian std-dev in pixels (0 = auto, radius/3). surface: colour-similarity threshold 0–1 (0 = auto ≈0.15). box / defocus: unused.'), io.Boolean.Input('invert_mask', default=False), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, bypass=False, blur_type='gaussian', radius=3, sigma=0.0, invert_mask=False, mask=None, unique_id=None, **kwargs):
        source = _select_media_tensor(image, None)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if isinstance(bypass, (list, tuple)):
            all_bypassed = all((_scalar(bypass, bool, index=i) for i in range(max(len(bypass), 1))))
        else:
            all_bypassed = bool(bypass)
        if all_bypassed:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix='imageops_blur')
        if _blur_is_noop(radius):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix='imageops_blur')
        from .core.memory import check_budget
        if source is not None:
            check_budget(int(source.shape[0]), int(source.shape[1]), int(source.shape[2]), int(source.shape[3]), multiplier=3.0, label='ImageOps Blur')
        bt = str(blur_type) if blur_type in _BLUR_TYPES else 'gaussian'
        if input_mask is not None:
            result, blurred_mask = _apply_blur_with_mask_pair(source, input_mask, radius, sigma, blur_type=bt)
            result = _apply_mask_to_image(source, result, blurred_mask)
            output_mask = output_mask_source
        else:
            result = _dispatch_blur(source, radius, sigma, blur_type=bt)
            output_mask = output_mask_source
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix='imageops_blur')
