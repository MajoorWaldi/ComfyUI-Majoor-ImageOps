import math
import logging
import os

import numpy as np
import torch
from PIL import Image

from ._ops_constants import EPSILON, GAMMA_MAX, GAMMA_SAFE_MIN, LUMA_WEIGHTS

# Constants shared across ImageOps nodes
logger = logging.getLogger(__name__)

MAX_IMAGE_DIMENSION = 16384
MAX_SCALE_DIMENSION = 8192

def _get_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return int(default)

LARGE_IMAGE_WARN_MB = _get_int_env("IMAGEOPS_LARGE_IMAGE_WARN_MB", 2048)

ALLOWED_EXTENSIONS = {
    '.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'
}


def _pil_to_tensor(img: Image.Image) -> torch.Tensor:
    if img.mode not in ("RGB", "RGBA"):
        bands = img.getbands() if hasattr(img, 'getbands') and img.getbands() else []
        has_alpha = "A" in bands or img.mode in ("RGBA", "LA", "PA")
        img = img.convert("RGBA" if has_alpha else "RGB")

    arr = np.array(img).astype(np.float32) / 255.0
    if arr.ndim == 2:
        arr = np.stack([arr, arr, arr], axis=-1)
    return torch.from_numpy(arr).unsqueeze(0)


def _tensor_to_pil(image: torch.Tensor) -> Image.Image:
    if image is None:
        raise ValueError("image is None")
    if image.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(image.shape)}")
    t = image[0].detach().cpu().float().clamp(0, 1)
    arr = (t.numpy() * 255.0 + 0.5).astype(np.uint8)
    if arr.shape[-1] == 4:
        return Image.fromarray(arr, mode="RGBA")
    return Image.fromarray(arr[..., :3], mode="RGB")


def _apply_color_correct(image, brightness, contrast, gamma, saturation):
    x = image.float()
    x = x + brightness
    x = (x - 0.5) * contrast + 0.5
    gamma = max(GAMMA_SAFE_MIN, min(GAMMA_MAX, float(gamma)))
    x = torch.clamp(x, 0, 1) ** (1.0 / gamma)

    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr * rgb[..., 0] + lg * rgb[..., 1] + lb * rgb[..., 2]).unsqueeze(-1)
    rgb = luma + (rgb - luma) * saturation
    if x.shape[-1] == 4:
        x = torch.cat([rgb, x[..., 3:4]], dim=-1)
    else:
        x = rgb

    return x.clamp(0, 1)


def _gaussian_kernel1d(radius, sigma):
    radius = int(max(0, radius))
    if radius == 0:
        return torch.tensor([1.0], dtype=torch.float32)
    sigma = float(max(EPSILON, sigma))
    xs = torch.arange(-radius, radius + 1, dtype=torch.float32)
    k = torch.exp(-(xs * xs) / (2.0 * sigma * sigma))
    return k / torch.sum(k)


def _apply_blur(image, radius, sigma):
    k = _gaussian_kernel1d(radius, sigma).to(image.device)
    if k.numel() == 1:
        return image

    x = image.permute(0, 3, 1, 2).contiguous()
    _, C, _, _ = x.shape

    kx = k.view(1, 1, 1, -1).repeat(C, 1, 1, 1)
    ky = k.view(1, 1, -1, 1).repeat(C, 1, 1, 1)

    pad = int(radius)
    x = torch.nn.functional.pad(x, (pad, pad, 0, 0), mode="reflect")
    x = torch.nn.functional.conv2d(x, kx, groups=C)
    x = torch.nn.functional.pad(x, (0, 0, pad, pad), mode="reflect")
    x = torch.nn.functional.conv2d(x, ky, groups=C)

    return x.permute(0, 2, 3, 1).contiguous().clamp(0, 1)


def _select_media_tensor(image, video):
    if video is not None:
        return video
    if image is not None:
        return image
    raise ValueError("ImageOps nodes require either an image or video input.")


