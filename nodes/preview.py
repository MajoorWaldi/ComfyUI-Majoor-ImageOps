from comfy_api.latest import io
import os
import uuid
import torch
from PIL import Image
import folder_paths
from ._helpers import MEDIA_INPUT_TYPE, _alpha_mask_from_image, _coerce_mask_tensor, _mask_to_preview_image, _scalar, _select_media_tensor, _tensor_batch_to_pil_list, logger
from ._progress import start_progress

def _ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)
    return p

def save_temp_images(images, prefix='imageops', ext='png', quality=95):
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    subfolder = ''
    pil_list = _tensor_batch_to_pil_list(images)
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
        except Exception as e:
            logger.error(f"Failed to save temp image '{out_path}': {e}")
            continue
        ui_items.append({'filename': name, 'subfolder': subfolder, 'type': 'temp'})
    return ui_items

def save_temp_animated(images, prefix='imageops_anim', ext='webp', fps=12, quality=80):
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    pil_list = _tensor_batch_to_pil_list(images)
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
    except Exception as e:
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
    except Exception as e:
        logger.error(f"Failed to save strip preview '{out_path}': {e}")
        return None
    return {'filename': name, 'subfolder': '', 'type': 'temp'}

class ImageOpsPreview(io.ComfyNode):
    """
    Preview bridge node:
    - previews IMAGE or MASK input
    - passes IMAGE through to IMAGE output
    - passes MASK through to MASK output
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsPreview', display_name='〽️ Image Ops Preview', category='image/imageops', inputs=[io.String.Input('preview_target', default='auto'), io.String.Input('mode', default='images'), io.String.Input('image', tooltip='Images/Video input. Accepts IMAGE batches and VIDEO frame sources.', force_input=True, display_name='Images/Video', optional=True), io.Mask.Input('mask', optional=True)], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo, io.Hidden.unique_id])

    @classmethod
    def execute(cls, image=None, preview_target='auto', mode='images', mask=None, prompt=None, extra_pnginfo=None, unique_id=None, **kwargs):
        del prompt, extra_pnginfo
        progress = start_progress(unique_id=unique_id)
        image_tensor = None
        if image is not None:
            image_tensor = _select_media_tensor(image, None)
        mask_tensor = _coerce_mask_tensor(mask, device=image_tensor.device if image_tensor is not None else None, dtype=image_tensor.dtype if image_tensor is not None else torch.float32)
        if image_tensor is None and mask_tensor is None:
            progress.finish()
            blank_image = torch.zeros(1, 1, 1, 3)
            blank_mask = torch.zeros(1, 1, 1)
            return {'ui': {'images': []}, 'result': (blank_image, blank_mask)}
        output_image = image_tensor if image_tensor is not None else _mask_to_preview_image(mask_tensor)
        output_mask = mask_tensor if mask_tensor is not None else _alpha_mask_from_image(output_image)
        target = str(preview_target or 'auto').strip().lower()
        if target == 'mask':
            preview_image = _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)
        elif target == 'image':
            preview_image = output_image
        else:
            preview_image = output_image if image_tensor is not None else _mask_to_preview_image(output_mask, device=output_image.device, dtype=output_image.dtype)
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
        return {'ui': ui, 'result': (output_image, output_mask)}