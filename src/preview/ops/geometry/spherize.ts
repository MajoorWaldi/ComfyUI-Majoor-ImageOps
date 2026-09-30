import type { ComfyNode } from "../../../types.js";
import { boolAny, numAny, strAny, w } from "../../graph.js";
import { applyEffectToCanvas, makeCanvas } from "../../renderer.js";
import { setWidgetValue } from "../../shared/widgets.js";

export function applySpherize(ctx: CanvasRenderingContext2D, width: number, height: number, mode: string, strength: number, invert: boolean): void {
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const sd = src.data;
    const dd = dst.data;
    const s = Math.max(0, strength);
    const m = String(mode || "spherize").toLowerCase();
    for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      // Normalised coords [-1, 1]
      const nx = (px / (width - 1)) * 2 - 1;
      const ny = (py / (height - 1)) * 2 - 1;
      const dstIdx = (py * width + px) * 4;

      // Outside the unit disk → transparent (only for disk-shaped projections).
      const isDiskMode = m !== "latlong" && m !== "unlatlong";
      if (isDiskMode && nx * nx + ny * ny > 1) {
        dd[dstIdx] = 0;
        dd[dstIdx + 1] = 0;
        dd[dstIdx + 2] = 0;
        dd[dstIdx + 3] = 0;
        continue;
      }

      let srcNx: number;
      let srcNy: number;

      if (!invert) {
        [srcNx, srcNy] = _spherizeMapFwd(nx, ny, m, s);
      } else {
        [srcNx, srcNy] = _spherizeMapInv(nx, ny, m, s);
      }

      // Back to pixel coords
      const sx = ((srcNx + 1) * 0.5) * (width - 1);
      const sy = ((srcNy + 1) * 0.5) * (height - 1);

      // Bilinear sample
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const fx = sx - x0;
      const fy = sy - y0;

      // Clamp to image borders
      const cx0 = Math.max(0, Math.min(width - 1, x0));
      const cx1 = Math.max(0, Math.min(width - 1, x1));
      const cy0 = Math.max(0, Math.min(height - 1, y0));
      const cy1 = Math.max(0, Math.min(height - 1, y1));

      for (let c = 0; c < 4; c++) {
        const v00 = sd[(cy0 * width + cx0) * 4 + c];
        const v10 = sd[(cy0 * width + cx1) * 4 + c];
        const v01 = sd[(cy1 * width + cx0) * 4 + c];
        const v11 = sd[(cy1 * width + cx1) * 4 + c];
        dd[dstIdx + c] = Math.round(
          v00 * (1 - fx) * (1 - fy) +
          v10 * fx * (1 - fy) +
          v01 * (1 - fx) * fy +
          v11 * fx * fy,
        );
      }
    }
    }

    ctx.putImageData(dst, 0, 0);
}

export function _spherizeMapFwd(nx: number, ny: number, mode: string, s: number): [number, number] {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r < 1e-7) return [0, 0];
    if (mode === "spherize") {
    const t = r * Math.PI * 0.5;
    const scale = (Math.sin(t) / r) * s + (1 - s);
    return [nx * scale, ny * scale];
    }

    if (mode === "fisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rSrc = Math.sin(angle);
    return [nx / r * rSrc, ny / r * rSrc];
    }

    if (mode === "defisheye") {
    if (Math.abs(s) <= 1e-6) return [nx, ny];
    const angle = r * Math.PI * 0.5 * s;
    const rDst = Math.tan(Math.min(angle, 1.5)) / (Math.PI * 0.5 * s + 1e-8);
    const scale = rDst / (r + 1e-8);
    return [nx * scale, ny * scale];
    }

    if (mode === "latlong") {
    // Equirectangular → rectilinear: barrel-like, no tan singularity.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const lon = Math.atan(nx * fovTan);
    const lat = Math.atan(ny * fovTan);
    return [lon / atanFov, lat / atanFov];
    }

    if (mode === "unlatlong") {
    // Rectilinear → equirectangular: pincushion-like, inverse of latlong.
    const fovTan = Math.max(s * 2.0, 1e-6);
    const atanFov = Math.atan(fovTan);
    const clamp = atanFov * 0.9999;
    const srcX = Math.tan(Math.max(-clamp, Math.min(clamp, nx * atanFov))) / fovTan;
    const srcY = Math.tan(Math.max(-clamp, Math.min(clamp, ny * atanFov))) / fovTan;
    return [srcX, srcY];
    }

    return [nx, ny];
}

export function _spherizeMapInv(nx: number, ny: number, mode: string, s: number): [number, number] {
    const r = Math.sqrt(nx * nx + ny * ny);
    if (r < 1e-7) return [0, 0];
    if (mode === "spherize") {
    const rClamped = Math.min(r, 1);
    const scale = (Math.asin(rClamped) / (Math.PI * 0.5 * r + 1e-8)) * s + (1 - s);
    return [nx * scale, ny * scale];
    }

    if (mode === "fisheye") {
    // inverse fisheye = defisheye
    return _spherizeMapFwd(nx, ny, "defisheye", s);
    }

    if (mode === "defisheye") {
    return _spherizeMapFwd(nx, ny, "fisheye", s);
    }

    if (mode === "latlong") {
    return _spherizeMapFwd(nx, ny, "unlatlong", s);
    }

    if (mode === "unlatlong") {
    return _spherizeMapFwd(nx, ny, "latlong", s);
    }

    return [nx, ny];
}

export function spherize(ctx: CanvasRenderingContext2D, W: number, node: ComfyNode, inputs: HTMLCanvasElement[] = [], frameIndex: number = 0): HTMLCanvasElement {
    let source = inputs[0] ?? ctx.canvas;

    const sizeMode = strAny(node, ["size_mode"], "from_input", frameIndex).toLowerCase().trim();
    if (sizeMode === "custom") {
      const tw = Math.max(64, Math.round(numAny(node, ["width"], 512, frameIndex)));
      const th = Math.max(64, Math.round(numAny(node, ["height"], 512, frameIndex)));
      if (tw !== source.width || th !== source.height) {
        const resized = makeCanvas(tw, th);
        resized.getContext("2d", { willReadFrequently: true })!.drawImage(source, 0, 0, tw, th);
        source = resized;
      }
    } else {
      // from_input: sync width/height widgets to actual source dimensions
      const ww = w(node, "width");
      const hw = w(node, "height");
      setWidgetValue(ww, Math.max(64, source.width));
      setWidgetValue(hw, Math.max(64, source.height));
    }

    return applyEffectToCanvas(source, (effectCtx, width, height) => {
      applySpherize(
        effectCtx, width, height,
        strAny(node, ["mode"], "spherize", frameIndex),
        numAny(node, ["strength"], 1.0, frameIndex),
        boolAny(node, ["invert"], false, frameIndex),
      );
    });
  }
