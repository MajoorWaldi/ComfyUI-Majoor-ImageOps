from __future__ import annotations

try:
    from comfy.utils import ProgressBar
except Exception:
    ProgressBar = None


def _normalize_unique_id(unique_id):
    if isinstance(unique_id, (list, tuple)):
        return unique_id[0] if unique_id else None
    return unique_id


class ImageOpsProgress:
    def __init__(self, total: int = 1, unique_id=None):
        self.total = max(1, int(total or 1))
        self.unique_id = _normalize_unique_id(unique_id)
        self._bar = None

        if ProgressBar is not None and self.unique_id is not None:
            self._bar = ProgressBar(self.total, node_id=self.unique_id)
            self._bar.update_absolute(0, total=self.total)

    def update(self, value: int = 1):
        if self._bar is not None:
            self._bar.update(max(0, int(value)))
        return self

    def update_absolute(self, value: int, total: int | None = None):
        if total is not None:
            self.total = max(1, int(total or 1))
        if self._bar is not None:
            self._bar.update_absolute(int(value), total=self.total)
        return self

    def finish(self):
        if self._bar is not None and self._bar.current < self.total:
            self._bar.update_absolute(self.total, total=self.total)
        return self


def start_progress(total: int = 1, unique_id=None) -> ImageOpsProgress:
    return ImageOpsProgress(total=total, unique_id=unique_id)
