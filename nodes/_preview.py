import os
import uuid
from PIL import Image

import folder_paths

from ._helpers import _scalar, _tensor_batch_to_pil_list, logger


def _ensure_dir(p: str):
    os.makedirs(p, exist_ok=True)
    return p


def save_temp_images(images, prefix="imageops", ext="png", quality=95):
    """
    Save a batch of IMAGE tensors to ComfyUI's temp directory and return UI dict entries.
    Returns: list[dict] -> {"filename","subfolder","type"}
    """
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    subfolder = ""  # temp is already a separate bucket in comfy
    pil_list = _tensor_batch_to_pil_list(images)

    ui_items = []
    for idx, img in enumerate(pil_list):
        name = f"{prefix}_{uuid.uuid4().hex[:10]}_{idx:03d}.{ext}"
        out_path = os.path.join(temp_dir, name)
        try:
            if ext.lower() in ("jpg", "jpeg"):
                img.convert("RGB").save(out_path, quality=_scalar(quality, int), optimize=True)
            elif ext.lower() == "webp":
                # WEBP can be used as static preview too
                img.save(out_path, quality=_scalar(quality, int), method=6)
            else:
                img.save(out_path)
        except Exception as e:
            logger.error(f"Failed to save temp image '{out_path}': {e}")
            continue

        ui_items.append({"filename": name, "subfolder": subfolder, "type": "temp"})
    return ui_items


def save_temp_animated(images, prefix="imageops_anim", ext="webp", fps=12, quality=80):
    """
    Save IMAGE batch as an animated WEBP (or GIF) in temp for node UI preview.
    """
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    pil_list = _tensor_batch_to_pil_list(images)
    if not pil_list:
        return None

    name = f"{prefix}_{uuid.uuid4().hex[:10]}.{ext}"
    out_path = os.path.join(temp_dir, name)
    duration_ms = int(max(1, round(1000.0 / max(1.0, _scalar(fps)))))

    try:
        if ext.lower() == "gif":
            pil_list[0].save(
                out_path,
                save_all=True,
                append_images=pil_list[1:],
                duration=duration_ms,
                loop=0,
                optimize=True,
            )
        else:
            # animated WEBP
            pil_list[0].save(
                out_path,
                save_all=True,
                append_images=pil_list[1:],
                duration=duration_ms,
                loop=0,
                format="WEBP",
                quality=_scalar(quality, int),
                method=6,
            )
    except Exception as e:
        logger.error(f"Failed to save animated preview '{out_path}': {e}")
        return None

    return {"filename": name, "subfolder": "", "type": "temp"}


def save_temp_strip(images, prefix="imageops_strip", ext="png", max_frames=16, tile_height=256, quality=95):
    """
    Save IMAGE batch as a single horizontal strip image for quick UI inspection.
    """
    temp_dir = _ensure_dir(folder_paths.get_temp_directory())
    pil_list = _tensor_batch_to_pil_list(images)
    if not pil_list:
        return None

    frames = pil_list[: _scalar(max(1, _scalar(max_frames, int)), int)]
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

    total_w = sum(im.size[0] for im in resized)
    out_h = resized[0].size[1]
    strip = Image.new("RGB", (total_w, out_h), (0, 0, 0))
    x = 0
    for im in resized:
        strip.paste(im.convert("RGB"), (x, 0))
        x += im.size[0]

    name = f"{prefix}_{uuid.uuid4().hex[:10]}.{ext}"
    out_path = os.path.join(temp_dir, name)
    try:
        if ext.lower() in ("jpg", "jpeg"):
            strip.save(out_path, quality=_scalar(quality, int), optimize=True)
        else:
            strip.save(out_path)
    except Exception as e:
        logger.error(f"Failed to save strip preview '{out_path}': {e}")
        return None

    return {"filename": name, "subfolder": "", "type": "temp"}


def build_node_preview_ui(images, prefix="imageops_preview", fps=12):
    """
    Build a ComfyUI-native preview payload for intermediate nodes.

    For batches we prefer a single animated WEBP so both legacy frontend and
    Node 2.0 can expose one preview source through ``node.imgs``.
    """
    batch = 0
    try:
        batch = int(images.shape[0])
    except Exception:
        batch = 0

    if batch > 1:
        animated = save_temp_animated(images, prefix=prefix, ext="webp", fps=fps)
        if animated:
            return {"images": [animated], "animated": (True,)}

        strip = save_temp_strip(images, prefix=prefix, ext="png")
        if strip:
            return {"images": [strip]}

    return {"images": save_temp_images(images, prefix=prefix)}


def build_node_preview_result(images, result, prefix="imageops_preview", fps=12):
    return {
        "ui": build_node_preview_ui(images, prefix=prefix, fps=fps),
        "result": result,
    }
