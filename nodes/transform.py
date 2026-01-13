from PIL import Image

from ._helpers import (
    _apply_mask_to_image,
    _pil_to_tensor,
    _select_media_tensor,
    _tensor_to_pil,
    EPSILON,
    LARGE_IMAGE_WARN_MB,
    MAX_SCALE_DIMENSION,
    logger,
)


class ImageOpsTransform:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "translate_x": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "translate_y": ("INT", {"default": 0, "min": -4096, "max": 4096, "step": 1}),
                "rotate_deg": ("FLOAT", {"default": 0.0, "min": -180.0, "max": 180.0, "step": 0.1, "display": "slider", "round": 0.001}),
                "scale": ("FLOAT", {"default": 1.0, "min": 0.01, "max": 8.0, "step": 0.01, "display": "slider", "round": 0.001}),
                "filter": (["nearest", "bilinear", "bicubic"],),
                "expand": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image, translate_x, translate_y, rotate_deg, scale, filter, expand, video=None, mask=None):
        source = _select_media_tensor(image, video)
        pil = _tensor_to_pil(source)

        resample = {
            "nearest": Image.NEAREST,
            "bilinear": Image.BILINEAR,
            "bicubic": Image.BICUBIC,
        }.get(filter, Image.BILINEAR)

        if abs(scale - 1.0) > EPSILON:
            w, h = pil.size
            nw, nh = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
            if nw > MAX_SCALE_DIMENSION or nh > MAX_SCALE_DIMENSION:
                logger.error(f"Scaled dimensions ({nw}x{nh}) exceed maximum ({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION})")
                raise ValueError(
                    f"Resulting image size ({nw}x{nh}) would exceed maximum allowed dimensions "
                    f"({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION}). "
                    f"Original: {w}x{h}, Scale: {scale:.2f}"
                )

            estimated_mb = (nw * nh * 4) / (1024 * 1024)
            if estimated_mb > float(LARGE_IMAGE_WARN_MB):
                logger.warning(f"Large image allocation: {nw}x{nh} (~{estimated_mb:.1f} MB) > {LARGE_IMAGE_WARN_MB} MB")

            pil = pil.resize((nw, nh), resample=resample)

        if abs(rotate_deg) > EPSILON:
            pil = pil.rotate(rotate_deg, resample=resample, expand=bool(expand))
            if expand:
                w, h = pil.size
                if w > MAX_SCALE_DIMENSION or h > MAX_SCALE_DIMENSION:
                    logger.error(f"Rotated dimensions with expand ({w}x{h}) exceed maximum")
                    raise ValueError(f"Rotated image size ({w}x{h}) exceeds maximum ({MAX_SCALE_DIMENSION}x{MAX_SCALE_DIMENSION})")

        if translate_x != 0 or translate_y != 0:
            mode = pil.mode
            bg = (0, 0, 0, 0) if mode == "RGBA" else (0, 0, 0)
            canvas = Image.new(mode, pil.size, bg)
            canvas.paste(pil, (translate_x, translate_y))
            pil = canvas

        processed = _pil_to_tensor(pil)
        return (_apply_mask_to_image(source, processed, mask),)
