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
  return { viewMode: ids.length ? "focused" : "whole", focusedRootRefs,
    activeFocusedRootRef: focusedRootRefs.find((ref) => ref.localId === value?.activeFocusedRootNodeId) || focusedRootRefs[0] || null,
    faninDepth: normalizeViewDepth(value?.faninDepth), fanoutDepth: normalizeViewDepth(value?.fanoutDepth) };
}

export function queryAigView(document, session = {}) {
  const imported = document.model;
  if (session.viewMode !== "focused" && session.mode !== "focused") return imported;
  const { model, analysis } = imported;
  const rootNodeIds = normalizeFocusedRootIds(session.focusedRootRefs?.map((ref) => ref.localId) ?? session.rootNodeIds);
  const focus = analyzeFocusedNeighborhood(model, rootNodeIds, { rootNodeIds, ...DEFAULT_FOCUSED_VIEW_POLICY,
    faninDepth: normalizeViewDepth(session.faninDepth), fanoutDepth: normalizeViewDepth(session.fanoutDepth) });
  const full = createAigQuery(model, analysis);
  const visibleNodeIds = new Set(focus.nodeIds.sort());
  const visibleEdgeIds = new Set(focus.edgeIds.sort());
  const analysisModel = { nodes: [...visibleNodeIds].map((id) => full.nodeById.get(id)),
    edges: [...visibleEdgeIds].map((id) => full.edgeById.get(id)) };
  const boundary = projectCut(focus, visibleNodeIds, full);
  const displayModel = { focused: true, nodes: [...analysisModel.nodes, ...boundary.nodes], edges: [...analysisModel.edges, ...boundary.edges] };
  const displayAnalysis = analyzeAig(displayModel);
  // The logical critical path and fanout refer to the source design. Only
  // connections in this display model participate in selection traversal.
  displayAnalysis.fanout = analysis.fanout;
  displayAnalysis.criticalNodes = focus.nodeIds.filter((id) => full.criticalNodes.has(id));
  displayAnalysis.criticalEdges = focus.edgeIds.filter((id) => full.criticalEdges.has(id));
  return { model: displayModel, analysis: displayAnalysis, analysisModel, visibleNodeIds, visibleEdgeIds,
    analysisScopeId: visibleNodeIds.size === model.nodes.length ? "whole" : JSON.stringify(focus.nodeIds),
    analysisScopeLabel: `focused(${rootNodeIds.join(",")}) in=${focus.faninDepth} out=${focus.fanoutDepth}`,
    truncated: focus.truncated, hiddenEndpointCount: focus.hiddenEndpointCount };
}

function projectCut(focus, visible, query) {
  const groups = new Map();
  for (const edge of focus.cutEdges) {
    const outgoing = visible.has(edge.source);
    const depth = outgoing ? focus.fanout.depthByNode.get(edge.source) : focus.fanin.depthByNode.get(edge.target);
    const reason = depth < (outgoing ? focus.fanoutDepth : focus.faninDepth) ? "budget" : "depth";
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
    const ref = driver.nameMappings?.[0] || driver.sourceRefs?.[0];
    const name = (ref?.inverted ? "¬" : "") + (ref?.name || ref?.label || driver.label || driver.id);
    const id = `cut:${key}`;
    const label = outgoing ? `Out · ${name} ×${count}` : `In · ${name}`;
    const description = `${outgoing ? "Downstream" : "Upstream"} · ${label} · ${edge.inverted ? "inverted" : "positive"} · Focused ${reason} boundary`;
    nodes.push({ id, kind: "boundary", label, description, level: driver.level + Number(outgoing), sourceRefs: [] });
    edges.push({ id: `cut-edge:${key}`, source: outgoing ? edge.source : id, target: outgoing ? id : edge.target,
      slot: outgoing ? 0 : edge.slot, inverted: edge.inverted, description, sourceRefs: [] });
  }
  return { nodes, edges };
}
