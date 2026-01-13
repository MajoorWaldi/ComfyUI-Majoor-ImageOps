// Execution progress bus for ImageOps nodes (v6)

export function attachProgressBus(api) {
  const state = {
    running: false,
    byNodeId: new Map(),
    widgets: new Map(), // nodeId -> {wrap,bar}
  };

  function update(nodeId, value, max) {
    const w = state.widgets.get(nodeId);
    if (!w) return;
    if (!state.running) {
      w.wrap.style.display = "none";
      w.bar.style.width = "0%";
      return;
    }
    const pct = max > 0 ? (value / max) : 0;
    w.wrap.style.display = "block";
    w.bar.style.width = `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%`;
  }

  function resetAll() {
    for (const [nodeId, _] of state.widgets) update(nodeId, 0, 0);
  }

  api.addEventListener("execution_start", () => {
    state.running = true;
    state.byNodeId.clear();
    resetAll();
  });
  api.addEventListener("execution_error", () => {
    state.running = false;
    state.byNodeId.clear();
    resetAll();
  });
  api.addEventListener("execution_end", () => {
    state.running = false;
    state.byNodeId.clear();
    resetAll();
  });
  api.addEventListener("progress", (e) => {
    const d = e?.detail ?? {};
    const nodeId = d.node ?? d.node_id ?? d.nodeId ?? null;
    if (nodeId == null) return;
    state.byNodeId.set(nodeId, { value: d.value ?? 0, max: d.max ?? 0 });
    update(nodeId, d.value ?? 0, d.max ?? 0);
  });

  return {
    registerNodeWidget(node, wrap, bar) {
      if (!node?.id) return;
      state.widgets.set(node.id, { wrap, bar });
      // initial
      update(node.id, 0, 0);
    }
  };
}
