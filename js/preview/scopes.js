// Scopes (histogram, waveform, vectorscope) (v1)

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function luma(r, g, b, lw) {
  return lw[0] * r + lw[1] * g + lw[2] * b;
}

export function computeScopes(imageData, opts) {
  const { width: W, height: H, data } = imageData;
  const lw = opts?.lumaWeights ?? [0.2126, 0.7152, 0.0722];
  const step = Math.max(1, Math.floor(opts?.sampleStep ?? 2));

  const hist = new Uint32Array(256);
  const waveW = Math.max(64, Math.floor(opts?.waveWidth ?? 256));
  const waveH = Math.max(64, Math.floor(opts?.waveHeight ?? 64));
  const waveform = new Uint16Array(waveW * waveH);
  const waveformR = new Uint16Array(waveW * waveH);
  const waveformG = new Uint16Array(waveW * waveH);
  const waveformB = new Uint16Array(waveW * waveH);

  const vecSize = Math.max(64, Math.floor(opts?.vectorscopeSize ?? 96));
  const vectorscope = new Uint16Array(vecSize * vecSize);

  for (let y = 0; y < H; y += step) {
    const wy = Math.floor((y / Math.max(1, H - 1)) * (waveW - 1));
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;

      const Y = clamp01(luma(r, g, b, lw));
      const bin = Math.max(0, Math.min(255, (Y * 255) | 0));
      hist[bin] += 1;

      const wx = Math.floor((x / Math.max(1, W - 1)) * (waveW - 1));
      const py = Math.max(0, Math.min(waveH - 1, ((1 - Y) * (waveH - 1)) | 0));
      waveform[py * waveW + wx] += 1;

      const pr = Math.max(0, Math.min(waveH - 1, ((1 - r) * (waveH - 1)) | 0));
      const pg = Math.max(0, Math.min(waveH - 1, ((1 - g) * (waveH - 1)) | 0));
      const pb = Math.max(0, Math.min(waveH - 1, ((1 - b) * (waveH - 1)) | 0));
      waveformR[pr * waveW + wx] += 1;
      waveformG[pg * waveW + wx] += 1;
      waveformB[pb * waveW + wx] += 1;

      // Vectorscope: approximate YCbCr chroma (centered)
      const cb = (-0.168736 * r - 0.331264 * g + 0.5 * b);
      const cr = (0.5 * r - 0.418688 * g - 0.081312 * b);
      const vx = Math.max(0, Math.min(vecSize - 1, (((cb + 0.5) * (vecSize - 1)) | 0)));
      const vy = Math.max(0, Math.min(vecSize - 1, (((0.5 - cr) * (vecSize - 1)) | 0)));
      vectorscope[vy * vecSize + vx] += 1;
    }
  }

  return { hist, waveform, waveformR, waveformG, waveformB, waveW, waveH, vectorscope, vecSize };
}

export function drawHistogram(ctx, W, H, hist) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  let maxV = 1;
  for (let i = 0; i < 256; i++) maxV = Math.max(maxV, hist[i]);

  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < 256; i++) {
    const x = (i / 255) * (W - 1);
    const y = H - (hist[i] / maxV) * (H - 2) - 1;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

export function drawWaveform(ctx, W, H, wf, wfW, wfH) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  let maxV = 1;
  for (let i = 0; i < wf.length; i++) maxV = Math.max(maxV, wf[i]);

  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(wfH - 1, Math.floor((y / Math.max(1, H - 1)) * (wfH - 1)));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(wfW - 1, Math.floor((x / Math.max(1, W - 1)) * (wfW - 1)));
      const v = wf[sy * wfW + sx] / maxV;
      const a = Math.max(0, Math.min(255, (v * 255) | 0));
      const i = (y * W + x) * 4;
      d[i] = 220;
      d[i + 1] = 220;
      d[i + 2] = 220;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function drawRgbWaveform(ctx, W, H, wr, wg, wb, wfW, wfH) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, W, H);

  let maxV = 1;
  for (let i = 0; i < wr.length; i++) maxV = Math.max(maxV, wr[i], wg[i], wb[i]);

  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) {
    const sy = Math.min(wfH - 1, Math.floor((y / Math.max(1, H - 1)) * (wfH - 1)));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(wfW - 1, Math.floor((x / Math.max(1, W - 1)) * (wfW - 1)));
      const idx = sy * wfW + sx;
      const ar = Math.max(0, Math.min(255, ((wr[idx] / maxV) * 255) | 0));
      const ag = Math.max(0, Math.min(255, ((wg[idx] / maxV) * 255) | 0));
      const ab = Math.max(0, Math.min(255, ((wb[idx] / maxV) * 255) | 0));
      const i = (y * W + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.max(ar, ag, ab);

      // tint
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      if (ar >= ag && ar >= ab) { d[i] = 255; d[i + 1] = 80; d[i + 2] = 80; }
      else if (ag >= ar && ag >= ab) { d[i] = 80; d[i + 1] = 255; d[i + 2] = 80; }
      else { d[i] = 80; d[i + 1] = 160; d[i + 2] = 255; }
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function drawVectorscope(ctx, S, data, size) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, S, S);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, S, S);

  let maxV = 1;
  for (let i = 0; i < data.length; i++) maxV = Math.max(maxV, data[i]);

  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    const sy = Math.min(size - 1, Math.floor((y / Math.max(1, S - 1)) * (size - 1)));
    for (let x = 0; x < S; x++) {
      const sx = Math.min(size - 1, Math.floor((x / Math.max(1, S - 1)) * (size - 1)));
      const v = data[sy * size + sx] / maxV;
      const a = Math.max(0, Math.min(255, (v * 255) | 0));
      const i = (y * S + x) * 4;
      d[i] = 180;
      d[i + 1] = 220;
      d[i + 2] = 255;
      d[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);

  // crosshair
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(S / 2, 0); ctx.lineTo(S / 2, S);
  ctx.moveTo(0, S / 2); ctx.lineTo(S, S / 2);
  ctx.stroke();
}
