from comfy_api.latest import io
import os
import uuid
import torch
from PIL import Image
import folder_paths
from ._helpers import _alpha_mask_from_image, _coerce_mask_tensor, _mask_to_preview_image, _resize, _scalar, _select_media_tensor, _tensor_batch_to_pil_list, logger
from ._progress import start_progress

def _ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)
    return p

# Cap how many frames get written to disk per execution. Without this, previewing
# a long IMAGE batch (e.g. a video's frames) writes one temp PNG per frame and
# never cleans them up, accumulating unbounded temp-dir files across re-runs.
_MAX_PREVIEW_FRAMES = 16

def save_temp_images(images, prefix='imageops', ext='png', quality=95, max_frames=_MAX_PREVIEW_FRAMES):
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    subfolder = ''
    pil_list = _tensor_batch_to_pil_list(images)
    if max_frames is not None and len(pil_list) > max_frames:
        pil_list = pil_list[:max(1, int(max_frames))]
    ui_items = []
    for idx, img in enumerate(pil_list):
        name = f'{prefix}_{uuid.uuid4().hex[:10]}_{idx:03d}.{ext}'
        out_path = os.path.join(temp_dir, name)
        try:
            if ext.lower() in ('jpg', 'jpeg'):
                img.convert('RGB').save(out_path, quality=_scalar(quality, int), optimize=True)
            elif ext.lower() == 'webp':
                img.save(out_path, quality=_scalar(quality, int), method=6)
            else:
                img.save(out_path)
        except (OSError, ValueError) as e:
            logger.error(f"Failed to save temp image '{out_path}': {e}")
            continue
        ui_items.append({'filename': name, 'subfolder': subfolder, 'type': 'temp'})
    return ui_items

_MAX_PREVIEW_ANIMATED_FRAMES = 240

def save_temp_animated(images, prefix='imageops_anim', ext='webp', fps=12, quality=80, max_frames=_MAX_PREVIEW_ANIMATED_FRAMES):
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    pil_list = _tensor_batch_to_pil_list(images)
    if max_frames is not None and len(pil_list) > max_frames:
        pil_list = pil_list[:max(1, int(max_frames))]
    if not pil_list:
        return None
    name = f'{prefix}_{uuid.uuid4().hex[:10]}.{ext}'
    out_path = os.path.join(temp_dir, name)
    duration_ms = int(max(1, round(1000.0 / max(1.0, _scalar(fps)))))
    try:
        if ext.lower() == 'gif':
            pil_list[0].save(out_path, save_all=True, append_images=pil_list[1:], duration=duration_ms, loop=0, optimize=True)
        else:
            pil_list[0].save(out_path, save_all=True, append_images=pil_list[1:], duration=duration_ms, loop=0, format='WEBP', quality=_scalar(quality, int), method=6)
    except (OSError, ValueError) as e:
        logger.error(f"Failed to save animated preview '{out_path}': {e}")
        return None
    return {'filename': name, 'subfolder': '', 'type': 'temp'}

def save_temp_strip(images, prefix='imageops_strip', ext='png', max_frames=16, tile_height=256, quality=95):
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    pil_list = _tensor_batch_to_pil_list(images)
    if not pil_list:
        return None
    frames = pil_list[:_scalar(max(1, _scalar(max_frames, int)), int)]
    resized = []
    for im in frames:
        try:
            w, h = im.size
            if h <= 0:
                continue
            s = _scalar(tile_height) / float(h)
            nw = max(1, int(round(w * s)))
            resized.append(im.resize((nw, _scalar(tile_height, int)), resample=Image.BILINEAR))
        except Exception:
            continue
    if not resized:
        return None
    total_w = sum((im.size[0] for im in resized))
    out_h = resized[0].size[1]
    strip = Image.new('RGB', (total_w, out_h), (0, 0, 0))
    x = 0
    for im in resized:
        strip.paste(im.convert('RGB'), (x, 0))
        x += im.size[0]
    name = f'{prefix}_{uuid.uuid4().hex[:10]}.{ext}'
    out_path = os.path.join(temp_dir, name)
    try:
        if ext.lower() in ('jpg', 'jpeg'):
            strip.save(out_path, quality=_scalar(quality, int), optimize=True)
        else:
            strip.save(out_path)
    except (OSError, ValueError) as e:
        logger.error(f"Failed to save strip preview '{out_path}': {e}")
        return None
    return {'filename': name, 'subfolder': '', 'type': 'temp'}

_COMPARE_MODES = ['off', 'side_by_side', 'wipe', 'diff']


