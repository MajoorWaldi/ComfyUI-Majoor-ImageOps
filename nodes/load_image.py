import os
from PIL import Image, ImageOps

import folder_paths

from ._helpers import (
    ALLOWED_EXTENSIONS,
    MAX_IMAGE_DIMENSION,
    logger,
    _pil_to_tensor,
)


class ImageOpsLoadImage:
    CATEGORY = "image/imageops"
    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "load"

    @classmethod
    def INPUT_TYPES(cls):
        input_dir = folder_paths.get_input_directory()
        try:
            files = [f for f in os.listdir(input_dir) if os.path.isfile(os.path.join(input_dir, f))]
        except OSError as e:
            logger.error(f"Failed to list input directory '{input_dir}': {e}")
            files = []
        except Exception as e:
            logger.error(f"Unexpected error listing input directory: {e}")
            files = []
        return {
            "required": {
                "image": (sorted(files), {"image_upload": True}),
            }
        }

    @classmethod
    def VALIDATE_INPUTS(cls, image):
        if not folder_paths.exists_annotated_filepath(image):
            return f"Invalid image file: {image}"

        image_clean = image.split('[')[0].strip()
        _, ext = os.path.splitext(image_clean.lower())
        if ext not in ALLOWED_EXTENSIONS:
            return f"Unsupported file extension: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"

        try:
            image_path = folder_paths.get_annotated_filepath(image)
            file_size = os.path.getsize(image_path)
            max_size = 500 * 1024 * 1024
            if file_size > max_size:
                return f"File too large: {file_size / 1024 / 1024:.1f} MB (max {max_size / 1024 / 1024} MB)"
        except Exception as e:
            logger.warning(f"Could not check file size for {image}: {e}")

        return True

    def load(self, image: str):
        try:
            image_path = folder_paths.get_annotated_filepath(image)
            img = Image.open(image_path)

            width, height = img.size
            if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
                logger.warning(f"Image dimensions ({width}x{height}) exceed maximum ({MAX_IMAGE_DIMENSION}x{MAX_IMAGE_DIMENSION})")
                raise ValueError(f"Image too large: {width}x{height} (max {MAX_IMAGE_DIMENSION}x{MAX_IMAGE_DIMENSION})")

            try:
                img = ImageOps.exif_transpose(img)
            except Exception as e:
                logger.warning(f"Failed to apply EXIF orientation for {image}: {e}")

            return (_pil_to_tensor(img),)
        except FileNotFoundError:
            logger.error(f"Image file not found: {image}")
            raise
        except Image.UnidentifiedImageError:
            logger.error(f"Could not identify image file {image}")
            raise
        except Exception as e:
            logger.error(f"Failed to load image {image}: {e}")
            raise
