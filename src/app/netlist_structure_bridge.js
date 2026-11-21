import { createWorkspaceAnalysis } from "../application/workspace_analysis.js";
import { createNetlistReconvergenceScope, sameNetlistReconvergenceScope } from "../domains/netlist/reconvergence_scope.js";
import { renderNetlistReconvergence, highlightNetlistReconvergence } from "../ui/netlist_reconvergence_panel.js";
import { demand, analysisStatus, resultPage, resultSummary } from "./structure_command_results.js";

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
        record.scope = scope; record.scopeError = null;
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
  function perform(data) {
    const action = data.reconAction;
    if (["left", "right"].includes(action)) { side = action; paint(); return; }
    const record = records.get(selectedSide());
    if (action === "retry-scope" && record?.scopeError) { record.context = null; refresh(); return; }
    if (!record?.scope) return;
    const results = record.manager.read().data?.reconvergence.results || [];
    const newId = data.reconResult;
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
  function click(event) {
    const target = event.target.closest?.("button");
    if (target && !target.disabled) perform(target.dataset);
  }
  async function command({name,args,opts}) {
    if (opts.side) {
      demand(inCompare(), "INVALID_SIDE", "Only Compare has analysis sides");
      side = opts.side === "A" ? "left" : "right";
    }
    active = true;
    refresh();
    const id = selectedSide();
    const record = demand(records.get(id),"NO_DOCUMENT","Open a committed graph first");
    if (name === "analysis retry" && args[0] === "scope") {
      demand(record.scopeError, "INVALID_STATE", "The current scope has no failure to retry");
      record.context = null; record.scopeError = null; refresh();
    }
    demand(record.scope && !record.scopeError, "SCOPE_UNAVAILABLE", record.scopeError || "No analysis scope");
    const scope = record.scope;
    const status = () => analysisStatus(record.manager.read(),record.context.unitId,record.selected);
    const results = () => record.manager.read().data?.reconvergence?.results || [];
    const selected = value => demand(results().find(item => item.id === value), "OBJECT_NOT_FOUND","Unknown reconvergence result");
    const current = () => demand(records.get(id) === record && scope === record.scope, "STALE_DOCUMENT","Analysis scope changed");
    const page = Number(opts["page-number"] || 1);
    switch (name) {
      case "ui page": {
        const group = args[0].slice("analysis-".length), targetPage = Number(args[1]) - 1;
        const field = {list:"pageIndex",detail:"detailPage",related:"relatedPage"}[group];
        if (group === "path0" || group === "path1") record.pathPage[Number(group.at(-1))] = targetPage;
        else record[demand(field,"INVALID_ARGUMENT","Unknown analysis pager")] = targetPage;
        paint(); return {list:args[0],page:targetPage + 1};
      }
      case "analysis status": return status();
      case "analysis run":
        record.selected = null; await record.manager.run(true); current();
        demand(["complete","partial"].includes(status().status),"CANCELLED","Analysis superseded");
        return {...status(),partial:status().status === "partial"};
      case "analysis cancel": record.manager.cancel(); return status();
      case "analysis retry":
        if (args[0] === "detail") await record.manager.detail(selected(record.selected),true);
        else if (args[0] === "scope") await record.manager.run(true);
        else throw Object.assign(new Error("Choose scope or detail"), {code:"INVALID_ARGUMENT"});
        current(); return status();
      case "analysis results": {
        demand(args[0] === "reconvergence" && (!opts.type || opts.type === "all"), "UNAVAILABLE","Netlist supports reconvergence results");
        const value = resultPage(results(),page,12);
        record.pageIndex = page - 1; paint();
        return {...value,entries:value.entries.map(resultSummary)};
      }
      case "analysis select":
      case "analysis detail": {
        const item = selected(args[0]);
        const section = opts.section || "summary";
        demand(["summary","path-a","path-b","union"].includes(section),"INVALID_ARGUMENT","Unknown detail section");
        if (section === "summary") demand(page === 1,"PAGE_OUT_OF_RANGE","Summary has one page");
        if (record.selected !== item.id || record.manager.read().detailStatus !== "complete") {
          Object.assign(record,{selected:item.id,pathPage:[0,0],detailPage:0});
          await record.manager.detail(item,true); current();
          demand(record.selected === item.id && ["complete","partial"].includes(record.manager.read().detailStatus),
            "CANCELLED","Structure detail superseded");
        }
        if (name === "analysis select" || !opts.section || opts.section === "summary") return resultSummary(item);
        const branch = {"path-a":0,"path-b":1}[opts.section];
        demand(branch !== undefined || opts.section === "union","INVALID_ARGUMENT","Unknown detail section");
        const path = branch === undefined ? record.manager.read().detail : item.paths[branch];
        const value = resultPage((path?.edgeIds || []).filter(key => scope.displayEdges.has(key)),page,12);
        if (branch === undefined) record.detailPage = page - 1;
        else record.pathPage[branch] = page - 1;
        const entries = value.entries.map(id => {
          const wire = scope.displayEdges.get(id);
          return {...wire,analysisEdgeId:id,routed:!scope.unrouted.has(wire.net)};
        });
        paint(); return {id:item.id,section:opts.section,...value,entries};
      }
      case "analysis related": {
        demand(!opts.kind || opts.kind === "reconvergence","UNAVAILABLE","Netlist supports reconvergence results");
        const key = args[0], item = results().find(result => result.id === key);
        demand(item || record.context.graph.nodes.some(node => node.id === key),"OBJECT_NOT_FOUND","Unknown netlist node or result");
        const ids = item ? item.paths.flatMap(path => path.nodeIds.map(node => scope.displayNodes.get(node).id)) : [key];
        const values = [...new Set(ids.flatMap(node => record.related?.get(node) || []))].filter(result => result !== item);
        const value = resultPage(values,page,12);
        if (!item) { record.nodeId = key; record.relatedPage = page - 1; paint(); }
        return {...value,entries:value.entries.map(resultSummary)};
      }
      case "analysis locate": selected(record.selected); perform({reconAction:"locate"}); return status();
      case "analysis clear": perform({reconAction:"clear"}); return status();
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
  return { refresh, command, markExport(markup, id) {
    const record = records.get(id || "single");
    if (!active || !record?.selected) return markup;
    const copy = panel.ownerDocument.createElement("div");
    copy.innerHTML = markup;
    highlightNetlistReconvergence(copy, record);
    return copy.innerHTML;
  }, inspect(id, nodeId) {
    if (!active) return;
    const previousSide = selectedSide();
    if (id && inCompare()) side = id;
    const record = records.get(id || "single");
    if (record && record.nodeId !== nodeId) { record.nodeId = nodeId; record.relatedPage = 0; paint(); }
    else if (previousSide !== selectedSide()) paint();
  } };
}