def _expand_mask_batch(mask: torch.Tensor, target_batch: int) -> torch.Tensor:
    if mask.shape[0] == target_batch:
        return mask
    if mask.shape[0] == 1:
        return mask.expand(target_batch, -1, -1)
    reps = math.ceil(target_batch / mask.shape[0])
    return mask.repeat(reps, 1, 1)[:target_batch]


def _prepare_mask_tensor(mask, batch, height, width, device, dtype):
    if mask is None:
        return None
    m = mask
    if not torch.is_tensor(m):
        try:
            m = torch.tensor(m, dtype=torch.float32, device=device)
        except (RuntimeError, TypeError, ValueError) as e:
            logger.warning("Mask tensor conversion failed: %s", e)
            return None
    else:
        m = m.to(device=device)

    if m.dim() == 4:
        if m.shape[1] == 1:
            m = m[:, 0]
        elif m.shape[-1] == 1:
            m = m[..., 0]
        else:
            m = m[..., 0]

    if m.dim() == 2:
        m = m.unsqueeze(0)
    elif m.dim() not in (3,):
        m = m.reshape(-1, m.shape[-2], m.shape[-1])

    if m.shape[0] == 0:
        return None

    m = _expand_mask_batch(m, batch)
    if m.shape[1] != height or m.shape[2] != width:
        m = torch.nn.functional.interpolate(
            m.unsqueeze(1),
            size=(height, width),
            mode="bilinear",
            align_corners=False,
        ).squeeze(1)

    return torch.clamp(m.to(dtype=dtype), 0.0, 1.0)


def _apply_mask_to_image(original, processed, mask):
    mask_tensor = _prepare_mask_tensor(
        mask,
        batch=original.shape[0],
        height=original.shape[1],
        width=original.shape[2],
        device=original.device,
        dtype=original.dtype,
    )
    if mask_tensor is None:
        return processed

    weight = mask_tensor.unsqueeze(-1)
    return original * (1.0 - weight) + processed * weight

# =========================
# Extra ops (v5)
# =========================

def _apply_levels(image: torch.Tensor, in_min: float, in_max: float, gamma: float, out_min: float, out_max: float):
    x = image.float()
    in_min = float(in_min); in_max = float(in_max)
    out_min = float(out_min); out_max = float(out_max)
    denom = max(EPSILON, (in_max - in_min))
    y = (x - in_min) / denom
    y = y.clamp(0.0, 1.0)
    g = float(max(GAMMA_SAFE_MIN, min(GAMMA_MAX, gamma)))
    y = y ** (1.0 / g)
    y = out_min + y * (out_max - out_min)
    return y.clamp(0.0, 1.0)

def _rgb_to_hsv(rgb: torch.Tensor):
    # rgb: [...,3] in [0,1]
    r, g, b = rgb[...,0], rgb[...,1], rgb[...,2]
    maxc = torch.max(rgb, dim=-1).values
    minc = torch.min(rgb, dim=-1).values
    v = maxc
    delta = maxc - minc
    s = torch.where(maxc > EPSILON, delta / (maxc + EPSILON), torch.zeros_like(maxc))
    # hue
    rc = (maxc - r) / (delta + EPSILON)
    gc = (maxc - g) / (delta + EPSILON)
    bc = (maxc - b) / (delta + EPSILON)
    h = torch.zeros_like(maxc)
    h = torch.where((maxc == r) & (delta > EPSILON), (bc - gc), h)
    h = torch.where((maxc == g) & (delta > EPSILON), (2.0 + rc - bc), h)
    h = torch.where((maxc == b) & (delta > EPSILON), (4.0 + gc - rc), h)
    h = (h / 6.0) % 1.0
    return torch.stack([h, s, v], dim=-1)

