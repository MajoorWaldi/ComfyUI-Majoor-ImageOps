from comfy_api.latest import io
from ._helpers import ASPECT_RATIO_PRESETS, _apply_interactive_crop_resize, _apply_interactive_crop_resize_with_mask_pair, _compute_crop_box, _prepare_effect_mask, _resolve_mask_output_source, _scalar, _select_media_tensor
from ._progress import start_progress
from ._preview import build_node_preview_result

def _list_param_length(*values):
    lengths = [len(value) for value in values if isinstance(value, (list, tuple))]
    return max(lengths) if lengths else 1

def _is_noop_crop(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
    """Return True only when every frame's crop box maps to the full source and output size unchanged.

    Uses _compute_crop_box as the single geometric source of truth — avoids the
    previous bug where aspect_ratio='1:1' on a 1920×1080 source was incorrectly
    classified as a no-op when output W/H happened to equal source W/H.
    """
    if source is None or source.dim() != 4:
        return False
    source_h = int(source.shape[1])
    source_w = int(source.shape[2])
    count = _list_param_length(width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
    for index in range(count):
        target_w = max(1, _scalar(width, int, index=index))
        target_h = max(1, _scalar(height, int, index=index))
        ratio = _scalar(aspect_ratio, str, index=index)
        center_x = _scalar(crop_center_x, index=index)
        center_y = _scalar(crop_center_y, index=index)
        scale = _scalar(crop_scale, index=index)
        crop_x, crop_y, crop_w, crop_h = _compute_crop_box(source_w, source_h, ratio, target_w, target_h, center_x=center_x, center_y=center_y, scale=scale)
        if crop_x != 0 or crop_y != 0 or crop_w != source_w or (crop_h != source_h) or (target_w != source_w) or (target_h != source_h):
            return False
    return True

def _crop_bbox_payload(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
    """Per-frame crop geometry in source coordinates. Consumed by Crop Stitch's
    optional bbox input, and mirrored into UI metadata for the frontend preview."""
    if source is None or source.dim() != 4:
        return None
    source_h = int(source.shape[1])
    source_w = int(source.shape[2])
    count = int(source.shape[0])
    frames = []
    for index in range(count):
        target_w = max(1, _scalar(width, int, index=index))
        target_h = max(1, _scalar(height, int, index=index))
        ratio = _scalar(aspect_ratio, str, index=index)
        center_x = _scalar(crop_center_x, index=index)
        center_y = _scalar(crop_center_y, index=index)
        scale = _scalar(crop_scale, index=index)
        crop_x, crop_y, crop_w, crop_h = _compute_crop_box(source_w, source_h, ratio, target_w, target_h, center_x=center_x, center_y=center_y, scale=scale)
        frames.append({'frame': index, 'x': crop_x, 'y': crop_y, 'width': crop_w, 'height': crop_h, 'source_width': source_w, 'source_height': source_h, 'target_width': target_w, 'target_height': target_h, 'aspect_ratio': ratio, 'center_x': center_x, 'center_y': center_y, 'scale': scale})
    return {'type': 'bbox', 'coordinate_space': 'source', 'bbox': frames[0] if frames else None, 'frames': frames}



def _core_bbox(payload):
    """First-frame rectangle as ComfyUI's BOUNDING_BOX dict."""
    frame = payload['bbox'] if payload else None
    if frame is None:
        return None
    return {'x': int(frame['x']), 'y': int(frame['y']), 'width': int(frame['width']), 'height': int(frame['height'])}


class ImageOpsCrop(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsCrop', display_name='〽️ Image Ops Crop', category='image/imageops', essentials_category='Image Tools', search_aliases=['crop', 'resize', 'reformat', 'format', 'recadrer', 'taille'], inputs=[io.Boolean.Input('bypass', default=False), io.Combo.Input('aspect_ratio', options=['custom', '1:1', '3:4', '4:3', '16:9', '9:16'], default='1:1'), io.Int.Input('width', default=1024, min=1, max=8192, step=1), io.Int.Input('height', default=1024, min=1, max=8192, step=1), io.Boolean.Input('sync_dimensions', default=True, label_on='Linked', label_off='Free'), io.Float.Input('crop_center_x', default=0.5, min=0.0, max=1.0, step=0.001), io.Float.Input('crop_center_y', default=0.5, min=0.0, max=1.0, step=0.001), io.Float.Input('crop_scale', default=1.0, min=0.05, max=1.0, step=0.001), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', tooltip='Optional mask to crop with the image using identical geometry.', display_name='Mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask'), io.Custom('IMAGEOPS_BBOX').Output('bbox', display_name='bbox', tooltip='Per-frame crop geometry in source coordinates. Connect to Crop Stitch to place the result precisely instead of estimating it from a mask.'), io.BoundingBox.Output('bounding_box', display_name='bounding_box', tooltip='First-frame crop rectangle in source pixels, using the core BOUNDING_BOX type so it also feeds core bounding box nodes.')])

    @classmethod
    def execute(cls, image=None, bypass=False, aspect_ratio='1:1', width=1024, height=1024, sync_dimensions=True, video=None, mask=None, crop_center_x=0.5, crop_center_y=0.5, crop_scale=1.0, **kwargs):
        del sync_dimensions
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source)
        output_mask_source = _resolve_mask_output_source(mask, source)
        progress = start_progress()
        if _scalar(bypass, bool):
            progress.finish()
            source_h, source_w = int(source.shape[1]), int(source.shape[2])
            bbox = _crop_bbox_payload(source, source_w, source_h, 'custom', 0.5, 0.5, 1.0)
            metadata = {'imageops_crop_bbox': bbox} if bbox is not None else None
            return build_node_preview_result(source, (source, output_mask_source, bbox, _core_bbox(bbox)), prefix='imageops_crop', metadata=metadata)
        if _is_noop_crop(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
            progress.finish()
            bbox = _crop_bbox_payload(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
            metadata = {'imageops_crop_bbox': bbox} if bbox is not None else None
            return build_node_preview_result(source, (source, output_mask_source, bbox, _core_bbox(bbox)), prefix='imageops_crop', metadata=metadata)
        if input_mask is not None:
            result, output_mask = _apply_interactive_crop_resize_with_mask_pair(source, input_mask, width, height, aspect_ratio, center_x=crop_center_x, center_y=crop_center_y, scale=crop_scale)
        else:
            result = _apply_interactive_crop_resize(source, width, height, aspect_ratio, center_x=crop_center_x, center_y=crop_center_y, scale=crop_scale)
            output_mask = _apply_interactive_crop_resize(output_mask_source.unsqueeze(-1), width, height, aspect_ratio, center_x=crop_center_x, center_y=crop_center_y, scale=crop_scale, resize_mode='bilinear', antialias=True)[..., 0]
        progress.finish()
        bbox = _crop_bbox_payload(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
        metadata = {'imageops_crop_bbox': bbox} if bbox is not None else None
        return build_node_preview_result(result, (result, output_mask, bbox, _core_bbox(bbox)), prefix='imageops_crop', metadata=metadata)
