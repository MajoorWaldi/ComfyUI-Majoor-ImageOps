from comfy_api.latest import io
from ._helpers import _apply_invert, _resolve_mask_output_source, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result
from .core.video_io import extract_video_fps_audio, media_to_video

class ImageOpsInvert(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsInvert', display_name='〽️ Image Ops Invert', category='image/imageops', essentials_category='Image Tools', search_aliases=['invert', 'negative', 'alpha invert', 'reverse'], inputs=[io.Boolean.Input('bypass', default=False), io.Boolean.Input('invert_mask', default=False), io.Boolean.Input('invert_alpha', default=False, tooltip='Also invert the alpha channel (only applies to RGBA images).'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask'), io.Video.Output('video', display_name='video', tooltip='Native VIDEO output. Carries the real audio/fps when a VIDEO (not a plain IMAGE batch) was connected.')])

    @classmethod
    def execute(cls, image=None, bypass=False, invert_mask=False, invert_alpha=False, video=None, mask=None, **kwargs):
        src = _select_media_tensor(image, video, working_set=3)
        fps, audio, sample_rate = extract_video_fps_audio(image)
        output_mask = _resolve_mask_output_source(mask, src, invert_mask=invert_mask)
        progress = start_progress()
        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(src, (src, output_mask, media_to_video(src, fps, audio, sample_rate)), prefix='imageops_invert')
        out = _apply_invert(src, invert_alpha=_scalar(invert_alpha, bool))
        progress.finish()
        return build_node_preview_result(out, (out, output_mask, media_to_video(out, fps, audio, sample_rate)), prefix='imageops_invert')