def _hsv_to_rgb(hsv: torch.Tensor):
    h, s, v = hsv[...,0], hsv[...,1], hsv[...,2]
    h6 = (h % 1.0) * 6.0
    i = torch.floor(h6).to(torch.int64)
    f = h6 - i.float()
    p = v * (1.0 - s)
    q = v * (1.0 - s * f)
    t = v * (1.0 - s * (1.0 - f))
    i_mod = i % 6
    r = torch.where(i_mod == 0, v, torch.where(i_mod == 1, q, torch.where(i_mod == 2, p, torch.where(i_mod == 3, p, torch.where(i_mod == 4, t, v)))))
    g = torch.where(i_mod == 0, t, torch.where(i_mod == 1, v, torch.where(i_mod == 2, v, torch.where(i_mod == 3, q, torch.where(i_mod == 4, p, p)))))
    b = torch.where(i_mod == 0, p, torch.where(i_mod == 1, p, torch.where(i_mod == 2, t, torch.where(i_mod == 3, v, torch.where(i_mod == 4, v, q)))))
    return torch.stack([r, g, b], dim=-1)

def _apply_huesat(image: torch.Tensor, hue_deg: float, saturation: float, value: float):
    x = image.float()
    rgb = x[..., :3].clamp(0,1)
    hsv = _rgb_to_hsv(rgb)
    hue = (hsv[...,0] + (float(hue_deg) / 360.0)) % 1.0
    sat = (hsv[...,1] * float(saturation)).clamp(0.0, 4.0)
    val = (hsv[...,2] * float(value)).clamp(0.0, 4.0)
    rgb2 = _hsv_to_rgb(torch.stack([hue, sat, val], dim=-1)).clamp(0,1)
    if x.shape[-1] == 4:
        x = torch.cat([rgb2, x[...,3:4]], dim=-1)
    else:
        x = rgb2
    return x.clamp(0,1)

def _apply_invert(image: torch.Tensor, invert_alpha: bool = False):
    x = image.float()
    if x.shape[-1] == 4:
        rgb = 1.0 - x[..., :3]
        a = (1.0 - x[..., 3:4]) if invert_alpha else x[..., 3:4]
        return torch.cat([rgb, a], dim=-1).clamp(0,1)
    return (1.0 - x).clamp(0,1)

def _apply_clamp(image: torch.Tensor, min_v: float, max_v: float):
    return image.float().clamp(float(min_v), float(max_v)).clamp(0,1)

def _apply_sharpen(image: torch.Tensor, amount: float, radius: int, sigma: float, threshold: float):
    x = image.float().clamp(0,1)
    if float(amount) == 0.0 or int(radius) <= 0:
        return x
    blurred = _apply_blur(x, int(radius), float(max(EPSILON, sigma)))
    diff = x - blurred
    if float(threshold) > 0:
        m = diff.abs().mean(dim=-1, keepdim=True)
        diff = torch.where(m >= float(threshold), diff, torch.zeros_like(diff))
    y = (x + diff * float(amount)).clamp(0,1)
    return y

def _apply_edge_detect(image: torch.Tensor, strength: float):
    """Sobel edge magnitude on luma. Output is grayscale RGB (alpha passthrough)."""
    x = image.float().clamp(0, 1)
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    l = (lr * rgb[..., 0] + lg * rgb[..., 1] + lb * rgb[..., 2]).clamp(0, 1)  # [B,H,W]
    l = l.unsqueeze(1)  # [B,1,H,W]

    kx = torch.tensor([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], dtype=torch.float32, device=x.device).view(1, 1, 3, 3)
    ky = torch.tensor([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], dtype=torch.float32, device=x.device).view(1, 1, 3, 3)

    pad = torch.nn.functional.pad(l, (1, 1, 1, 1), mode="reflect")
    gx = torch.nn.functional.conv2d(pad, kx)
    gy = torch.nn.functional.conv2d(pad, ky)

    mag = torch.sqrt(gx * gx + gy * gy) * float(strength)
    mag = mag.clamp(0, 1)

    out_rgb = mag.repeat(1, 3, 1, 1).permute(0, 2, 3, 1).contiguous()
    if x.shape[-1] == 4:
        return torch.cat([out_rgb, x[..., 3:4]], dim=-1).clamp(0, 1)
    return out_rgb.clamp(0, 1)

