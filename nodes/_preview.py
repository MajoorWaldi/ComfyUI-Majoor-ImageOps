def build_node_preview_result(_images, result, prefix=None, fps=None, metadata=None):  # noqa: ARG001
    if metadata is not None:
        return {
            "ui": metadata,
            "result": result,
        }
    return result
