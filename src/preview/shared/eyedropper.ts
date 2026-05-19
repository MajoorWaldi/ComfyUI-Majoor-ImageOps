/**
 * Eyedropper helper — lets the user pick a color from ANY <canvas> on the page
 * (typically an ImageOps preview canvas). Falls back gracefully when no canvas
 * is under the cursor by reading from the source canvas passed as option.
 *
 * Usage:
 *   const cancel = startEyedropper({
 *     onPick: (hex, rgba) => { ... },
 *     onCancel: () => { ... },
 *   });
 *
 * Activation UX:
 *   - body cursor becomes 'crosshair'
 *   - a small floating swatch follows the cursor showing the current color
 *   - left-click = pick
 *   - ESC / right-click = cancel
 *   - clicking outside any canvas = cancel
 */

export type EyedropperRGBA = { r: number; g: number; b: number; a: number };

export type EyedropperOptions = {
  onPick: (hex: string, rgba: EyedropperRGBA) => void;
  onCancel?: () => void;
  /** When provided, restricts picking to this specific canvas only. */
  restrictTo?: HTMLCanvasElement;
};

export type EyedropperHandle = {
  cancel: () => void;
  active: boolean;
};

let activeHandle: EyedropperHandle | null = null;

function toHex(n: number): string {
  const v = Math.max(0, Math.min(255, Math.round(n)));
  return v.toString(16).padStart(2, "0");
}

export function rgbaToHex({ r, g, b }: EyedropperRGBA): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function readCanvasPixel(canvas: HTMLCanvasElement, clientX: number, clientY: number): EyedropperRGBA | null {
  try {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) return null;
    const px = Math.floor((localX / rect.width) * canvas.width);
    const py = Math.floor((localY / rect.height) * canvas.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx || typeof ctx.getImageData !== "function") return null;
    const data = ctx.getImageData(px, py, 1, 1).data;
    return { r: data[0], g: data[1], b: data[2], a: data[3] };
  } catch {
    // SecurityError on tainted canvas, or willReadFrequently not honored
    return null;
  }
}

function findCanvasAt(clientX: number, clientY: number): HTMLCanvasElement | null {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if (el instanceof HTMLCanvasElement) return el;
  }
  return null;
}

export function startEyedropper(options: EyedropperOptions): EyedropperHandle {
  // Cancel any active eyedropper first
  activeHandle?.cancel();

  const previousCursor = document.body.style.cursor;
  document.body.style.cursor = "crosshair";

  // Floating swatch element
  const swatch = document.createElement("div");
  swatch.style.cssText = [
    "position:fixed",
    "z-index:99999",
    "width:28px",
    "height:28px",
    "border:2px solid #fff",
    "outline:1px solid #000",
    "border-radius:50%",
    "pointer-events:none",
    "box-shadow:0 2px 8px rgba(0,0,0,.5)",
    "transform:translate(14px,14px)",
    "transition:none",
  ].join(";");
  document.body.appendChild(swatch);

  const onMove = (e: PointerEvent | MouseEvent) => {
    swatch.style.left = `${e.clientX}px`;
    swatch.style.top = `${e.clientY}px`;
    const canvas = options.restrictTo ?? findCanvasAt(e.clientX, e.clientY);
    if (!canvas) {
      swatch.style.background = "transparent";
      return;
    }
    const rgba = readCanvasPixel(canvas, e.clientX, e.clientY);
    if (rgba) swatch.style.background = rgbaToHex(rgba);
  };

  const cleanup = () => {
    if (!handle.active) return;
    handle.active = false;
    document.body.style.cursor = previousCursor;
    swatch.remove();
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("contextmenu", onContext, true);
    if (activeHandle === handle) activeHandle = null;
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) {
      e.preventDefault();
      e.stopPropagation();
      options.onCancel?.();
      cleanup();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const canvas = options.restrictTo ?? findCanvasAt(e.clientX, e.clientY);
    if (!canvas) {
      options.onCancel?.();
      cleanup();
      return;
    }
    const rgba = readCanvasPixel(canvas, e.clientX, e.clientY);
    if (!rgba) {
      options.onCancel?.();
      cleanup();
      return;
    }
    options.onPick(rgbaToHex(rgba), rgba);
    cleanup();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      options.onCancel?.();
      cleanup();
    }
  };

  const onContext = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    options.onCancel?.();
    cleanup();
  };

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("contextmenu", onContext, true);

  const handle: EyedropperHandle = {
    active: true,
    cancel: () => {
      options.onCancel?.();
      cleanup();
    },
  };
  activeHandle = handle;
  return handle;
}

/**
 * Returns true if the browser supports a window-level native eye dropper API.
 * (We don't currently use it because it can't read off-screen canvases reliably,
 * but the custom helper above works on any visible <canvas>.)
 */
export function hasNativeEyeDropper(): boolean {
  return typeof (window as any).EyeDropper === "function";
}

/**
 * Creates a small inline button (💧) suitable for placement next to a color input.
 * Wires it up to call startEyedropper on click.
 */
export function createEyedropperButton(opts: EyedropperOptions & { title?: string }): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "💧";
  btn.title = opts.title ?? "Pick color from preview";
  btn.style.cssText = [
    "background:#2a2a2a",
    "color:#ddd",
    "border:1px solid #444",
    "border-radius:4px",
    "padding:2px 6px",
    "cursor:pointer",
    "font-size:12px",
    "line-height:1",
  ].join(";");
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    startEyedropper(opts);
  });
  return btn;
}
