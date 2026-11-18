import { findSearchTargetNode } from "./searchLocatePolicy.js";
import { netPathKey } from "../domains/netlist/show_path.js";

const views = new WeakMap();
const displayCuts = new WeakMap();
export function pathDisplayBoundaries(graph) {
  if (!displayCuts.has(graph)) displayCuts.set(graph, graph.nodes.filter((n) =>
    n.kind === "boundary" || n.kind === "focus-input" || n.kind === "focus-output").map((n) => ({
      id: n.id, displayId: n.id, label: n.label, description: n.description || n.subtitle, reachable: true
    })));
  return displayCuts.get(graph);
}
function visibleNodes(graph) {
  let nodes = views.get(graph);
  if (!nodes) { nodes = new Map(graph.nodes.map((n) => [n.id, n])); views.set(graph, nodes); }
  return nodes;
}

export function netlistPathContext({ document, session, side, graph, full, occurrence, selectedKey, locate, render, commit, remember, feature }) {
  if (!graph || !full || !session || graph.moduleName !== session.unitId || !document) return null;
  const diagnostic = { documentId: document.documentId, documentRevision: document.sourceRevision, moduleName: session.unitId,
    occurrencePath: occurrence, sessionId: session.sessionId, side, viewMode: session.viewMode };
  const scope = JSON.stringify([document.documentId, document.sourceRevision, session.sessionId, session.unitId, occurrence]);
  return { scope, diagnostic, graph, side, selectedKey, query: session.showPath, path: graph.path, label: session.unitId,
    index: () => feature.pathIndex(full), locate,
    get boundaries() { return pathDisplayBoundaries(graph); },
    visible: (id) => visibleNodes(graph).has(id),
    get notes() {
      const roots = session.focusedRootRefs.filter((ref) => {
        if (ref.kind === "net") return !feature.pathIndex(full).endpoints.get(netPathKey(ref.localId))?.starts.some((id) => graph.path.levels.has(id));
        const node = findSearchTargetNode({ kind: ["input", "output"].includes(ref.kind) ? "port" : ref.kind,
          direction: ref.kind, name: ref.localId }, full);
        return node && !graph.path.nodeIds.has(node.id);
      });
      return [...(roots.length ? ["Roots outside Show Path: " + roots.map((r) => r.localId).join(", ")] : []),
        ...(graph.view?.truncated ? ["Focused budget reached"] : []),
        ...(!graph.nodes.length && graph.path?.nodeIds.size ? ["No visible roots. Choose Whole or change Focused roots."] : [])];
    },
    searchKey(result) {
      if (result.moduleName !== session.unitId) return null;
      return result.target?.kind === "net" ? netPathKey(result.target.name) : findSearchTargetNode(result.target, full)?.id;
    },
    apply(candidate, signal, pathCurrent) {
      return new Promise((resolve, reject) => {
        const done = () => { remember(); resolve(true); };
        render({ pathCandidate: side ? { [side]: candidate } : candidate, signal, pathCurrent,
          commitPath: () => commit(candidate), onRendered: done, onCommitted: done, onCancelled: () => resolve(false), onFailed: reject });
      });
    }
  };
}

export function aigPathContext(ws, session, select, apply) {
  const model = ws.document.model.model;
  const selected = session.selectedObjectRef?.localId;
  return { scope: ws.document.documentId, label: ws.document.model.name, query: session.showPath,
    graph: ws.displayModel, path: ws.path, selectedKey: ws.query.nodeById.has(selected) ? selected : null,
    notes: [...(ws.outsideRoots.length ? ["Roots outside Show Path: " + ws.outsideRoots.join(", ")] : []),
      ...(ws.truncated ? ["Focused budget reached"] : [])],
    diagnostic: { documentId: ws.document.documentId, documentRevision: ws.document.sourceRevision,
      sessionId: session.sessionId, viewScopeId: ws.analysisScopeLabel },
    get boundaries() { return pathDisplayBoundaries(ws.displayModel); },
    index: () => ws.feature.pathIndex(model), visible: (id) => ws.positionedNodes.has(id), locate: select,
    searchKey(result) {
      const endpoints = ws.feature.pathIndex(model).endpoints;
      const bindings = (result.bindings || []).map((r) => JSON.stringify([result.id, r.signalId || r.id,
        r.name || r.label || r.id, Boolean(r.inverted), r.usage || result.kind]));
      if (bindings.length > 1) return null;
      return endpoints.has(bindings[0]) ? bindings[0] : result.id;
    },
    apply
  };
}
