from __future__ import annotations

import torch
import torch.nn.functional as F

from ._helpers import (
    _apply_mask_to_image,
    _coerce_media_to_tensor,
    _prepare_effect_mask,
    _resolve_mask_output_source,
    _scalar,
    _select_media_tensor,
)
from comfy_api.latest import io
from ._preview import build_node_preview_result
from ._progress import start_progress


def _fit_dirt_texture(dirt: torch.Tensor, height: int, width: int) -> torch.Tensor:
    if dirt.shape[1] == height and dirt.shape[2] == width:
        return dirt
    return F.interpolate(
        dirt.float().permute(0, 3, 1, 2), size=(height, width), mode="bilinear", align_corners=False
    ).permute(0, 2, 3, 1)


def _dust_speck_field(batch: int, height: int, width: int, amount: float, size: float, seed: int, device, dtype) -> torch.Tensor:
    # Lens dust is a physical artifact of the lens surface: it doesn't move
    # frame to frame, so the field is generated once and shared across the batch.
    speck_size = max(0.5, float(size))
    gen_h = max(1, int(round(height / speck_size)))
    gen_w = max(1, int(round(width / speck_size)))
    generator = torch.Generator(device="cpu").manual_seed(int(seed))
    field = torch.rand((1, gen_h, gen_w, 1), generator=generator, dtype=torch.float32)
    density = max(0.0, min(1.0, amount))
    threshold = 1.0 - density * 0.12
    specks = (field > threshold).float()
    if gen_h != height or gen_w != width:
        specks = F.interpolate(
            specks.permute(0, 3, 1, 2), size=(height, width), mode="bilinear", align_corners=False
        ).permute(0, 2, 3, 1)
    return specks.clamp(0.0, 1.0).expand(batch, height, width, 1).to(device=device, dtype=dtype)


def _apply_lens_artifacts(
    source: torch.Tensor,
    dirt: torch.Tensor | None,
    dirt_amount: float,
    dust_amount: float,
    dust_size: float,
    seed: int,
) -> torch.Tensor:
    x = source.float()
    b, h, w, c = x.shape
    device, dtype = x.device, x.dtype
    rgb = x[..., :3]

    if dirt is not None and dirt_amount > 0.0:
        dirt_rgb = _fit_dirt_texture(dirt, h, w)[..., :3].clamp(0.0, 1.0).to(device=device, dtype=dtype)
        if dirt_rgb.shape[0] != b:
            dirt_rgb = dirt_rgb[:1].expand(b, -1, -1, -1)
        dirt_luma = dirt_rgb.mean(dim=-1, keepdim=True)
        # Grime/dust deposits on a lens block light: attenuate multiplicatively
        # so it stays correct on HDR (unclamped) source values.
        attenuation = 1.0 - (1.0 - dirt_luma) * dirt_amount
        rgb = rgb * attenuation

    if dust_amount > 0.0:
        specks = _dust_speck_field(b, h, w, dust_amount, dust_size, seed, device, dtype)
        # Dust catching light is a specular highlight: additive, HDR-safe.
        rgb = rgb + specks * dust_amount

    if c > 3:
        return torch.cat([rgb, x[..., 3:].clamp(0.0, 1.0)], dim=-1)
    return rgb


class ImageOpsLensArtifacts(io.ComfyNode):
    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="ImageOpsLensArtifacts",
            display_name="〽️ Image Ops Lens Artifacts",
            category="image/imageops",
            search_aliases=["lens dirt", "dust", "smudge", "grime", "lens artifacts"],
            inputs=[
                io.Boolean.Input("bypass", default=False),
                io.Float.Input("dirt_amount", default=0.0, min=0.0, max=1.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001, tooltip="Opacity of the connected dirt texture."),
                io.Float.Input("dust_amount", default=0.0, min=0.0, max=1.0, step=0.01, display_mode=io.NumberDisplay("slider"), round=0.001, tooltip="Procedural dust speck density and brightness."),
                io.Float.Input("dust_size", default=2.0, min=0.5, max=20.0, step=0.1, round=0.001, tooltip="Speck size in pixels."),
                io.Int.Input("seed", default=12345, min=0, max=0xffffffffffffffff, tooltip="Dust is a static lens artifact: the same seed always produces the same specks."),
                io.Boolean.Input("invert_mask", default=False),
                io.MultiType.Input("image", types=[io.Image, io.Video], tooltip="Images/Video input.", display_name="Images/Video", optional=True, extra_dict={"forceInput": True}),
                io.MultiType.Input("dirt", types=[io.Image, io.Video], tooltip="Optional dirt/smudge texture to composite (a stock lens-dirt plate). Its luma is used as an attenuation mask.", display_name="Dirt Texture", optional=True, extra_dict={"forceInput": True}),
                io.Mask.Input("mask", optional=True),
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Mask.Output("mask", display_name="mask"),
            ],
            hidden=[io.Hidden.unique_id],
        )

    @classmethod
    def execute(
        cls,
        image=None,
        bypass=False,
        dirt_amount=0.0,
        dust_amount=0.0,
        dust_size=2.0,
        seed=12345,
        invert_mask=False,
        video=None,
        dirt=None,
        mask=None,
        unique_id=None,
        **kwargs,
    ):
        source = _select_media_tensor(image, video)
        effect_mask = _prepare_effect_mask(mask, source, invert_mask=invert_mask)
        output_mask = _resolve_mask_output_source(mask, source, invert_mask=invert_mask)
        progress = start_progress(unique_id=unique_id)
        if isinstance(bypass, bool) and bypass:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_lens_artifacts")
        if isinstance(bypass, (list, tuple)) and all(bypass):
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_lens_artifacts")

        dirt_amount_v = float(max(0.0, _scalar(dirt_amount)))
        dust_amount_v = float(max(0.0, _scalar(dust_amount)))
        dirt_tensor = _coerce_media_to_tensor(dirt, "dirt") if dirt is not None else None
        if dirt_amount_v <= 0.0 and dust_amount_v <= 0.0:
            progress.finish()
            return build_node_preview_result(source, (source, output_mask), prefix="imageops_lens_artifacts")

        result = _apply_lens_artifacts(
            source,
            dirt_tensor if dirt_amount_v > 0.0 else None,
            dirt_amount_v,
            dust_amount_v,
            _scalar(dust_size, float),
            _scalar(seed, int),
        )
        result = _apply_mask_to_image(source, result, effect_mask) if effect_mask is not None else result
        from ._helpers import apply_per_frame_bypass
        result = apply_per_frame_bypass(source, result, bypass)
        progress.finish()
        return build_node_preview_result(result, (result, output_mask), prefix="imageops_lens_artifacts")