def _apply_merge(a: torch.Tensor, b: torch.Tensor, mode: str, mix: float):
    # a,b: [B,H,W,C]
    a = a.float().clamp(0,1)
    b = b.float().clamp(0,1)
    mode = str(mode).lower()
    m = float(mix)
    ar, br = a[..., :3], b[..., :3]
    if mode == "over":
        # if b has alpha, over a
        if b.shape[-1] == 4:
            ba = b[...,3:4].clamp(0,1)
            out = br*ba + ar*(1.0-ba)
        else:
            out = br
    elif mode == "add":
        out = ar + br
    elif mode == "subtract":
        out = ar - br
    elif mode == "multiply":
        out = ar * br
    elif mode == "screen":
        out = 1.0 - (1.0-ar)*(1.0-br)
    elif mode == "difference":
        out = (ar - br).abs()
    elif mode == "max":
        out = torch.maximum(ar, br)
    elif mode == "min":
        out = torch.minimum(ar, br)
    else:
        out = br
    out = out.clamp(0,1)
    out = ar*(1.0-m) + out*m
    if a.shape[-1] == 4:
        aa = a[...,3:4]
        if b.shape[-1] == 4 and mode == "over":
            ba = b[...,3:4].clamp(0,1)
            ao = ba + aa*(1.0-ba)
        else:
            ao = aa
        return torch.cat([out, ao], dim=-1).clamp(0,1)
    return out.clamp(0,1)

def _dilate_erode_mask(mask: torch.Tensor, radius: int, op: str):
    if mask is None:
        return None
    m = mask.float()
    if m.dim() == 3:
        m = m.unsqueeze(1)  # [B,1,H,W]
    elif m.dim() == 2:
        m = m.unsqueeze(0).unsqueeze(0)
    else:
        m = m.reshape(-1, 1, m.shape[-2], m.shape[-1])

    r = int(max(0, radius))
    if r == 0:
        return m[:,0,:,:]
    k = 2*r + 1
    if str(op).lower().startswith("dil"):
        out = torch.nn.functional.max_pool2d(m, kernel_size=k, stride=1, padding=r)
    else:
        out = -torch.nn.functional.max_pool2d(-m, kernel_size=k, stride=1, padding=r)
    return out[:,0,:,:].clamp(0,1)

def _apply_glow(image: torch.Tensor, threshold: float, radius: int, sigma: float, intensity: float):
    x = image.float().clamp(0,1)
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr*rgb[...,0] + lg*rgb[...,1] + lb*rgb[...,2]).unsqueeze(-1)
    mask = (luma - float(threshold)).clamp(0,1)
    glow = rgb * mask
    glow4 = torch.cat([glow, torch.ones_like(mask)], dim=-1) if x.shape[-1]==4 else glow
    glow_blur = _apply_blur(glow4, int(radius), float(max(EPSILON, sigma)))
    g_rgb = glow_blur[..., :3]
    out_rgb = (rgb + g_rgb * float(intensity)).clamp(0,1)
    if x.shape[-1]==4:
        return torch.cat([out_rgb, x[...,3:4]], dim=-1)
    return out_rgb

def _crop_pad(image: torch.Tensor, x: int, y: int, w: int, h: int, pad: int, pad_mode: str):
    # image [B,H,W,C]
    B,H,W,C = image.shape
    x0 = int(x); y0=int(y); w=int(w); h=int(h); pad=int(pad)
    x1 = x0 + w; y1 = y0 + h
    # pad as needed
    left = max(0, -x0); top = max(0, -y0); right = max(0, x1 - W); bottom = max(0, y1 - H)
    x0c = max(0, x0); y0c = max(0, y0); x1c = min(W, x1); y1c = min(H, y1)
    cropped = image[:, y0c:y1c, x0c:x1c, :]
    if left or top or right or bottom:
        t = cropped.permute(0,3,1,2).contiguous()
        mode = str(pad_mode).lower()
        if mode not in ("reflect","replicate","constant"):
            mode = "reflect"
        if mode == "replicate":
            mode = "replicate"
        elif mode == "constant":
            mode = "constant"
        else:
            mode = "reflect"
        t = torch.nn.functional.pad(t, (left,right,top,bottom), mode=mode)
        cropped = t.permute(0,2,3,1).contiguous()
    if pad>0:
        t = cropped.permute(0,3,1,2).contiguous()
        t = torch.nn.functional.pad(t, (pad,pad,pad,pad), mode="reflect")
        cropped = t.permute(0,2,3,1).contiguous()
    return cropped

