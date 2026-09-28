from __future__ import annotations


def trim_indices(count: int, start: int, end: int, *, label: str) -> list[int]:
    """Frame indices for [start, end] (end=-1 means last source frame).

    Shared by Append and Frame Range so both nodes, and the frontend preview
    that mirrors them, agree on what an inverted range means: nothing. An
    inverted range used to be silently swapped in Append and silently emptied
    in Frame Range; neither is what the user asked for, so it's an error.
    """
    if count <= 0:
        raise ValueError(f"{label}: empty source")
    first = max(0, min(int(start), count - 1))
    last = count - 1 if int(end) == -1 else max(0, min(int(end), count - 1))
    if last < first:
        raise ValueError(f"{label}: trim_end ({end}) precedes trim_start ({start})")
    return list(range(first, last + 1))
