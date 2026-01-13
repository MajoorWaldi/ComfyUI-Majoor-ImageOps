import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_DEFAULTS = {
    "version": 1,
    "epsilon": 1e-6,
    "luma_weights": [0.2126, 0.7152, 0.0722],
    "gamma_safe_min": 0.2,
    "gamma_max": 5.0,
    "preview_gamma_epsilon": 1e-3,
}


def _load_ops_constants() -> dict:
    # Served by ComfyUI as an extension asset; also used as our shared source-of-truth.
    path = Path(__file__).resolve().parents[1] / "js" / "shared" / "ops_constants.json"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as e:
        logger.debug("ops constants not found (%s); using defaults", e)
        return dict(_DEFAULTS)
    except json.JSONDecodeError as e:
        logger.warning("ops constants invalid JSON (%s); using defaults", e)
        return dict(_DEFAULTS)

    if not isinstance(raw, dict):
        return dict(_DEFAULTS)

    out = dict(_DEFAULTS)
    out.update({k: raw.get(k, v) for k, v in _DEFAULTS.items()})
    return out


OPS_CONSTANTS = _load_ops_constants()
EPSILON = float(OPS_CONSTANTS.get("epsilon", _DEFAULTS["epsilon"]))
_lw = OPS_CONSTANTS.get("luma_weights")
if not isinstance(_lw, (list, tuple)) or len(_lw) < 3:
    _lw = _DEFAULTS["luma_weights"]
LUMA_WEIGHTS = (float(_lw[0]), float(_lw[1]), float(_lw[2]))
GAMMA_SAFE_MIN = float(OPS_CONSTANTS.get("gamma_safe_min", _DEFAULTS["gamma_safe_min"]))
GAMMA_MAX = float(OPS_CONSTANTS.get("gamma_max", _DEFAULTS["gamma_max"]))
