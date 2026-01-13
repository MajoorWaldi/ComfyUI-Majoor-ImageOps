from ._helpers import _apply_crop_reformat, _apply_mask_to_image, _select_media_tensor

class ImageOpsCropReformat:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "apply"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE",),
                "x": ("INT", {"default": 0, "min": -16384, "max": 16384, "step": 1}),
                "y": ("INT", {"default": 0, "min": -16384, "max": 16384, "step": 1}),
                "crop_w": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
                "crop_h": ("INT", {"default": 512, "min": 1, "max": 16384, "step": 1}),
                "padding": ("INT", {"default": 0, "min": 0, "max": 4096, "step": 1}),
                "pad_mode": (["reflect", "replicate", "constant"], {"default": "reflect"}),
                "out_w": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1, "tooltip": "0 = keep crop size"}),
                "out_h": ("INT", {"default": 0, "min": 0, "max": 16384, "step": 1, "tooltip": "0 = keep crop size"}),
                "mode": (["fit", "fill", "stretch"], {"default": "fit"}),
            },
            "optional": {
                "video": ("IMAGE", {"tooltip": "Video frames (alias for image input)", "forceInput": True}),
                "mask": ("MASK",),
            }
        }

    def apply(self, image=None, x=0, y=0, crop_w=512, crop_h=512, padding=0, pad_mode="reflect", out_w=0, out_h=0, mode="fit", video=None, mask=None):
        src = _select_media_tensor(image, video)
        out = _apply_crop_reformat(src, x, y, crop_w, crop_h, padding, pad_mode, out_w, out_h, mode)
        out = _apply_mask_to_image(src, out, mask)
        return (out,)