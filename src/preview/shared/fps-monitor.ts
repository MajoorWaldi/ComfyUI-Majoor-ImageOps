// LOD adaptive FPS monitor — measures rolling RAF frame frequency and
// exposes a "stress" hint that the render-canvas-size resolver can use to
// downscale further when the system is overloaded.
//
// Tiny, allocation-free design: a single 16-frame ring buffer, no objects
// allocated per tick.

const SAMPLE_COUNT = 16;
const STRESS_FPS = 22;       // below this, declare "stressed" and downscale
const RECOVERY_FPS = 32;     // above this, clear the stress flag
const STRESS_HOLD_MS = 800;  // minimum time the flag stays active to avoid flicker

let head = 0;
let filled = 0;
const samples: number[] = new Array(SAMPLE_COUNT).fill(0);
let lastTimestamp = 0;
let stressedSince = 0;

/**
 * Record one RAF tick. Call from inside the render loop with the current
 * `performance.now()` timestamp.
 */
export function noteFrame(now: number): void {
  if (lastTimestamp > 0) {
    const dt = now - lastTimestamp;
    if (dt > 0 && dt < 5000) {
      samples[head] = dt;
      head = (head + 1) % SAMPLE_COUNT;
      if (filled < SAMPLE_COUNT) filled++;
    }
  }
  lastTimestamp = now;
}

function rollingFps(): number {
  if (filled === 0) return 60;
  let sum = 0;
  for (let i = 0; i < filled; i++) sum += samples[i];
  const avgDt = sum / filled;
  return avgDt > 0 ? 1000 / avgDt : 60;
}

/**
 * Returns true when the rolling FPS is below the stress threshold. Latches
 * for STRESS_HOLD_MS to avoid oscillation.
 */
export function isStressed(): boolean {
  const now = performance.now();
  const fps = rollingFps();
  if (fps < STRESS_FPS) {
    stressedSince = now;
    return true;
  }
  if (fps > RECOVERY_FPS) {
    if (now - stressedSince > STRESS_HOLD_MS) {
      stressedSince = 0;
      return false;
    }
  }
  return stressedSince > 0;
}

export function _diagnostics(): { fps: number; stressed: boolean; samples: number } {
  return { fps: rollingFps(), stressed: isStressed(), samples: filled };
}
