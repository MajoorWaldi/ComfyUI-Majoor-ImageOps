from __future__ import annotations
from comfy_api.latest import io
import torch
from ._helpers import _hex_to_rgb01, _scalar
from ._progress import start_progress
from ._preview import build_node_preview_result
_NOISE_BASIS = ['perlin', 'value', 'white']
_NOISE_FRACTAL_MODES = ['none', 'fbm', 'turbulence', 'ridged']
_NOISE_COMPUTE_DEVICES = ['auto', 'cpu', 'cuda']
_EPSILON = 1e-06

def _fade(t: torch.Tensor) -> torch.Tensor:
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)

def _lerp(a: torch.Tensor, b: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
    return a + (b - a) * t

def _resolve_noise_device(preference: str='auto') -> torch.device:
    normalized = str(preference or 'auto').strip().lower()
    if normalized == 'cuda' and (not torch.cuda.is_available()):
        return torch.device('cpu')
    if normalized in ('auto', 'cuda') and torch.cuda.is_available():
        return torch.device('cuda')
    return torch.device('cpu')

def _wrap_lattice(index: torch.Tensor, period: int) -> torch.Tensor:
    if period <= 0:
        return index
    return torch.remainder(index, int(period))

def _hash_lattice3(ix, iy, iz, seed: int) -> torch.Tensor:
    """Deterministic float hash that stays on the current torch device."""
    seed_term = float(int(seed) % 104729)
    value = ix.to(torch.float32) * 127.1 + iy.to(torch.float32) * 311.7 + iz.to(torch.float32) * 74.7 + seed_term * 37.719
    hashed = torch.sin(value) * 43758.5453123
    return hashed - torch.floor(hashed)

def _coordinate_axes(width: int, height: int, scale: float, offset_x: float, offset_y: float, offset_z: float, seamless: bool, device: torch.device) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, int, int]:
    safe_scale = max(1.0, float(scale))
    if seamless:
        period_x = max(1, int(round(max(1, width) / safe_scale)))
        period_y = max(1, int(round(max(1, height) / safe_scale)))
        xs = torch.arange(width, device=device, dtype=torch.float32) * (period_x / max(1, width))
        ys = torch.arange(height, device=device, dtype=torch.float32) * (period_y / max(1, height))
        xs = xs + float(offset_x) / safe_scale
        ys = ys + float(offset_y) / safe_scale
    else:
        period_x = 0
        period_y = 0
        xs = (torch.arange(width, device=device, dtype=torch.float32) + float(offset_x)) / safe_scale
        ys = (torch.arange(height, device=device, dtype=torch.float32) + float(offset_y)) / safe_scale
    z = torch.tensor(float(offset_z) / safe_scale, device=device, dtype=torch.float32)
    return (xs, ys, z, period_x, period_y)

def _value_noise(width: int, height: int, scale: float, offset_x: float, offset_y: float, offset_z: float, seed: int, seamless: bool, device: torch.device) -> torch.Tensor:
    xs, ys, z, period_x, period_y = _coordinate_axes(width, height, scale, offset_x, offset_y, offset_z, seamless, device)
    xi = torch.floor(xs).to(torch.int64)
    yi = torch.floor(ys).to(torch.int64)
    zi = torch.floor(z).to(torch.int64)
    xf = xs - xi.to(torch.float32)
    yf = ys - yi.to(torch.float32)
    zf = z - zi.to(torch.float32)
    xi0 = xi.view(1, -1)
    yi0 = yi.view(-1, 1)
    ix0 = _wrap_lattice(xi0, period_x)
    ix1 = _wrap_lattice(xi0 + 1, period_x)
    iy0 = _wrap_lattice(yi0, period_y)
    iy1 = _wrap_lattice(yi0 + 1, period_y)
    zi1 = zi + 1
    u = _fade(xf).view(1, -1)
    v = _fade(yf).view(-1, 1)
    w = _fade(zf)
    v000 = _hash_lattice3(ix0, iy0, zi, seed) * 2.0 - 1.0
    v100 = _hash_lattice3(ix1, iy0, zi, seed) * 2.0 - 1.0
    v010 = _hash_lattice3(ix0, iy1, zi, seed) * 2.0 - 1.0
    v110 = _hash_lattice3(ix1, iy1, zi, seed) * 2.0 - 1.0
    v001 = _hash_lattice3(ix0, iy0, zi1, seed) * 2.0 - 1.0
    v101 = _hash_lattice3(ix1, iy0, zi1, seed) * 2.0 - 1.0
    v011 = _hash_lattice3(ix0, iy1, zi1, seed) * 2.0 - 1.0
    v111 = _hash_lattice3(ix1, iy1, zi1, seed) * 2.0 - 1.0
    x00 = _lerp(v000, v100, u)
    x10 = _lerp(v010, v110, u)
    x01 = _lerp(v001, v101, u)
    x11 = _lerp(v011, v111, u)
    y0 = _lerp(x00, x10, v)
    y1 = _lerp(x01, x11, v)
    return _lerp(y0, y1, w).clamp(-1.0, 1.0)
