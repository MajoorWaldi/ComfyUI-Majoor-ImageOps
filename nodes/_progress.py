from __future__ import annotations

from comfy_api.latest import ComfyAPISync

api = ComfyAPISync()


class ImageOpsProgress:
    def __init__(self, total: int = 1):
        self.total = max(1, int(total or 1))
        self.current = 0
        self._send()

    def _send(self):
        try:
            api.execution.set_progress(self.current, self.total)
        except ValueError:  # no node is executing (direct calls outside a graph run)
            pass

    def update(self, value: int = 1):
        self.current += max(0, int(value))
        self._send()
        return self

    def update_absolute(self, value: int, total: int | None = None):
        if total is not None:
            self.total = max(1, int(total or 1))
        self.current = int(value)
        self._send()
        return self

    def finish(self):
        if self.current < self.total:
            self.update_absolute(self.total)
        return self


def start_progress(total: int = 1) -> ImageOpsProgress:
    return ImageOpsProgress(total=total)
