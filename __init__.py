from comfy_api.latest import ComfyExtension

from .node_replacements import register_node_replacements
from .nodes import NODES
from .routes import register_imageops_routes

WEB_DIRECTORY = "./js"


class MajoorImageOpsExtension(ComfyExtension):
    async def on_load(self):
        register_imageops_routes()
        await register_node_replacements()

    async def get_node_list(self):
        return NODES


async def comfy_entrypoint():
    return MajoorImageOpsExtension()