_GRAD3_GX = [1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 0.0, 0.0]
_GRAD3_GY = [1.0, 1.0, -1.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 1.0, -1.0, 1.0, 1.0, -1.0, 1.0]
_GRAD3_GZ = [0.0, 0.0, 0.0, 0.0, 1.0, 1.0, -1.0, -1.0, 1.0, 1.0, -1.0, -1.0, 0.0, 0.0, 1.0, -1.0]
_GRAD3_CACHE: dict = {}

def _get_grad3_tensors(device: torch.device):
    key = str(device)
    if key not in _GRAD3_CACHE:
        _GRAD3_CACHE[key] = (torch.tensor(_GRAD3_GX, dtype=torch.float32, device=device), torch.tensor(_GRAD3_GY, dtype=torch.float32, device=device), torch.tensor(_GRAD3_GZ, dtype=torch.float32, device=device))
    return _GRAD3_CACHE[key]

def _gradient_dot3(ix, iy, iz, dx, dy, dz, seed: int) -> torch.Tensor:
    h = _hash_lattice3(ix, iy, iz, seed)
    gi = (h * 16.0).long().clamp_(0, 15)
    gx_t, gy_t, gz_t = _get_grad3_tensors(h.device)
    return gx_t[gi] * dx + gy_t[gi] * dy + gz_t[gi] * dz

def _perlin_noise(width: int, height: int, scale: float, offset_x: float, offset_y: float, offset_z: float, seed: int, seamless: bool, device: torch.device) -> torch.Tensor:
    xs, ys, z, period_x, period_y = _coordinate_axes(width, height, scale, offset_x, offset_y, offset_z, seamless, device)
    xi = torch.floor(xs).to(torch.int64)
    yi = torch.floor(ys).to(torch.int64)
    zi = torch.floor(z).to(torch.int64)
    xf = xs - xi.to(torch.float32)
    yf = ys - yi.to(torch.float32)
    zf = z - zi.to(torch.float32)
    xi0 = xi.view(1, -1)
    yi0 = yi.view(-1, 1)
    ix0 = _wrap_lattice(xi0, period_x)
    ix1 = _wrap_lattice(xi0 + 1, period_x)
    iy0 = _wrap_lattice(yi0, period_y)
    iy1 = _wrap_lattice(yi0 + 1, period_y)
    zi1 = zi + 1
    dx0 = xf.view(1, -1)
    dy0 = yf.view(-1, 1)
    dz0 = zf
    dx1 = dx0 - 1.0
    dy1 = dy0 - 1.0
    dz1 = zf - 1.0
    n000 = _gradient_dot3(ix0, iy0, zi, dx0, dy0, dz0, seed)
    n100 = _gradient_dot3(ix1, iy0, zi, dx1, dy0, dz0, seed)
    n010 = _gradient_dot3(ix0, iy1, zi, dx0, dy1, dz0, seed)
    n110 = _gradient_dot3(ix1, iy1, zi, dx1, dy1, dz0, seed)
    n001 = _gradient_dot3(ix0, iy0, zi1, dx0, dy0, dz1, seed)
    n101 = _gradient_dot3(ix1, iy0, zi1, dx1, dy0, dz1, seed)
    n011 = _gradient_dot3(ix0, iy1, zi1, dx0, dy1, dz1, seed)
    n111 = _gradient_dot3(ix1, iy1, zi1, dx1, dy1, dz1, seed)
    u = _fade(xf).view(1, -1)
    v = _fade(yf).view(-1, 1)
    w = _fade(zf)
    x00 = _lerp(n000, n100, u)
    x10 = _lerp(n010, n110, u)
    x01 = _lerp(n001, n101, u)
    x11 = _lerp(n011, n111, u)
    y0 = _lerp(x00, x10, v)
    y1 = _lerp(x01, x11, v)
    return (_lerp(y0, y1, w) * 1.15470053838).clamp(-1.0, 1.0)

