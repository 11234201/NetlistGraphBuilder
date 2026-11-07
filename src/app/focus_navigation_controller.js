import { findCompareNode } from "./compareWorkspace.js";
import { getFocusedObjectTransform, getAdaptiveMaxScale } from "../ui/viewport.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createFocusNavigationController({ state, elements, services }) {
  function focusSelectedCell() {
    if (state.compare.active) {
      if (state.compare.selectedKind === "net" && state.compare.selectedName) {
        const side = state.compare.selectedSide || "left";
        const graph = state.compare.graphs[side];
        const edge = graph?.edges.find((item) => item.net === state.compare.selectedName);
        const mount = side === "left" ? elements.leftMount : elements.rightMount;
        if (edge) {
          focusPositionedEdge(edge, mount, state.compare.transforms[side], (transform) => services.setCompareTransform(side, transform));
          services.applyCompareTransforms();
        }
        services.recordViewHistory();
        services.setStatus(`Focused compare net ${state.compare.selectedName}`);
        return;
      }
      focusSelectedCompareCell();
      return;
    }
    if (state.selectedNet) {
      const edge = state.graph?.edges.find((item) => item.net === state.selectedNet);
      if (edge) {
        focusPositionedEdge(edge, elements.mount, state.transform, services.setSingleTransform);
        services.applyTransform();
        services.setStatus(`Focused net ${state.selectedNet}`);
        services.recordViewHistory();
      }
      return;
    }
    const selectedNodeId = state.selectedNodeId;
    const fullNode = state.fullGraph?.nodes.find((node) => node.id === selectedNodeId && node.kind === "cell");
    if (!fullNode) return;
    const positioned = state.graph?.nodes.find((node) => node.id === selectedNodeId);
    if (positioned) {
      focusPositionedCell(positioned, elements.mount, state.transform, services.setSingleTransform);
      services.applyTransform();
      services.setStatus(`Focused ${fullNode.label}`);
      services.recordViewHistory();
      return;
    }

    const requestId = ++state.selectionFocusRequestId;
    services.singleViewSession.dispatch({
      type: "focus.set",
      objectRef: services.singleViewSession.objectRefForNode(fullNode)
    });
    services.renderCurrentModuleGraph({
      onRendered: (graph) => {
        if (requestId !== state.selectionFocusRequestId || state.selectedNodeId !== selectedNodeId) return;
        const node = graph.nodes.find((item) => item.id === selectedNodeId);
        if (!node) return;
        focusPositionedCell(node, elements.mount, state.transform, services.setSingleTransform);
        services.setSelectedNode(selectedNodeId, false);
        services.applyTransform();
        services.recordViewHistory();
        services.setStatus(`Focused ${node.label} in a new neighborhood`);
      }
    });
  }

  function selectStartupModule(moduleName) {
    const module = state.design?.modules.find(
      (item) => item.name === moduleName || item.displayName === moduleName
    );
    if (!module) return Promise.reject(new Error(`Startup module not found: ${moduleName}`));
    if (state.currentModule?.name === module.name) return Promise.resolve();
    return new Promise((resolve) => services.selectModule(module.name, { onRendered: resolve }));
  }

  function focusStartupCell(value) {
    return focusStartupCells([value]);
  }

  function focusStartupCells(values) {
    const focusTargets = (Array.isArray(values) ? values : [values]).map(normalizeStartupFocusTarget);
    const occurrenceTarget = focusTargets.find((target) => target.occurrencePath?.length);
    if (occurrenceTarget && !sameOccurrencePath(state.occurrenceContext?.occurrencePath, occurrenceTarget.occurrencePath)) {
      return new Promise((resolve, reject) => {
        services.selectModule(state.currentModule.name, {
          rootModuleName: occurrenceTarget.rootModuleName,
          occurrencePath: occurrenceTarget.occurrencePath,
          onRendered: () => focusStartupCells(values).then(resolve, reject)
        });
      });
    }
    const nodes = focusTargets.map((target) => {
      if (target.kind !== "cell") return null;
      const focus = target.localId.replace(/^cell:/, "");
      return state.fullGraph?.nodes.find((item) => {
        if (item.kind !== "cell") return false;
        if (!sameOccurrencePath(item.ref?.occurrencePath, target.occurrencePath)) return false;
        return [item.id, item.id.replace(/^cell:/, ""), item.label, item.ref?.instance, item.ref?.instanceDisplayName]
          .includes(target.localId) || item.ref?.instance === focus;
      });
    });
    const missingIndex = focusTargets.findIndex((target, index) => {
      if (target.kind === "net") {
        return !state.fullGraph?.edges?.some((edge) => edge.net === target.localId);
      }
      return !nodes[index];
    });
    if (missingIndex >= 0) {
      return Promise.reject(new Error(`Startup focus cell not found: ${focusTargets[missingIndex].localId}`));
    }
    const objectRefs = focusTargets.map((target, index) => target.kind === "net"
      ? services.singleViewSession.objectRefForNet(target.localId)
      : services.singleViewSession.objectRefForNode(nodes[index]));
    const activeObjectRef = objectRefs[0] || null;
    services.singleViewSession.dispatch({
      type: "focus.replace",
      objectRefs,
      activeObjectRef
    });
    const firstNodeId = nodes[0]?.id || null;
    if (focusTargets[0]?.kind === "net") services.setSelectedNet(focusTargets[0].localId);
    else services.setSelectedNode(firstNodeId);
    services.setSingleTransform({ x: 0, y: 0, scale: 1 });
    services.updateViewControls();
    return new Promise((resolve) => {
      services.renderCurrentModuleGraph({
        onRendered: (graph) => {
          if (focusTargets[0]?.kind === "net") {
            const edge = graph.edges.find((item) => item.net === focusTargets[0].localId);
            services.setSelectedNet(focusTargets[0].localId);
            if (edge) services.centerGraphPoint(services.getEdgeCenter(edge));
          } else {
            const positioned = graph.nodes.find((item) => item.id === firstNodeId);
            services.setSelectedNode(positioned?.id || null);
            if (positioned) {
              focusPositionedCell(positioned, elements.mount, state.transform, services.setSingleTransform);
              services.applyTransform();
            }
          }
          if (focusTargets[0]?.kind === "net") {
            services.applyTransform();
          }
          resolve();
        }
      });
    });
  }

  function normalizeStartupFocusTarget(value) {
    if (value && typeof value === "object") {
      return {
        kind: value.kind === "net" ? "net" : "cell",
        localId: String(value.localId || value.name || "").trim(),
        rootModuleName: value.rootModuleName || null,
        occurrencePath: Array.isArray(value.occurrencePath) ? [...value.occurrencePath] : []
      };
    }
    return { kind: "cell", localId: String(value || "").replace(/^cell:/, "").trim(), occurrencePath: [] };
  }

  function sameOccurrencePath(left, right) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    return a.length === b.length && a.every((segment, index) => segment === b[index]);
  }

  function focusSelectedCompareCell() {
    if (state.compare.selectedKind !== "cell" || !state.compare.selectedName) return;
    const activeSide = state.compare.selectedSide || "left";
    const sides = state.compare.synchronized ? ["left", "right"] : [activeSide];
    for (const side of sides) {
      const node = findCompareNode(state.compare.graphs[side], "cell", state.compare.selectedName);
      if (!node) continue;
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      focusPositionedCell(node, mount, state.compare.transforms[side], (transform) => {
        services.setCompareTransform(side, transform);
      });
    }
    services.applyCompareTransforms();
    services.recordViewHistory();
    services.setStatus(`Focused compare cell ${state.compare.selectedName}`);
  }

  function focusPositionedCell(node, mount, currentTransform, commit) {
    const svg = mount.querySelector("svg");
    if (!svg) return;
    const viewport = svg.getBoundingClientRect();
    commit(getFocusedObjectTransform({
      viewBox: svg.viewBox.baseVal,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      bounds: node,
      targetPixels: 320,
      minimumScale: 0.25,
      maximumScale: getAdaptiveMaxScale(
        svg.viewBox.baseVal.width,
        viewport.width,
        svg.viewBox.baseVal.height,
        viewport.height
      ),
      currentTransform
    }));
  }

  function focusPositionedEdge(edge, mount, currentTransform, commit) {
    const point = services.getEdgeCenter(edge);
    const svg = mount.querySelector("svg");
    if (!point || !svg) return;
    const viewport = svg.getBoundingClientRect();
    commit(getFocusedObjectTransform({
      viewBox: svg.viewBox.baseVal,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      bounds: { x: point.x - 50, y: point.y - 18, width: 100, height: 36 },
      targetPixels: 260,
      minimumScale: 0.25,
      maximumScale: getAdaptiveMaxScale(
        svg.viewBox.baseVal.width,
        viewport.width,
        svg.viewBox.baseVal.height,
        viewport.height
      ),
      currentTransform
    }));
  }

  return Object.freeze({ focusSelectedCell, selectStartupModule, focusStartupCell, focusStartupCells, normalizeStartupFocusTarget, sameOccurrencePath, focusSelectedCompareCell, focusPositionedCell, focusPositionedEdge });
}

export const focusNavigationPorts = Object.freeze({
  state: [
    "compare", "currentModule", "design", "fullGraph", "graph", "occurrenceContext", "selectedNet",
    "selectedNodeId", "selectionFocusRequestId", "transform"
  ],
  elements: [
    "leftMount", "mount", "rightMount"
  ],
  services: [
    "applyCompareTransforms", "applyTransform", "centerGraphPoint", "getEdgeCenter",
    "recordViewHistory", "renderCurrentModuleGraph", "selectModule", "setCompareTransform",
    "setSelectedNet", "setSelectedNode", "setSingleTransform", "setStatus", "singleViewSession",
    "updateViewControls"
  ]
});
