export type CurvePoint = [number, number];

export interface CurveValue {
  points: CurvePoint[];
  interpolation?: string;
}

function parsePoints(value: unknown): { points: CurvePoint[]; interpolation: string } | null {
  const raw = Array.isArray(value) ? value : (value as CurveValue | null | undefined)?.points;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const points: CurvePoint[] = [];
  for (const entry of raw) {
    const x = Number(entry?.[0]);
    const y = Number(entry?.[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push([x, y]);
  }
  points.sort((a, b) => a[0] - b[0]);
  const interpolation = Array.isArray(value) ? "monotone_cubic" : String((value as CurveValue).interpolation ?? "monotone_cubic");
  return { points, interpolation };
}

function monotoneSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const slopes = new Array<number>(n).fill(0);
  if (n < 2) return slopes;
  const deltas: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i];
    deltas.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx);
  }
  slopes[0] = deltas[0];
  slopes[n - 1] = deltas[n - 2];
  for (let i = 1; i < n - 1; i++) {
    slopes[i] = deltas[i - 1] * deltas[i] <= 0 ? 0 : (deltas[i - 1] + deltas[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (deltas[i] === 0) {
      slopes[i] = 0;
      slopes[i + 1] = 0;
      continue;
    }
    const alpha = slopes[i] / deltas[i];
    const beta = slopes[i + 1] / deltas[i];
    const s = alpha * alpha + beta * beta;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      slopes[i] = t * alpha * deltas[i];
      slopes[i + 1] = t * beta * deltas[i];
    }
  }
  return slopes;
}

/** Mirrors comfy_api CurveInput (MonotoneCubicCurve / LinearCurve) so the preview matches the backend. */
export function createCurveInterpolator(value: unknown): ((x: number) => number) | null {
  const parsed = parsePoints(value);
  if (!parsed) return null;
  const xs = parsed.points.map((p) => p[0]);
  const ys = parsed.points.map((p) => p[1]);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const slopes = parsed.interpolation === "linear" ? null : monotoneSlopes(xs, ys);

  return (x: number): number => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let hi = 1;
    while (hi < n - 1 && xs[hi] <= x) hi++;
    const lo = hi - 1;
    const dx = xs[hi] - xs[lo];
    if (dx === 0) return ys[lo];
    const t = (x - xs[lo]) / dx;
    if (!slopes) return ys[lo] + (ys[hi] - ys[lo]) * t;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo]
      + (t3 - 2 * t2 + t) * dx * slopes[lo]
      + (-2 * t3 + 3 * t2) * ys[hi]
      + (t3 - t2) * dx * slopes[hi];
  };
}

/** 8-bit lookup table for canvas pixels, or null when the curve is missing or the identity. */
export function curveLut8(value: unknown): Uint8ClampedArray | null {
  const interp = createCurveInterpolator(value);
  if (!interp) return null;
  const lut = new Uint8ClampedArray(256);
  let identity = true;
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.round(interp(i / 255) * 255);
    if (lut[i] !== i) identity = false;
  }
  return identity ? null : lut;
}

export function applyCurve(ctx: CanvasRenderingContext2D, width: number, height: number, value: unknown): void {
  const lut = curveLut8(value);
  if (!lut) return;
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  ctx.putImageData(image, 0, 0);
}