def _white_noise(width: int, height: int, offset_x: float, offset_y: float, offset_z: float, seed: int, seamless: bool, device: torch.device) -> torch.Tensor:
    xs = torch.arange(width, device=device, dtype=torch.float32) + float(offset_x)
    ys = torch.arange(height, device=device, dtype=torch.float32) + float(offset_y)
    z = torch.tensor(float(offset_z), device=device, dtype=torch.float32)
    xi = torch.floor(xs).to(torch.int64).view(1, -1)
    yi = torch.floor(ys).to(torch.int64).view(-1, 1)
    zi = torch.floor(z).to(torch.int64)
    zf = z - zi.to(torch.float32)
    period_x = width if seamless else 0
    period_y = height if seamless else 0
    ix = _wrap_lattice(xi, period_x)
    iy = _wrap_lattice(yi, period_y)
    n0 = _hash_lattice3(ix, iy, zi, seed) * 2.0 - 1.0
    n1 = _hash_lattice3(ix, iy, zi + 1, seed) * 2.0 - 1.0
    return _lerp(n0, n1, _fade(zf)).clamp(-1.0, 1.0)

def _basis_noise(basis: str, width: int, height: int, scale: float, offset_x: float, offset_y: float, offset_z: float, seed: int, seamless: bool, device: torch.device) -> torch.Tensor:
    normalized = str(basis or 'perlin').strip().lower()
    if normalized == 'value':
        return _value_noise(width, height, scale, offset_x, offset_y, offset_z, seed, seamless, device)
    if normalized == 'white':
        return _white_noise(width, height, offset_x, offset_y, offset_z, seed, seamless, device)
    return _perlin_noise(width, height, scale, offset_x, offset_y, offset_z, seed, seamless, device)

def _synthesize_noise(basis: str, fractal_mode: str, width: int, height: int, scale: float, octaves: int, lacunarity: float, gain: float, offset_x: float, offset_y: float, offset_z: float, seed: int, seamless: bool, device: torch.device) -> torch.Tensor:
    normalized_mode = str(fractal_mode or 'none').strip().lower()
    if normalized_mode == 'none':
        signed = _basis_noise(basis, width, height, scale, offset_x, offset_y, offset_z, seed, seamless, device)
        return (signed * 0.5 + 0.5).clamp(0.0, 1.0)
    total = torch.zeros((height, width), device=device, dtype=torch.float32)
    amplitude = 1.0
    amplitude_sum = 0.0
    current_scale = max(1.0, float(scale))
    safe_lacunarity = max(1.01, float(lacunarity))
    safe_gain = max(0.0, float(gain))
    for octave in range(max(1, int(octaves))):
        octave_seed = int(seed) + octave * 10007
        signed = _basis_noise(basis, width, height, current_scale, offset_x, offset_y, offset_z, octave_seed, seamless, device)
        if normalized_mode == 'turbulence':
            contribution = signed.abs()
        elif normalized_mode == 'ridged':
            contribution = 1.0 - signed.abs()
        else:
            contribution = signed
        total = total + contribution * amplitude
        amplitude_sum += amplitude
        amplitude *= safe_gain
        current_scale = max(1.0, current_scale / safe_lacunarity)
    if amplitude_sum <= _EPSILON:
        return torch.zeros((height, width), device=device, dtype=torch.float32)
    total = total / amplitude_sum
    if normalized_mode == 'fbm':
        return (total * 0.5 + 0.5).clamp(0.0, 1.0)
    return total

def _apply_tone(gray: torch.Tensor, contrast: float, invert: bool) -> torch.Tensor:
    toned = (gray - 0.5) * float(contrast) + 0.5
    toned = toned.clamp(0.0, 1.0)
    if invert:
        toned = 1.0 - toned
    return toned

def _normalize_gray(gray: torch.Tensor) -> torch.Tensor:
    min_v = gray.amin()
    max_v = gray.amax()
    gray_range = max_v - min_v
    normalized = ((gray - min_v) / gray_range.clamp_min(_EPSILON)).clamp(0.0, 1.0)
    return torch.where(gray_range <= _EPSILON, torch.zeros_like(gray), normalized)

def _colorize(gray: torch.Tensor, low_color: str, high_color: str) -> torch.Tensor:
    low = torch.tensor(_hex_to_rgb01(low_color), device=gray.device, dtype=gray.dtype).view(1, 1, 3)
    high = torch.tensor(_hex_to_rgb01(high_color), device=gray.device, dtype=gray.dtype).view(1, 1, 3)
    return low + gray.unsqueeze(-1) * (high - low)

