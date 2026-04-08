def build_node_preview_result(images, result, prefix="imageops_preview", fps=12, metadata=None):
    del images, prefix, fps
    if metadata is not None:
        return {
            "ui": metadata,
            "result": result,
        }
    return result
