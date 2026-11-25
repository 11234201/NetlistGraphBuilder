import { aigPathIndex } from "./show_path.js";
import { analyzeFocusedNeighborhood } from "../../analysis/graphCone.js";
import { DEFAULT_FOCUSED_VIEW_POLICY, normalizeFocusedRootIds } from "../../foundation/view_policy.js";
import { normalizeViewDepth } from "../../contracts/view_query.js";
import { createObjectRef } from "../../contracts/object_ref.js";
import { createAigQuery } from "./aig_query.js";
import { analyzeAig } from "./aig_analysis.js";

export function restoreAigFocus(document, unitId, value) {
  const { model, analysis } = document.model;
  const query = createAigQuery(model, analysis);
  const requested = value?.focusedRootNodeIds || [];
  const ids = normalizeFocusedRootIds(requested).filter((id) => query.nodeById.has(id));
  const focusedRootRefs = ids.map((id) => createObjectRef({ documentId: document.documentId, unitId,
    localId: id, kind: query.nodeById.get(id).kind }));
  const deferWholeLayout = value?.deferWholeLayout === true || value?.viewMode === "search-first";
  return { showPath: value?.showPath || null, viewMode: ids.length ? "focused" : deferWholeLayout ? "search-first" : "whole",
    layoutPolicy: { deferWholeLayout }, focusedRootRefs,
    activeFocusedRootRef: focusedRootRefs.find((ref) => ref.localId === value?.activeFocusedRootNodeId) || focusedRootRefs[0] || null,
    faninDepth: normalizeViewDepth(value?.faninDepth), fanoutDepth: normalizeViewDepth(value?.fanoutDepth) };
}

export function queryAigView(document, session = {}) {
  const imported = document.model;
  const focused = session.viewMode === "focused" || session.mode === "focused";
  if (!focused && !session.showPath?.enabled) {
    if ((session.viewMode || session.mode) !== "search-first") return imported;
    const model = { nodes: [], edges: [] };
    return { searchFirst: true, model, analysis: analyzeAig(model),
      analysisScopeId: "search-first", analysisScopeLabel: "search-first" };
  }
  const { model, analysis } = imported;
  const path = session.showPath?.enabled ? aigPathIndex(model).query(session.showPath) : null;
  const pathGraph = path ? { nodes: model.nodes.filter((n) => path.nodeIds.has(n.id)),
    edges: model.edges.filter((e) => path.edgeIds.has(e.id)) } : model;
  const rootNodeIds = normalizeFocusedRootIds(session.focusedRootRefs?.map((ref) => ref.localId) ?? session.rootNodeIds);
  const focus = focused ? analyzeFocusedNeighborhood(pathGraph, rootNodeIds, { rootNodeIds, ...DEFAULT_FOCUSED_VIEW_POLICY,
    faninDepth: normalizeViewDepth(session.faninDepth), fanoutDepth: normalizeViewDepth(session.fanoutDepth) }) : { nodeIds: pathGraph.nodes.map((n) => n.id),
      edgeIds: pathGraph.edges.map((e) => e.id), cutEdges: [], truncated: false, hiddenEndpointCount: 0 };
  const full = createAigQuery(model, analysis);
  const visibleNodeIds = new Set(focus.nodeIds.sort());
  const visibleEdgeIds = new Set(focus.edgeIds.sort());
  const analysisModel = { nodes: [...visibleNodeIds].map((id) => full.nodeById.get(id)),
    edges: [...visibleEdgeIds].map((id) => full.edgeById.get(id)) };
  const boundary = projectCut(focus, visibleNodeIds, full);
  if (path) {
    const cutEdges = model.edges.filter((edge) => visibleNodeIds.has(edge.target) && !path.edgeIds.has(edge.id));
    const inputs = projectCut({ cutEdges }, visibleNodeIds, full, true);
    boundary.nodes = boundary.nodes.concat(inputs.nodes);
    boundary.edges = boundary.edges.concat(inputs.edges);
  }
  const displayModel = { focused: true, ...(model.hasInputLevelOffsets && { hasInputLevelOffsets: true }),
    nodes: [...analysisModel.nodes, ...boundary.nodes], edges: [...analysisModel.edges, ...boundary.edges] };
  const displayAnalysis = analyzeAig(displayModel);
  // The logical critical path and fanout refer to the source design. Only
  // connections in this display model participate in selection traversal.
  displayAnalysis.fanout = analysis.fanout;
  displayAnalysis.criticalNodes = focus.nodeIds.filter((id) => full.criticalNodes.has(id));
  displayAnalysis.criticalEdges = focus.edgeIds.filter((id) => full.criticalEdges.has(id));
  return { path, outsideRoots: path ? rootNodeIds.filter((id) => !path.nodeIds.has(id)) : [], model: displayModel, analysis: displayAnalysis, analysisModel, visibleNodeIds, visibleEdgeIds,
    analysisScopeId: visibleNodeIds.size === model.nodes.length && visibleEdgeIds.size === model.edges.length ? "whole" : JSON.stringify([focus.nodeIds, focus.edgeIds]),
    analysisScopeLabel: (focused ? `focused(${rootNodeIds.join(",")}) in=${focus.faninDepth} out=${focus.fanoutDepth}` : "whole") + (path ? " · Show Path" : ""),
    truncated: focus.truncated, hiddenEndpointCount: focus.hiddenEndpointCount };
}

function projectCut(focus, visible, query, pathInput = false) {
  const groups = new Map();
  for (const edge of focus.cutEdges) {
    const outgoing = !pathInput && visible.has(edge.source);
    const depth = pathInput ? 0 : outgoing ? focus.fanout.depthByNode.get(edge.source) : focus.fanin.depthByNode.get(edge.target);
    const reason = pathInput ? "path" : depth < (outgoing ? focus.fanoutDepth : focus.faninDepth) ? "budget" : "depth";
    // An AND has two input slots. Preserve each cut input and collect external
    // loads of one output by polarity so a high-fanout cut stays compact.
    const key = outgoing ? `out:${edge.source}:${Number(edge.inverted)}:${reason}` : `in:${edge.id}`;
    const group = groups.get(key);
    if (group) group.count++;
    else groups.set(key, { outgoing, edge, reason, count: 1 });
  }
  const nodes = [], edges = [];
  for (const key of [...groups.keys()].sort()) {
    const { outgoing, edge, reason, count } = groups.get(key);
    const driver = query.nodeById.get(edge.source);
    const ref = driver.primaryNameMapping || driver.sourceRefs?.[0];
    const name = (ref?.inverted ? "¬" : "") + (ref?.name || ref?.signalId || ref?.label || driver.label || driver.id);
    const id = `cut:${key}`;
    const label = outgoing ? `Out · ${name} ×${count}` : `In · ${name}`;
    const description = `${outgoing ? "Downstream" : "Upstream"} · ${label} · ${edge.inverted ? "inverted" : "positive"} · ${pathInput ? "Show Path input" : "Focused " + reason} boundary`;
    nodes.push({ id, kind: "boundary", label, description, level: driver.level,
      boundaryDirection: outgoing ? "out" : "in", sourceRefs: [] });
    edges.push({ id: `cut-edge:${key}`, source: outgoing ? edge.source : id, target: outgoing ? id : edge.target,
      slot: outgoing ? 0 : edge.slot, inverted: edge.inverted, description, sourceRefs: [] });
  }
  return { nodes, edges };
}
