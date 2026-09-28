from __future__ import annotations

import asyncio
import hashlib
import os
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageSequence

import folder_paths
import server

web = server.web

ANIMATED_IMAGE_EXTS = {".gif", ".webp"}
ANIMATED_EXTS = ANIMATED_IMAGE_EXTS | {".mp4", ".mov", ".webm", ".mkv", ".avi"}
CACHE_SUBFOLDER = "imageops_view"
MAX_CACHED_FILES = 64
MAX_CONCURRENT_TRANSCODES = 2
TIME_BASE = Fraction(1, 1000)

_transcode_slots = asyncio.Semaphore(MAX_CONCURRENT_TRANSCODES)
_transcode_locks: dict[str, asyncio.Lock] = {}


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


def _target_size(force_size: str, width: int, height: int) -> tuple[int, int]:
    """Resolve "WxH" ("?" keeps the aspect ratio, "disabled" keeps the source size) to even dimensions."""
    raw = str(force_size or "").strip().lower()
    if raw and raw != "disabled" and "x" in raw:
        w_raw, h_raw = (part.strip() or "?" for part in raw.split("x", 1))
        try:
            w_val = None if w_raw == "?" else min(int(float(w_raw)), width)
            h_val = None if h_raw == "?" else min(int(float(h_raw)), height)
        except ValueError:
            w_val = h_val = None
        if w_val is not None or h_val is not None:
            if w_val is None:
                w_val = round(width * h_val / height)
            elif h_val is None:
                h_val = round(height * w_val / width)
            width, height = w_val, h_val
    return max(2, width // 2 * 2), max(2, height // 2 * 2)


def _iter_frames(path: str):
    """Yield (RGB uint8 array, presentation time in seconds) for every frame."""
    if Path(path).suffix.lower() in ANIMATED_IMAGE_EXTS:
        with Image.open(path) as image:
            elapsed = 0.0
            for frame in ImageSequence.Iterator(image):
                yield np.asarray(frame.convert("RGB")), elapsed
                elapsed += max(frame.info.get("duration", 100), 10) / 1000.0
        return
    with av.open(path) as container:
        for frame in container.decode(container.streams.video[0]):
            yield frame.to_ndarray(format="rgb24"), float(frame.time or 0.0)


def _transcode(path: str, out_path: str, force_size: str, deadline: str) -> None:
    tmp_path = f"{out_path}.tmp"
    try:
        with av.open(tmp_path, "w", format="webm") as output:
            stream = None
            last_pts = -1
            for rgb, seconds in _iter_frames(path):
                frame = av.VideoFrame.from_ndarray(rgb, format="rgb24")
                if stream is None:
                    width, height = _target_size(force_size, frame.width, frame.height)
                    stream = output.add_stream(
                        "libvpx-vp9",
                        rate=TIME_BASE.denominator,
                        options={"deadline": deadline, "cpu-used": "8", "row-mt": "1", "crf": "30", "b": "0"},
                    )
                    stream.width, stream.height, stream.pix_fmt = width, height, "yuv420p"
                frame = frame.reformat(width=stream.width, height=stream.height, format="yuv420p")
                last_pts = max(round(seconds / TIME_BASE), last_pts + 1)
                frame.pts = last_pts
                frame.time_base = TIME_BASE
                output.mux(stream.encode(frame))
            if stream is None:
                raise ValueError(f"No video frames in {path}")
            output.mux(stream.encode())
        os.replace(tmp_path, out_path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def _prune_cache(cache_dir: str) -> None:
    entries = sorted(Path(cache_dir).glob("*.webm"), key=lambda p: p.stat().st_mtime)
    for stale in entries[:-MAX_CACHED_FILES]:
        stale.unlink(missing_ok=True)


async def imageops_viewmedia(request):
    path, _ = _resolve_preview_path(request.rel_url.query)
    if Path(path).suffix.lower() not in ANIMATED_EXTS:
        return web.FileResponse(path=path)

    force_size = request.rel_url.query.get("force_size", "")
    deadline = "good" if str(request.rel_url.query.get("deadline", "realtime")).lower() == "good" else "realtime"
    stat = os.stat(path)
    key = hashlib.sha1(f"{path}|{stat.st_mtime_ns}|{stat.st_size}|{force_size}|{deadline}".encode()).hexdigest()
    cache_dir = os.path.join(folder_paths.get_temp_directory(), CACHE_SUBFOLDER)
    out_path = os.path.join(cache_dir, f"{key}.webm")

    lock = _transcode_locks.setdefault(key, asyncio.Lock())
    try:
        async with lock:
            if not os.path.isfile(out_path):
                os.makedirs(cache_dir, exist_ok=True)
                async with _transcode_slots:
                    try:
                        await asyncio.to_thread(_transcode, path, out_path, force_size, deadline)
                    except (av.error.FFmpegError, OSError, ValueError):
                        # Undecodable clip: let the browser try the original file.
                        return web.FileResponse(path=path)
                await asyncio.to_thread(_prune_cache, cache_dir)
    finally:
        _transcode_locks.pop(key, None)
    return web.FileResponse(path=out_path, headers={"Content-Type": "video/webm"})


def register_imageops_routes():
    server.PromptServer.instance.routes.get("/imageops/viewmedia")(imageops_viewmedia)
