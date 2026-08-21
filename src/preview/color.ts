function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function wrapHueDegrees(value: number): number {
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return Math.abs(wrapped) < 1e-6 ? 0 : wrapped;
}

function hsvToRgb(hueDeg: number, saturation: number, value: number): [number, number, number] {
  const hue = ((hueDeg % 360) + 360) % 360;
  const sat = clamp01(saturation);
  const val = clamp01(value);
  const chroma = val * sat;
  const segment = hue / 60;
  const x = chroma * (1 - Math.abs(segment % 2 - 1));
  let red = 0;
  let green = 0;
  let blue = 0;
  if (segment < 1) {
    red = chroma;
    green = x;
  } else if (segment < 2) {
    red = x;
    green = chroma;
  } else if (segment < 3) {
    green = chroma;
    blue = x;
  } else if (segment < 4) {
    green = x;
    blue = chroma;
  } else if (segment < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }
  const match = val - chroma;
  return [red + match, green + match, blue + match];
}

export function getColorWheelSwatchCss(hueDeg: number, saturationPercent: number): string {
  const [red, green, blue] = hsvToRgb(hueDeg, clamp01(Math.max(0, saturationPercent) / 100), 1);
  return `rgb(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)})`;
}

export function drawColorWheel(canvas: HTMLCanvasElement, hueDeg: number, saturationPercent: number): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const width = Math.max(1, canvas.width || 1);
  const height = Math.max(1, canvas.height || 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(8, Math.min(width, height) / 2 - 10);
  const image = ctx.createImageData(width, height);
  const data = image.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x + 0.5 - centerX) / radius;
      const dy = (y + 0.5 - centerY) / radius;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const offset = (y * width + x) * 4;
      if (distance > 1) {
        data[offset + 3] = 0;
        continue;
      }
      const hue = Math.atan2(dy, dx) * 180 / Math.PI;
      const [red, green, blue] = hsvToRgb(hue, distance, 1);
      const edgeFade = distance > 0.96 ? clamp01((1 - distance) / 0.04) : 1;
      data[offset] = Math.round(red * 255);
      data[offset + 1] = Math.round(green * 255);
      data[offset + 2] = Math.round(blue * 255);
      data[offset + 3] = Math.round(edgeFade * 255);
    }
  }

  ctx.clearRect(0, 0, width, height);
  ctx.putImageData(image, 0, 0);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * ring, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const angleDeg of [0, 45, 90, 135]) {
    const angle = angleDeg * Math.PI / 180;
    const cos = Math.cos(angle) * radius;
    const sin = Math.sin(angle) * radius;
    ctx.beginPath();
    ctx.moveTo(-cos, -sin);
    ctx.lineTo(cos, sin);
    ctx.stroke();
  }

  const markerSaturation = clamp01(Math.max(0, saturationPercent) / 100);
  const markerAngle = wrapHueDegrees(hueDeg) * Math.PI / 180;
  const markerX = Math.cos(markerAngle) * radius * markerSaturation;
  const markerY = Math.sin(markerAngle) * radius * markerSaturation;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 10;
  ctx.fillStyle = getColorWheelSwatchCss(hueDeg, saturationPercent);
  ctx.strokeStyle = "rgba(255,255,255,0.98)";
  ctx.lineWidth = 2.25;
  ctx.beginPath();
  ctx.arc(markerX, markerY, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(markerX - 12, markerY);
  ctx.lineTo(markerX + 12, markerY);
  ctx.moveTo(markerX, markerY - 12);
  ctx.lineTo(markerX, markerY + 12);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function colorWheelPointToValues(canvasX: number, canvasY: number, canvas: HTMLCanvasElement): { hueDeg: number; saturation: number } {
  const width = Math.max(1, canvas.width || 1);
  const height = Math.max(1, canvas.height || 1);
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.max(8, Math.min(width, height) / 2 - 10);
  const dx = canvasX - centerX;
  const dy = canvasY - centerY;
  const distance = Math.min(1, Math.sqrt(dx * dx + dy * dy) / radius);
  return {
    hueDeg: wrapHueDegrees(Math.atan2(dy, dx) * 180 / Math.PI),
    saturation: Math.round(distance * 100),
  };
}
