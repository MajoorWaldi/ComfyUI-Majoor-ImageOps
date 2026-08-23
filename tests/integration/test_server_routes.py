import pytest
import sys
import os
import importlib.util

def load_local_server():
    # Mock ComfyUI's global 'server' module
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
        
    class MockWeb:
        pass

    class MockServerMod:
        PromptServer = MockPromptServer
        web = MockWeb

    sys.modules['server'] = MockServerMod
    sys.modules['folder_paths'] = type('MockFolderPaths', (), {'get_temp_directory': lambda: '/tmp'})

    # Load the local server.py
    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
    server_path = os.path.join(base_dir, 'server.py')
    
    spec = importlib.util.spec_from_file_location('local_server', server_path)
    local_server = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local_server)
    
    # Clean up sys.modules so we don't affect other tests
    del sys.modules['server']
    del sys.modules['folder_paths']
    
    return local_server, MockServerMod

def test_route_registration():
    local_server, mock_server = load_local_server()
    
    # First call
    local_server.register_imageops_routes()
    
    # Check that route exists
    assert "/imageops/viewmedia" in mock_server.PromptServer.instance.routes.routes

def test_force_size_filter():
    local_server, _ = load_local_server()
    _force_size_filter = local_server._force_size_filter
    
    # Test valid formats
    assert _force_size_filter("1920x1080") == "scale=min(1920,iw):min(1080,ih):flags=lanczos"
    assert _force_size_filter("?x1080") == "scale=-2:min(1080,ih):flags=lanczos"
    assert _force_size_filter("1920x?") == "scale=min(1920,iw):-2:flags=lanczos"
    assert _force_size_filter("?x?") == "scale=-2:-2:flags=lanczos"
    
    # Test invalid formats (should return None safely)
    assert _force_size_filter("invalid") is None
    assert _force_size_filter("invalidxinvalid") is None
    assert _force_size_filter("1920xinvalid") is None
    assert _force_size_filter("disabled") is None
    assert _force_size_filter("") is None

    
    # Test valid formats
    assert _force_size_filter("1920x1080") == "scale=min(1920,iw):min(1080,ih):flags=lanczos"
    assert _force_size_filter("?x1080") == "scale=-2:min(1080,ih):flags=lanczos"
    assert _force_size_filter("1920x?") == "scale=min(1920,iw):-2:flags=lanczos"
    assert _force_size_filter("?x?") == "scale=-2:-2:flags=lanczos"
    
    # Test invalid formats (should return None safely)
    assert _force_size_filter("invalid") is None
    assert _force_size_filter("invalidxinvalid") is None
    assert _force_size_filter("1920xinvalid") is None
    assert _force_size_filter("disabled") is None
    assert _force_size_filter("") is None
