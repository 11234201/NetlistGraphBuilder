import { createWorkspaceAnalysis } from "../application/workspace_analysis.js";
import { createNetlistReconvergenceScope, sameNetlistReconvergenceScope } from "../domains/netlist/reconvergence_scope.js";
import { renderNetlistReconvergence, highlightNetlistReconvergence } from "../ui/netlist_reconvergence_panel.js";

export function createNetlistStructureBridge({ panel, detail, readContext, inCompare, jobs, feature, logProcess, locate }) {
  const records = new Map(), hosts = { panel, detail };
  let side = "left", revision = 0, active = false;
  const selectedSide = () => inCompare() ? side : "single";
  const paint = () => {
    const record = records.get(selectedSide());
    renderNetlistReconvergence(hosts, record, inCompare(), selectedSide());
  };
  function update(record) {
    const data = record.manager.read().data;
    if (data !== record.data) {
      record.data = data;
      record.related = new Map();
      for (const result of data?.reconvergence.results || []) {
        const members = new Set(result.paths.flatMap((path) => path.nodeIds.map((id) => record.scope.displayNodes.get(id).id)));
        for (const id of members) {
          if (!record.related.has(id)) record.related.set(id, []);
          record.related.get(id).push(result);
        }
      }
    }
    if (record.selected || record.highlighted) {
      highlightNetlistReconvergence(record.context.mount, record);
      record.highlighted = Boolean(record.selected);
    }
    if (record.side === selectedSide()) paint();
  }
  function refresh(mounted = null) {
    if (panel.ownerDocument.body.classList.contains("has-domain-workspace")) { reset(); return; }
    active ||= !panel.hidden;
    if (!active) return;
    const sides = inCompare() ? ["left", "right"] : ["single"];
    for (const [id, record] of records) if (!sides.includes(id)) {
      record.manager.dispose(); records.delete(id);
    }
    for (const id of sides) {
      const context = readContext(id);
      let record = records.get(id);
      if (!context?.graph?.nodes.length || !context.fullGraph || !context.document || !context.sessionReady) {
        if (record) { record.manager.dispose(); records.delete(id); }
        continue;
      }
      if (!record) {
        record = { side: id, selected: null, nodeId: null, data: null };
        record.manager = createWorkspaceAnalysis({ jobs, logProcess, onChange: () => update(record) });
        records.set(id, record);
      }
      const previous = record.context;
      if (previous?.document === context.document && previous.graph === context.graph &&
          previous.fullGraph === context.fullGraph && previous.unitKey === context.unitKey) {
        if (mounted === context.mount && record.selected) highlightNetlistReconvergence(mounted, record);
        continue;
      }
      record.context = context;
      try {
        const scope = createNetlistReconvergenceScope(context.fullGraph, context.graph);
        const same = sameNetlistReconvergenceScope(record.scope, scope) && previous?.document === context.document &&
          previous.unitKey === context.unitKey && previous.graph.view?.mode === context.graph.view?.mode;
        record.scope = scope;
        if (same) { if (record.selected) highlightNetlistReconvergence(context.mount, record); continue; }
        Object.assign(record, { selected: null, nodeId: context.selectedNode(), pageIndex: 0,
          detailPage: 0, relatedPage: 0, pathPage: [0, 0], data: null, related: null });
        const analysisScopeId = id + ":" + ++revision;
        record.manager.bind({ document: context.document, unitId: context.unitId, sessionId: context.sessionId,
          side: id, analysisScopeId, analysisModel: scope.model, analysisNodeCount: scope.visibleCount,
          analysisEdgeCount: scope.visibleEdgeCount, feature });
      } catch (error) {
        record.manager.dispose(); record.scope = null;
        try { logProcess("error", "graph", "Could not prepare visible logic for reconvergence", {
          error, operation: "reconvergence.scope", code: "reconvergence.scope.failed", side: id,
          sessionId: context.sessionId, documentId: context.document.documentId, unitId: context.unitId
        }); } catch { /* Keep the view usable when diagnostics are unavailable. */ }
        record.scopeError = error.message;
      }
    }
    paint();
  }
  function reset() {
    for (const record of records.values()) record.manager.dispose();
    records.clear(); active = false; detail.replaceChildren();
  }
  function click(event) {
    const target = event.target.closest?.("button");
    if (!target) return;
    const action = target.dataset.reconAction;
    if (["left", "right"].includes(action)) { side = action; paint(); return; }
    const record = records.get(selectedSide());
    if (action === "retry-scope" && record?.scopeError) { record.context = null; refresh(); return; }
    if (!record?.scope) return;
    const results = record.manager.read().data?.reconvergence.results || [];
    const newId = target.dataset.reconResult;
    if (newId) {
      const result = results.find((item) => item.id === newId);
      if (!result) return;
      Object.assign(record, { selected: newId, detailPage: 0, pathPage: [0, 0] });
      record.manager.detail(result); return;
    }
    if (action === "cancel") record.manager.cancel();
    else if (action === "run") { record.selected = null; record.manager.run(); }
    else if (action === "clear") { record.selected = null; record.manager.detail(null); }
    else if (action === "retry-detail") record.manager.detail(results.find((item) => item.id === record.selected));
    else if (action === "locate") {
      const result = results.find((item) => item.id === record.selected);
      if (result) {
        const members = new Set(result.paths.flatMap((path) => path.nodeIds.map((id) => record.scope.displayNodes.get(id).id)));
        const nodes = record.context.graph.nodes.filter((node) => members.has(node.id));
        let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
        for (const node of nodes) {
          x = Math.min(x, node.x); y = Math.min(y, node.y);
          right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height);
        }
        if (Number.isFinite(x)) locate(record.side, { x, y, width: right - x, height: bottom - y });
      }
    } else if (action) {
      const delta = action.endsWith("+") ? 1 : -1, key = action.slice(0, -1);
      if (key === "path0" || key === "path1") record.pathPage[Number(key.at(-1))] += delta;
      else {
        const field = { list: "pageIndex", detail: "detailPage", related: "relatedPage" }[key];
        if (field) record[field] += delta;
      }
      paint();
    }
  }
  panel.addEventListener("click", click); detail.addEventListener("click", click);
  let domainActive = panel.ownerDocument.body.classList.contains("has-domain-workspace");
  const observer = new MutationObserver((changes) => {
    const next = panel.ownerDocument.body.classList.contains("has-domain-workspace");
    if (domainActive === next && changes.every((change) => change.target !== panel)) return;
    domainActive = next; refresh();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  // A domain switch also changes the body class; inspector state belongs to
  // the visible domain, even when the Navigator was already on another tab.
  observer.observe(panel.ownerDocument.body, { attributes: true, attributeFilter: ["class"] });
  refresh();
  return { refresh, inspect(id, nodeId) {
    if (!active) return;
    if (id && inCompare()) side = id;
    const record = records.get(id || "single");
    if (record && record.nodeId !== nodeId) { record.nodeId = nodeId; record.relatedPage = 0; paint(); }
  } };
}
