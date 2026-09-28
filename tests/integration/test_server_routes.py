import importlib.util
import os
import sys

import av
import numpy as np
import pytest
from PIL import Image


class MockRoutes:
    def __init__(self):
        self.routes = {}

    def get(self, path):
        def decorator(func):
            self.routes[path] = func
            return func
        return decorator


class MockPromptServer:
    class instance:
        routes = MockRoutes()


class MockServerMod:
    PromptServer = MockPromptServer
    web = type("MockWeb", (), {"FileResponse": staticmethod(lambda path, headers=None: path)})


@pytest.fixture
def local_routes(tmp_path, monkeypatch):
    folder_paths = type("MockFolderPaths", (), {"get_temp_directory": staticmethod(lambda: str(tmp_path))})
    monkeypatch.setitem(sys.modules, "server", MockServerMod)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
    spec = importlib.util.spec_from_file_location("local_routes", os.path.join(base_dir, "routes.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_animated(path, fmt, frames=6):
    images = [Image.fromarray((np.random.rand(90, 120, 3) * 255).astype("uint8")) for _ in range(frames)]
    images[0].save(path, save_all=True, append_images=images[1:], duration=80, loop=0, format=fmt)


def test_route_registration(local_routes):
    local_routes.register_imageops_routes()
    assert "/imageops/viewmedia" in MockPromptServer.instance.routes.routes


def test_target_size(local_routes):
    target = local_routes._target_size

    assert target("1920x1080", 640, 360) == (640, 360)
    assert target("?x100", 640, 360) == (178, 100)
    assert target("200x?", 640, 360) == (200, 112)
    assert target("200x100", 640, 360) == (200, 100)
    assert target("?x?", 640, 360) == (640, 360)

    assert target("disabled", 641, 361) == (640, 360)
    assert target("", 640, 360) == (640, 360)
    assert target("invalid", 640, 360) == (640, 360)
    assert target("invalidxinvalid", 640, 360) == (640, 360)
    assert target("1920xinvalid", 640, 360) == (640, 360)


@pytest.mark.parametrize(("name", "fmt"), [("clip.gif", "GIF"), ("clip.webp", "WEBP")])
def test_transcode_animated_image(local_routes, tmp_path, name, fmt):
    source = tmp_path / name
    out = tmp_path / "out.webm"
    _write_animated(source, fmt)

    local_routes._transcode(str(source), str(out), "64x?", "realtime")

    with av.open(str(out)) as container:
        stream = container.streams.video[0]
        frames = list(container.decode(stream))
    assert stream.codec_context.name == "vp9"
    assert (stream.width, stream.height) == (64, 48)
    assert len(frames) == 6
    assert float(frames[-1].time) == pytest.approx(0.4, abs=0.02)
    assert not (tmp_path / "out.webm.tmp").exists()
