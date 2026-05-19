from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

import folder_paths
import server


web = getattr(server, "web", None)
if web is None:
    try:
        from aiohttp import web as _aiohttp_web

        web = _aiohttp_web
    except Exception:  # pragma: no cover - import-time fallback for headless tests
        web = None


def _ffmpeg_path() -> str | None:
    forced = os.getenv("IMAGEOPS_FORCE_FFMPEG_PATH")
    if forced and os.path.isfile(forced):
        return forced
    try:
        from imageio_ffmpeg import get_ffmpeg_exe

        candidate = get_ffmpeg_exe()
        if candidate and os.path.isfile(candidate):
            return candidate
    except Exception:
        pass
    return shutil.which("ffmpeg")


def _base_dir(kind: str) -> str:
    normalized = str(kind or "temp").strip().lower()
    if normalized == "input":
      return folder_paths.get_input_directory()
    if normalized == "output":
      return folder_paths.get_output_directory()
    return folder_paths.get_temp_directory()


def _resolve_preview_path(query) -> tuple[str, str]:
    filename = str(query.get("filename") or "").strip()
    subfolder = str(query.get("subfolder") or "").strip().replace("\\", "/")
    kind = str(query.get("type") or "temp").strip().lower()
    if not filename:
        raise web.HTTPBadRequest(text="Missing filename")

    root = Path(_base_dir(kind)).resolve()
    candidate = (root / subfolder / filename).resolve()
    try:
        common = os.path.commonpath([str(root), str(candidate)])
    except ValueError:
        common = ""
    if common != str(root):
        raise web.HTTPForbidden(text="Invalid preview path")
    if not candidate.is_file():
        raise web.HTTPNotFound(text="Preview file not found")
    return str(candidate), candidate.name


def _ext(path: str) -> str:
    return Path(path).suffix.lower()


def _force_size_filter(force_size: str) -> str | None:
    raw = str(force_size or "").strip()
    if not raw or raw.lower() == "disabled":
        return None
    if "x" not in raw:
        return None
    width, height = raw.split("x", 1)
    width = width.strip() or "?"
    height = height.strip() or "?"
    width_expr = "-2" if width == "?" else f"min({int(float(width))},iw)"
    height_expr = "-2" if height == "?" else f"min({int(float(height))},ih)"
    return f"scale={width_expr}:{height_expr}:flags=lanczos"


def _route(path: str):
    prompt_server = getattr(server, "PromptServer", None)
    instance = getattr(prompt_server, "instance", None)
    routes = getattr(instance, "routes", None)
    route_get = getattr(routes, "get", None)
    if callable(route_get):
        return route_get(path)

    def decorator(fn):
        return fn

    return decorator


@_route("/imageops/viewmedia")
async def imageops_viewmedia(request):
    path, filename = _resolve_preview_path(request.rel_url.query)
    ext = _ext(path)
    ffmpeg = _ffmpeg_path()
    force_filter = _force_size_filter(request.rel_url.query.get("force_size", ""))
    animated_like = ext in {".gif", ".webp", ".mp4", ".mov", ".webm", ".mkv", ".avi"}

    if ffmpeg is None or not animated_like:
        return web.FileResponse(path=path)

    args = [ffmpeg, "-v", "error", "-i", path]
    if force_filter:
        args += ["-vf", force_filter]
    deadline = "good" if str(request.rel_url.query.get("deadline", "realtime")).lower() == "good" else "realtime"
    args += ["-an", "-c:v", "libvpx-vp9", "-deadline", deadline, "-cpu-used", "8", "-f", "webm", "-"]

    proc = await asyncio.create_subprocess_exec(
        *args,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        stdin=subprocess.DEVNULL,
    )
    response = web.StreamResponse()
    response.content_type = "video/webm"
    response.headers["Content-Disposition"] = f'filename="{Path(filename).stem}.webm"'
    await response.prepare(request)

    async def _drain_stderr() -> None:
        # Drain stderr continuously so a full pipe buffer never deadlocks ffmpeg.
        if proc.stderr is None:
            return
        try:
            while True:
                chunk = await proc.stderr.read(65536)
                if not chunk:
                    break
        except Exception:
            pass

    drain_task = asyncio.ensure_future(_drain_stderr())
    try:
        while proc.stdout is not None:
            chunk = await proc.stdout.read(2**20)
            if not chunk:
                break
            await response.write(chunk)
        await proc.wait()
    except (ConnectionResetError, ConnectionError, asyncio.CancelledError):
        proc.kill()
    finally:
        if proc.returncode is None:
            proc.kill()
        drain_task.cancel()
    return response