def _resize(image: torch.Tensor, out_w: int, out_h: int):
    x = image.permute(0,3,1,2).contiguous()
    x = torch.nn.functional.interpolate(x, size=(int(out_h), int(out_w)), mode="bilinear", align_corners=False)
    return x.permute(0,2,3,1).contiguous().clamp(0,1)

def _apply_crop_reformat(image: torch.Tensor, x: int, y: int, crop_w: int, crop_h: int, pad: int, pad_mode: str,
                         out_w: int, out_h: int, mode: str):
    x0 = _crop_pad(image, x, y, crop_w, crop_h, pad, pad_mode)
    mode = str(mode).lower()
    if out_w <= 0 or out_h <= 0:
        return x0
    if mode == "stretch":
        return _resize(x0, out_w, out_h)
    # fit/fill keep aspect
    B,H,W,C = x0.shape
    scale_fit = min(out_w / max(1,W), out_h / max(1,H))
    scale_fill = max(out_w / max(1,W), out_h / max(1,H))
    s = scale_fit if mode == "fit" else scale_fill
    nw = max(1, int(round(W*s))); nh = max(1, int(round(H*s)))
    xr = _resize(x0, nw, nh)
    if mode == "fit":
        # letterbox to out size
        pad_x = max(0, out_w - nw); pad_y = max(0, out_h - nh)
        left = pad_x//2; right = pad_x - left
        top = pad_y//2; bottom = pad_y - top
        t = xr.permute(0,3,1,2).contiguous()
        t = torch.nn.functional.pad(t, (left,right,top,bottom), mode="constant", value=0.0)
        out = t.permute(0,2,3,1).contiguous()
        return out[:, :out_h, :out_w, :].clamp(0,1)
    else:
        # crop center to out size
        y0c = max(0, (nh - out_h)//2)
        x0c = max(0, (nw - out_w)//2)
        return xr[:, y0c:y0c+out_h, x0c:x0c+out_w, :].clamp(0,1)

def _apply_lumakey(image: torch.Tensor, low: float, high: float, softness: float):
    x = image.float().clamp(0,1)
    rgb = x[..., :3]
    lr, lg, lb = LUMA_WEIGHTS
    luma = (lr*rgb[...,0] + lg*rgb[...,1] + lb*rgb[...,2]).clamp(0,1)
    low = float(low); high=float(high); soft=float(max(0.0, softness))
    # smoothstep on low/high with softness
    if soft > 0:
        low1 = low - soft
        low2 = low + soft
        high1 = high - soft
        high2 = high + soft
    else:
        low1=low2=low
        high1=high2=high
    def smoothstep(a,b,t):
        t = ((t-a)/(b-a+EPSILON)).clamp(0,1)
        return t*t*(3-2*t)
    m_low = smoothstep(low1, low2, luma)
    m_high = 1.0 - smoothstep(high1, high2, luma)
    mask = (m_low * m_high).clamp(0,1)
    return mask

def _tensor_batch_to_pil_list(images: torch.Tensor):
    if images is None:
        raise ValueError("images is None")
    if images.dim() != 4:
        raise ValueError(f"Expected [B,H,W,C], got {tuple(images.shape)}")
    out = []
    b = int(images.shape[0])
    for i in range(b):
        t = images[i:i+1, ...]
        out.append(_tensor_to_pil(t))
    return out