def _compose_compare(a: torch.Tensor, b: torch.Tensor, mode: str, wipe_position: float) -> torch.Tensor:
    """Build the saved preview thumbnail for an A/B compare, not the passthrough output."""
    if b.shape[1] != a.shape[1] or b.shape[2] != a.shape[2]:
        b = _resize(b, a.shape[2], a.shape[1])
    if b.shape[0] != a.shape[0]:
        b = b[:1].expand(a.shape[0], -1, -1, -1) if b.shape[0] == 1 else b[:a.shape[0]]
    a3 = a[..., :3].clamp(0.0, 1.0)
    b3 = b[..., :3].clamp(0.0, 1.0)
    if mode == 'diff':
        return (a3 - b3).abs().clamp(0.0, 1.0)
    if mode == 'side_by_side':
        return torch.cat([a3, b3], dim=2)
    width = a3.shape[2]
    split = int(round(max(0.0, min(1.0, _scalar(wipe_position))) * width))
    out = a3.clone()
    out[:, :, split:, :] = b3[:, :, split:, :]
    return out


class ImageOpsPreview(io.ComfyNode):
    """
    Preview bridge node:
    - previews IMAGE or MASK input
    - passes IMAGE through to IMAGE output
    - passes MASK through to MASK output
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsPreview', display_name='〽️ Image Ops Preview', category='image/imageops', essentials_category='Image Tools', is_output_node=True, search_aliases=['preview', 'viewer', 'view', 'monitor', 'scope', 'histogram', 'waveform', 'compare', 'a/b'], inputs=[io.Combo.Input('preview_target', options=['auto', 'image', 'mask'], default='auto'), io.Combo.Input('mode', options=['images', 'strip', 'animated_webp', 'animated_gif'], default='images'), io.Combo.Input('compare_mode', options=_COMPARE_MODES, default='off', tooltip='Compare against Image B in the saved preview thumbnail. off previews Image only.'), io.Float.Input('wipe_position', default=0.5, min=0.0, max=1.0, step=0.01, tooltip='Split position for compare_mode=wipe.'), io.MultiType.Input('image', types=[io.Image, io.Video], tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', display_name='Images/Video', optional=True, extra_dict={'forceInput': True}), io.MultiType.Input('image_b', types=[io.Image, io.Video], tooltip='Optional second Images/Video input to compare against, via compare_mode.', display_name='Images/Video B', optional=True, extra_dict={'forceInput': True}), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo])

    @classmethod
    def execute(cls, image=None, preview_target='auto', mode='images', compare_mode='off', wipe_position=0.5, image_b=None, mask=None, prompt=None, extra_pnginfo=None, **kwargs):
        del prompt, extra_pnginfo
        progress = start_progress()
        image_tensor = None
        if image is not None:
            image_tensor = _select_media_tensor(image, None)
        mask_tensor = _coerce_mask_tensor(mask, device=image_tensor.device if image_tensor is not None else None, dtype=image_tensor.dtype if image_tensor is not None else torch.float32)
        if image_tensor is None and mask_tensor is None:
            progress.finish()
            blank_image = torch.zeros(1, 1, 1, 3)
            blank_mask = torch.zeros(1, 1, 1)
            return io.NodeOutput(blank_image, blank_mask, ui={'images': []})
        output_image = image_tensor if image_tensor is not None else _mask_to_preview_image(mask_tensor)
        output_mask = mask_tensor if mask_tensor is not None else _alpha_mask_from_image(output_image)
        target = str(preview_target or 'auto').strip().lower()
        if target == 'mask':
            preview_image = _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)
        elif target == 'image':
            preview_image = output_image
        else:
            preview_image = output_image if image_tensor is not None else _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)
        compare = str(compare_mode or 'off').strip().lower()
        if compare != 'off' and image_b is not None:
            image_b_tensor = _select_media_tensor(image_b, None)
            preview_image = _compose_compare(preview_image, image_b_tensor, compare, _scalar(wipe_position, float))
        if mode == 'strip':
            item = save_temp_strip(preview_image, prefix='imageops_preview', ext='png')
            ui = {'images': [item]} if item else {'images': save_temp_images(preview_image, prefix='imageops_preview')}
        elif mode == 'animated_webp':
            item = save_temp_animated(preview_image, prefix='imageops_preview', ext='webp')
            ui = {'images': [item]} if item else {'images': save_temp_images(preview_image, prefix='imageops_preview')}
        elif mode == 'animated_gif':
            item = save_temp_animated(preview_image, prefix='imageops_preview', ext='gif')
            ui = {'images': [item]} if item else {'images': save_temp_images(preview_image, prefix='imageops_preview')}
        else:
            ui = {'images': save_temp_images(preview_image, prefix='imageops_preview')}
        progress.finish()
        return io.NodeOutput(output_image, output_mask, ui=ui)
