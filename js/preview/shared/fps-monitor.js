const SAMPLE_COUNT = 16;
const STRESS_FPS = 22;
const RECOVERY_FPS = 32;
const STRESS_HOLD_MS = 800;
let head = 0;
let filled = 0;
const samples = new Array(SAMPLE_COUNT).fill(0);
let lastTimestamp = 0;
let stressedSince = 0;
function noteFrame(now) {
  if (lastTimestamp > 0) {
    const dt = now - lastTimestamp;
    if (dt > 0 && dt < 5e3) {
      samples[head] = dt;
      head = (head + 1) % SAMPLE_COUNT;
      if (filled < SAMPLE_COUNT) filled++;
    }
  }
  lastTimestamp = now;
}
function rollingFps() {
  if (filled === 0) return 60;
  let sum = 0;
  for (let i = 0; i < filled; i++) sum += samples[i];
  const avgDt = sum / filled;
  return avgDt > 0 ? 1e3 / avgDt : 60;
}
function isStressed() {
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
function _diagnostics() {
  return { fps: rollingFps(), stressed: isStressed(), samples: filled };
}
export {
  _diagnostics,
  isStressed,
  noteFrame
};
