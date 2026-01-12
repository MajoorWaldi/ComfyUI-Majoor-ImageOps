"""
ComfyUI-ImageOps
MVP “Nuke-ish” image ops pack with live (frontend) embedded preview.

v2 fix:
- ImageOpsLoadImage no longer uses folder_paths.get_filename_list("input") (KeyError).
- ImageOpsLoadImage uses image_upload widget like core Load Image.
- Live preview can start from ImageOpsLoadImage OR core LoadImage.
"""

from .nodes import (
    ImageOpsLoadImage,
    ImageOpsColorCorrect,
    ImageOpsBlur,
    ImageOpsTransform,
    ImageOpsRotoMask,

    ImageOpsGradeLevels,
    ImageOpsHueSat,
    ImageOpsInvert,
    ImageOpsClamp,
    ImageOpsSharpen,
    ImageOpsEdgeDetect,
    ImageOpsMerge,
    ImageOpsDilateErode,
    ImageOpsGlow,
    ImageOpsCropReformat,
    ImageOpsLumaKey,
    ImageOpsPreview,
)

WEB_DIRECTORY = "./js"

# NODE_CONFIG style (as requested)
NODE_CONFIG = [
    (ImageOpsLoadImage, "ImageOps Load Image"),
    (ImageOpsColorCorrect, "ImageOps ColorCorrect (Live)"),
    (ImageOpsBlur, "ImageOps Blur (Live)"),
    (ImageOpsTransform, "ImageOps Transform (Live)"),
    (ImageOpsRotoMask, "ImageOps Roto Mask (Live)"),

    (ImageOpsGradeLevels, "ImageOps Grade / Levels (Live)"),
    (ImageOpsHueSat, "ImageOps Hue / Sat (Live)"),
    (ImageOpsInvert, "ImageOps Invert (Live)"),
    (ImageOpsClamp, "ImageOps Clamp (Live)"),
    (ImageOpsSharpen, "ImageOps Sharpen (Live)"),
    (ImageOpsEdgeDetect, "ImageOps Edge Detect (Live)"),
    (ImageOpsMerge, "ImageOps Merge (Live-ish)"),
    (ImageOpsDilateErode, "ImageOps Dilate / Erode (Mask)"),
    (ImageOpsGlow, "ImageOps Glow (Live)"),
    (ImageOpsCropReformat, "ImageOps Crop / Reformat (Live)"),
    (ImageOpsLumaKey, "ImageOps LumaKey"),
    (ImageOpsPreview, "ImageOps Preview (Output)"),
]

def generate_node_mappings(config):
    node_class_mappings = {}
    node_display_name_mappings = {}
    for cls, display_name in config:
        node_class_mappings[cls.__name__] = cls
        node_display_name_mappings[cls.__name__] = display_name
    return node_class_mappings, node_display_name_mappings

NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS = generate_node_mappings(NODE_CONFIG)

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
