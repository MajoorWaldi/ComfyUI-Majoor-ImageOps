const NS = "imageops.ui";
function safeGet() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function buildKey(nodeClass, key) {
  return `${NS}.${nodeClass}.${key}`;
}
function getUiState(nodeClass, key, fallback) {
  const ls = safeGet();
  if (!ls) return fallback;
  try {
    const raw = ls.getItem(buildKey(nodeClass, key));
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function setUiState(nodeClass, key, value) {
  const ls = safeGet();
  if (!ls) return;
  try {
    ls.setItem(buildKey(nodeClass, key), JSON.stringify(value));
  } catch {
  }
}
function clearUiState(nodeClass, key) {
  const ls = safeGet();
  if (!ls) return;
  try {
    ls.removeItem(buildKey(nodeClass, key));
  } catch {
  }
}
function bindCollapsibleToUiState(element, nodeClass, key, defaultOpen = true) {
  if (!element) return;
  const stored = getUiState(nodeClass, key, defaultOpen);
  element.open = stored;
  element.addEventListener("toggle", () => {
    setUiState(nodeClass, key, element.open);
  });
}
export {
  bindCollapsibleToUiState,
  clearUiState,
  getUiState,
  setUiState
};
