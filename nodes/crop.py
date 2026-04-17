from ._helpers import (
    ASPECT_RATIO_PRESETS,
    MEDIA_INPUT_TYPE,
    _apply_interactive_crop_resize,
    _apply_interactive_crop_resize_with_mask_pair,
    _compute_crop_box,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from ._progress import start_progress
from ._preview import build_node_preview_result


def _list_param_length(*values):
    lengths = [len(value) for value in values if isinstance(value, (list, tuple))]
    return max(lengths) if lengths else 1


def _is_noop_crop(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
    if source is None or source.dim() != 4:
        return False
    count = _list_param_length(width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
    for index in range(count):
        target_w = max(1, _scalar(width, int, index=index))
        target_h = max(1, _scalar(height, int, index=index))
        if int(source.shape[2]) != target_w or int(source.shape[1]) != target_h:
            return False
        if abs(_scalar(crop_center_x, index=index) - 0.5) > 1e-6 or abs(_scalar(crop_center_y, index=index) - 0.5) > 1e-6:
            return False
        if abs(_scalar(crop_scale, index=index) - 1.0) > 1e-6:
            return False
        if str(_scalar(aspect_ratio, str, index=index)).lower() not in ASPECT_RATIO_PRESETS:
            return False
    return True


def _crop_bbox_metadata(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
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
        crop_x, crop_y, crop_w, crop_h = _compute_crop_box(
            source_w,
            source_h,
            ratio,
            target_w,
            target_h,
            center_x=center_x,
            center_y=center_y,
            scale=scale,
        )
        frames.append({
            "frame": index,
            "x": crop_x,
            "y": crop_y,
            "width": crop_w,
            "height": crop_h,
            "source_width": source_w,
            "source_height": source_h,
            "target_width": target_w,
            "target_height": target_h,
            "aspect_ratio": ratio,
            "center_x": center_x,
            "center_y": center_y,
            "scale": scale,
        })
    return {
        "imageops_crop_bbox": {
            "type": "bbox",
            "coordinate_space": "source",
            "bbox": frames[0] if frames else None,
            "frames": frames,
        }
    }


class ImageOpsCrop:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("image", "mask")
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        aspect_options = list(ASPECT_RATIO_PRESETS.keys())
        return {
            "required": {
                "bypass": ("BOOLEAN", {"default": False}),
                "aspect_ratio": (aspect_options, {"default": "1:1"}),
                "width": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "height": ("INT", {"default": 1024, "min": 1, "max": 8192, "step": 1}),
                "sync_dimensions": ("BOOLEAN", {"default": True, "label_on": "Linked", "label_off": "Free"}),
                "crop_center_x": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "crop_center_y": ("FLOAT", {"default": 0.5, "min": 0.0, "max": 1.0, "step": 0.001}),
                "crop_scale": ("FLOAT", {"default": 1.0, "min": 0.05, "max": 1.0, "step": 0.001}),
                "invert_mask": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "image": (MEDIA_INPUT_TYPE, {"tooltip": "Images/Video input. Accepts IMAGE batches and VIDEO frame sources.", "forceInput": True, "display_name": "Images/Video"}),
                "mask": ("MASK",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    def apply(self, image=None, bypass=False, aspect_ratio="1:1", width=1024, height=1024,
              sync_dimensions=True, invert_mask=False, video=None, mask=None, crop_center_x=0.5, crop_center_y=0.5, crop_scale=1.0, unique_id=None):
        del sync_dimensions  # UI-only link/free toggle used by the frontend preview controls.
        source = _select_media_tensor(image, video)
        input_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask_source = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)

        if _scalar(bypass, bool):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_crop")
        if _is_noop_crop(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale):
            progress.finish()
            metadata = _crop_bbox_metadata(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
            return build_node_preview_result(source, (source, output_mask_source), prefix="imageops_crop", metadata=metadata)

        if input_mask is not None:
            result, output_mask = _apply_interactive_crop_resize_with_mask_pair(
                source,
                input_mask,
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
            )
        else:
            result = _apply_interactive_crop_resize(
                source,
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
            )
            output_mask = _apply_interactive_crop_resize(
                output_mask_source.unsqueeze(-1),
                width,
                height,
                aspect_ratio,
                center_x=crop_center_x,
                center_y=crop_center_y,
                scale=crop_scale,
                resize_mode="bilinear",
                antialias=True,
            )[..., 0]
        progress.finish()
        metadata = _crop_bbox_metadata(source, width, height, aspect_ratio, crop_center_x, crop_center_y, crop_scale)
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_crop", metadata=metadata)
