/**
 * Persistent UI state per node-class, backed by localStorage.
 *
 * Use it to remember things like:
 *  - panel expanded/collapsed
 *  - selected sub-tool (e.g. draw brush type)
 *  - scope visibility for ColorAjust
 *
 * Keys are namespaced under "imageops.ui.<nodeClass>.<key>" so each ImageOps
 * node-class has its own bucket, isolated from others.
 */

const NS = "imageops.ui";

function safeGet(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

function buildKey(nodeClass: string, key: string): string {
  return `${NS}.${nodeClass}.${key}`;
}

export function getUiState<T = unknown>(nodeClass: string, key: string, fallback: T): T {
  const ls = safeGet();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(buildKey(nodeClass, key));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function setUiState(nodeClass: string, key: string, value: unknown): void {
  const ls = safeGet();
  if (!ls) return;
  try {
    ls.setItem(buildKey(nodeClass, key), JSON.stringify(value));
  } catch {
    // quota or serialization error — ignore
  }
}

export function clearUiState(nodeClass: string, key: string): void {
  const ls = safeGet();
  if (!ls) return;
  try { ls.removeItem(buildKey(nodeClass, key)); } catch {}
}

/**
 * Bind an HTMLDetailsElement (or any element exposing a boolean "open"/expanded
 * state via a getter callback) to persist its collapsed/expanded state.
 */
export function bindCollapsibleToUiState(
  element: HTMLDetailsElement | null,
  nodeClass: string,
  key: string,
  defaultOpen: boolean = true,
): void {
  if (!element) return;
  const stored = getUiState<boolean>(nodeClass, key, defaultOpen);
  element.open = stored;
  element.addEventListener("toggle", () => {
    setUiState(nodeClass, key, element.open);
  });
}