class ImageOpsNoise(io.ComfyNode):

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(node_id='ImageOpsNoise', display_name='〽️ Image Ops Noise', category='image/imageops', search_aliases=['noise', 'perlin', 'value noise', 'procedural', 'texture'], inputs=[io.Int.Input('width', default=1024, min=64, max=8192, step=64), io.Int.Input('height', default=1024, min=64, max=8192, step=64), io.Int.Input('frame_length', default=1, min=1, max=256, step=1, tooltip='Number of frames to generate.'), io.Float.Input('fps', default=12.0, min=1.0, max=120.0, step=0.1, round=0.001), io.Int.Input('seed', default=0, min=0, max=2147483647, step=1), io.Combo.Input('basis', options=['perlin', 'value', 'white'], default='perlin'), io.Combo.Input('fractal_mode', options=['none', 'fbm', 'turbulence', 'ridged'], default='fbm'), io.Float.Input('scale', default=160.0, min=1.0, max=4096.0, step=1.0, round=0.01), io.Int.Input('octaves', default=5, min=1, max=12, step=1), io.Float.Input('gain', default=0.5, min=0.0, max=1.0, step=0.01, round=0.001), io.Float.Input('offset_z', default=0.0, min=-65536.0, max=65536.0, step=1.0, round=0.01, tooltip='Static Z offset into the noise field.'), io.Float.Input('animation_speed', default=1.0, min=0.0, max=512.0, step=0.1, round=0.01, tooltip='Z offset added per frame. Higher = faster animation. 0 = still image.'), io.Boolean.Input('seamless', default=False, tooltip='Wrap X/Y lattice so the texture tiles seamlessly.'), io.Float.Input('contrast', default=1.0, min=0.0, max=4.0, step=0.01, round=0.001), io.Boolean.Input('invert', default=False), io.Color.Input('low_color', default='#FFFFFF'), io.Color.Input('high_color', default='#FFFFFF')], outputs=[io.Image.Output('image', display_name='image'), io.Mask.Output('mask', display_name='mask')], hidden=[io.Hidden.unique_id])

    @classmethod
    def execute(cls, width=1024, height=1024, frame_length=1, fps=12.0, seed=0, basis='perlin', fractal_mode='fbm', scale=160.0, octaves=5, gain=0.5, offset_z=0.0, animation_speed=1.0, seamless=False, contrast=1.0, invert=False, low_color='#FFFFFF', high_color='#FFFFFF', batch_size=None, seed_step=None, lacunarity=None, offset_x=None, offset_y=None, frame_offset_x=None, frame_offset_y=None, frame_offset_z=None, compute_device=None, unique_id=None, **kwargs):
        target_w = max(1, _scalar(width, int))
        target_h = max(1, _scalar(height, int))
        frame_count = max(1, _scalar(frame_length, int))
        preview_fps = max(1.0, _scalar(fps, float))
        device = _resolve_noise_device(_scalar(compute_device, str) if compute_device is not None else 'auto')
        from .core.memory import check_budget
        check_budget(frame_count, target_h, target_w, 3, multiplier=2.0, label='ImageOps Noise')
        progress = start_progress(total=frame_count, unique_id=unique_id)
        anim_speed = _scalar(animation_speed, float) if frame_offset_z is None else _scalar(frame_offset_z, float)
        masks = []
        images = []
        for frame_index in range(frame_count):
            frame_seed = _scalar(seed, int, index=frame_index)
            frame_gray = _synthesize_noise(basis=_scalar(basis, str, index=frame_index), fractal_mode=_scalar(fractal_mode, str, index=frame_index), width=target_w, height=target_h, scale=_scalar(scale, float, index=frame_index), octaves=_scalar(octaves, int, index=frame_index), lacunarity=2.0, gain=_scalar(gain, float, index=frame_index), offset_x=0.0, offset_y=0.0, offset_z=_scalar(offset_z, float, index=frame_index) + frame_index * anim_speed, seed=frame_seed, seamless=_scalar(seamless, bool, index=frame_index), device=device)
            frame_gray = _normalize_gray(frame_gray)
            frame_gray = _apply_tone(frame_gray, contrast=_scalar(contrast, float, index=frame_index), invert=_scalar(invert, bool, index=frame_index))
            masks.append(frame_gray.unsqueeze(0).clamp(0.0, 1.0).cpu())
            images.append(_colorize(frame_gray, low_color=_scalar(low_color, str, index=frame_index), high_color=_scalar(high_color, str, index=frame_index)).unsqueeze(0).cpu())
            progress.update()
        mask = torch.cat(masks, dim=0)
        image = torch.cat(images, dim=0)
        progress.finish()
        return build_node_preview_result(image, (image, mask), prefix='imageops_noise', fps=preview_fps)