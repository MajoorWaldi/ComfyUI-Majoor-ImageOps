from comfy_api.latest import io
from ._helpers import _apply_clamp, _clamp_mask, _resolve_mask_output_source, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result
from .core.video_io import extract_video_fps_audio, media_to_video

class ImageOpsClamp(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsClamp', display_name='〽️ Image Ops Clamp', category='image/imageops', essentials_category='Image Tools', search_aliases=['clamp', 'clip', 'limit', 'range'], inputs=[io.Boolean.Input('bypass', default=False), io.Float.Input('min_v', default=0.0, min=-10.0, max=10.0, step=0.01, round=0.001, tooltip='Minimum output value. Values below this are clamped up.'), io.Float.Input('max_v', default=1.0, min=-10.0, max=10.0, step=0.01, round=0.001, tooltip='Maximum output value. Values above this are clamped down.'), io.Boolean.Input('invert_mask', default=False), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask'), io.Video.Output('video', display_name='video', tooltip='Native VIDEO output. Carries the real audio/fps when a VIDEO (not a plain IMAGE batch) was connected.')])

    @classmethod
    def execute(cls, image=None, bypass=False, min_v=0.0, max_v=1.0, invert_mask=False, video=None, mask=None, **kwargs):
        src = _select_media_tensor(image, video, working_set=3)
        fps, audio, sample_rate = extract_video_fps_audio(image)
        output_mask_source = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        progress = start_progress()
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(src, (src, output_mask_source, media_to_video(src, fps, audio, sample_rate)), prefix='imageops_clamp')
        out = _apply_clamp(src, min_v, max_v)
        output_mask = _clamp_mask(output_mask_source, min_v, max_v)
        progress.finish()
        return build_node_preview_result(out, (out, output_mask, media_to_video(out, fps, audio, sample_rate)), prefix='imageops_clamp')
