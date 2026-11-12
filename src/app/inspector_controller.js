import { renderDefinitionRows as statsRows } from "../ui/html.js";
import { getCompareNodeName, findCompareNode } from "./compareWorkspace.js";
import {
  getTimingBadgeChoices,
  renderTimingPanel,
  renderNetTimingPanel,
  bindTimingPanel,
  isTimingBadgePosition,
  updateTimingBadgeChoices
} from "../ui/timingPanel.js";
import { renderObjectDetails, bindObjectDetailsPanel } from "../ui/objectDetailsPanel.js";
import { inspectGraphNode, inspectGraphNet } from "../analysis/graphInspector.js";
import { renderAdjustPanel, bindAdjustPanel } from "../ui/adjustPanel.js";
import { getReadableObjectScale } from "../ui/viewport.js";
import { renderNetRoutingPanel, bindNetRoutingPanel } from "../ui/net_routing_panel.js";

// Legacy workbench adapter. State and elements are restricted ports supplied
// by the composition root; peer actions are explicit, late-bound services.
export function createInspectorController({ state, elements, services, netRouting }) {
  function renderStats() {
    if (state.compare.active && state.compare.analysis) {
      const { left, right, delta, unmatchedPorts, unmatchedNets } = state.compare.analysis;
      const pair = (a, b) => `${a} / ${b}`;
      elements.stats.innerHTML = statsRows([
        ["Cells A/B", pair(left.cells, right.cells)],
        ["Cell delta", signed(delta.cells)],
        ["Depth A/B", pair(left.logicDepth, right.logicDepth)],
        ["Depth delta", signed(delta.logicDepth)],
        ["Max fanout A/B", pair(left.maxFanout, right.maxFanout)],
        ["Fanout delta", signed(delta.maxFanout)],
        ["Gate kinds A", formatGateKinds(left.gateKinds)],
        ["Gate kinds B", formatGateKinds(right.gateKinds)],
        ["Unmatched ports", unmatchedPorts.length],
        ["Unmatched nets A/B", pair(unmatchedNets.left.length, unmatchedNets.right.length)]
      ]);
      return;
    }
    const module = state.currentModule;
    const graph = state.graph;
    if (!module || !graph) {
      elements.stats.innerHTML = statsRows([
        ["Module", module?.displayName || "-"],
        ["Layout", "Pending"]
      ]);
      return;
    }
    elements.stats.innerHTML = statsRows([
      ["Module", module.displayName],
      ["Ports", graph.stats.ports],
      ["Nets", graph.stats.nets],
      ["Cells", graph.stats.cells],
      ["Assigns", graph.stats.assigns],
      ["Timing inst", state.timing?.instanceCount || 0],
      ["Graph nodes", graph.nodes.length],
      ["Graph edges", graph.edges.length]
    ]);
  }

  function signed(value) { return value > 0 ? `+${value}` : String(value); }

  function formatGateKinds(counts) { return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(", ") || "-"; }

  function applyCompareHighlights() {
    const analysis = state.compare.analysis;
    if (!analysis) return;
    const matchedPorts = new Set(analysis.matchedPorts);
    const unmatchedPorts = new Set(analysis.unmatchedPorts);
    const commonNets = new Set(analysis.commonNets);
    for (const side of ["left", "right"]) {
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      const graph = state.compare.graphs[side];
      for (const node of mount.querySelectorAll(".node")) {
        const id = node.dataset.nodeId || "";
        const graphNode = graph.nodes.find((item) => item.id === id);
        const name = getCompareNodeName(graphNode);
        if (matchedPorts.has(name)) node.classList.add("is-compare-match");
        if (unmatchedPorts.has(name)) node.classList.add("is-compare-unmatched");
        if (graphNode?.kind === "cell") {
          node.classList.add(analysis.commonGateKinds.includes(graphNode.gateKind || "blackbox")
            ? "is-compare-match"
            : "is-compare-unmatched");
        }
      }
      for (const edge of mount.querySelectorAll(".edge")) {
        edge.classList.add(commonNets.has(edge.dataset.net) ? "is-compare-match" : "is-compare-unmatched");
      }
    }
    if (state.compare.selectedName) selectCompareObject(state.compare.selectedKind, state.compare.selectedName, false);
  }

  function selectCompareObject(kind, name, focus = true, selectedSide = state.compare.selectedSide) {
    if (!selectedSide) return;
    const peerSide = selectedSide === "left" ? "right" : "left";
    if (compareObjectExists(peerSide, kind, name)) {
      services.compareViewSessions.dispatch(peerSide, {
        type: "selection.set",
        objectRef: services.compareViewSessions.objectRef(peerSide, kind, name)
      });
    }
    services.compareViewSessions.dispatch(selectedSide, {
      type: "selection.set",
      objectRef: services.compareViewSessions.objectRef(selectedSide, kind, name)
    });
    services.updateViewControls();
    for (const element of elements.compareMount.querySelectorAll(".is-selected")) element.classList.remove("is-selected");
    for (const side of ["left", "right"]) {
      const mount = side === "left" ? elements.leftMount : elements.rightMount;
      if (kind === "net") {
        for (const edge of mount.querySelectorAll(".edge")) if (edge.dataset.net === name) edge.classList.add("is-selected");
      } else {
        const graphNode = findCompareNode(state.compare.graphs[side], kind, name);
        if (graphNode) mount.querySelector(`[data-node-id="${services.cssEscape(graphNode.id)}"]`)?.classList.add("is-selected");
      }
    }
    if (focus) focusCompareSelection(kind, name);
    if (kind === "net") {
      renderNetSelection(name, selectedSide);
      services.recordViewHistory();
      return;
    }
    if (kind !== "net" && selectedSide) {
      const node = findCompareNode(state.compare.graphs[selectedSide], kind, name);
      if (node) {
        renderCompareSelection(selectedSide, node);
        services.recordViewHistory();
        return;
      }
    }
    elements.details.className = "details-block";
    elements.details.innerHTML = renderObjectDetails({ kind, summary: [["Kind", kind], ["Present", "highlighted on both sides where available"]], connections: [] },
      inspectionOptions({ kind, id: name, label: name }, selectedSide));
    services.recordViewHistory();
  }

  function clearCompareSelection() {
    for (const side of ["left", "right"]) {
      services.compareViewSessions.dispatch(side, { type: "selection.clear" });
    }
  }

  function compareObjectExists(side, kind, name) {
    if (kind === "net") return Boolean((state.compare.fullGraphs?.[side] || state.compare.graphs?.[side])?.edges?.some((edge) => edge.net === name));
    return Boolean(findCompareNode(state.compare.graphs?.[side], kind, name));
  }

  function getTimingKey(node) {
    return services.getNodeInstance(node) || node?.ref?.name || node?.label || null;
  }

  function renderCompareSelection(side, node) {
    elements.details.className = "details-block";
    const timingKey = getTimingKey(node);
    const choices = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], timingKey);
    const inspection = inspectGraphNode(state.compare.fullGraphs[side] || state.compare.graphs[side], node);
    elements.details.innerHTML = `${renderObjectDetails(inspection, inspectionOptions(node, side))}${renderTimingPanel(node, choices)}${renderAdjustPanel(node, state.calibrationMode)}`;
    bindObjectDetailsPanel(elements.details, inspection);
    bindCompareSelectionControls(side, node);
  }

  function bindCompareSelectionControls(side, node) {
    const instance = services.getNodeInstance(node);
    const timingKey = getTimingKey(node);
    bindTimingPanel(elements.details, {
      onPositionChange: (position) => {
        if (!timingKey || !isTimingBadgePosition(position)) return;
        state.compare.timingBadgePositions[side][timingKey] = position;
        services.renderCompareGraphs();
      },
      onBadgeToggle: (pin, metric, checked) => {
        if (!timingKey) return;
        const current = getTimingBadgeChoices(node, state.compare.timingBadgeChoices[side], timingKey);
        state.compare.timingBadgeChoices[side][timingKey] = updateTimingBadgeChoices(current, pin, metric, checked);
        services.renderCompareGraphs();
      },
      onReset: () => {
        if (timingKey) delete state.compare.timingBadgeChoices[side][timingKey];
        services.renderCompareGraphs();
      }
    });
    bindAdjustPanel(elements.details, node, state.calibrationMode, {
      onSizeChange: (size) => {
        services.updateCompareOverrides(side, (overrides) => overrides.nodeSizes.set(node.id, {
          width: services.clamp(Number(size.width), 24, 420),
          height: services.clamp(Number(size.height), 12, 260)
        }));
        services.renderCompareGraphs();
      },
      onResetSize: () => {
        services.updateCompareOverrides(side, (overrides) => overrides.nodeSizes.delete(node.id));
        services.renderCompareGraphs();
      },
      onPropertyChange: (property, value) => {
        if (!services.isEditableNodeProperty(property)) return;
        const trimmed = String(value ?? "").trim();
        services.updateCompareOverrides(side, (snapshot) => {
          const overrides = snapshot.graphOverrides.nodeProperties;
          overrides[node.id] ||= {};
          if (trimmed) overrides[node.id][property] = trimmed;
          else delete overrides[node.id][property];
          if (Object.keys(overrides[node.id]).length === 0) delete overrides[node.id];
        });
        services.renderCompareGraphs();
      },
      onResetProperties: () => {
        services.updateCompareOverrides(side, (overrides) => delete overrides.graphOverrides.nodeProperties[node.id]);
        services.renderCompareGraphs();
      },
      onPinDirectionChange: (pin, direction) => {
        if (!instance) return;
        services.updateCompareOverrides(side, (overrides) => {
          const pins = overrides.graphOverrides.cellPinDirections[instance] ||= {};
          pins[pin] = direction;
        });
        services.renderCompareGraphs();
      },
      onResetPinDirections: () => {
        if (instance) services.updateCompareOverrides(side, (overrides) => delete overrides.graphOverrides.cellPinDirections[instance]);
        services.renderCompareGraphs();
      }
    });
  }

  function focusCompareSelection(kind, name) {
    for (const side of ["left", "right"]) {
      const graph = state.compare.graphs[side];
      const svg = (side === "left" ? elements.leftMount : elements.rightMount).querySelector("svg");
      const node = kind === "net" ? null : findCompareNode(graph, kind, name);
      const edgePoint = kind === "net"
        ? services.getEdgeCenter(graph?.edges.find((edge) => edge.net === name))
        : null;
      if ((!node && !edgePoint) || !svg) continue;
      const objectWidth = node?.width || 100;
      const point = edgePoint || {
        x: node.x + node.width / 2,
        y: node.y + node.height / 2
      };
      const scale = getReadableObjectScale({
        viewBoxWidth: svg.viewBox.baseVal.width,
        viewportWidth: svg.getBoundingClientRect().width,
        viewBoxHeight: svg.viewBox.baseVal.height,
        viewportHeight: svg.getBoundingClientRect().height,
        objectWidth,
        currentScale: state.compare.transforms[side].scale
      });
      services.setCompareTransform(side, {
        x: svg.viewBox.baseVal.width / 2 - point.x * scale,
        y: svg.viewBox.baseVal.height / 2 - point.y * scale,
        scale
      }, false);
    }
    services.applyCompareTransforms();
  }

  function renderSelection(node) {
    if (!node) {
      services.updateCellDefinitionControls(null);
      elements.details.className = "details-empty";
      elements.details.textContent = "Select a cell, net or port to inspect its connections.";
      return;
    }

    services.updateCellDefinitionControls(node);

    elements.details.className = "details-block";
    const timingKey = getTimingKey(node);
    const timingChoices = getTimingBadgeChoices(node, state.timingBadgeChoices, timingKey);
    const inspection = inspectGraphNode(state.fullGraph || state.graph, node, {
      hierarchyContext: currentHierarchyInspectionContext()
    });
    elements.details.innerHTML = `${renderObjectDetails(inspection, inspectionOptions(node))}${renderTimingPanel(node, timingChoices)}${renderAdjustPanel(node, state.calibrationMode)}`;
    bindObjectDetailsPanel(elements.details, inspection);
    bindSelectionControls(node);
  }

  function renderNetSelection(netName, side = null) {
    services.updateCellDefinitionControls(null);
    elements.details.className = "details-block";
    const activeGraph = side
      ? state.compare.fullGraphs[side] || state.compare.graphs[side]
      : state.fullGraph || state.graph;
    const netTiming = activeGraph?.netTiming?.[netName] || null;
    const inspection = inspectGraphNet(activeGraph, netName, {
      hierarchyContext: side ? null : currentHierarchyInspectionContext()
    });
    const label = inspection.summary.find(([key]) => key === "Name")?.[1] || netName;
    elements.details.innerHTML = `${renderObjectDetails(inspection, {
      ...inspectionOptions({ kind: "net", id: netName, label, ref: { name: netName } }, side),
      connectionTools: netRouting && netName ? renderNetRoutingPanel(netRouting.isEnabled(netName, side)) : ""
    })}${renderNetTimingPanel(netTiming)}`;
    bindObjectDetailsPanel(elements.details, inspection);
    if (netRouting && netName) bindNetRoutingPanel(elements.details, (enabled) => {
      netRouting.setEnabled(netName, enabled, side);
      renderNetSelection(netName, side);
    });
  }

  function currentHierarchyInspectionContext() {
    return {
      design: state.design,
      currentModule: state.currentModule,
      rootModuleName: state.occurrenceContext?.rootModuleName,
      occurrencePath: state.occurrenceContext?.occurrencePath || []
    };
  }

  function inspectionOptions(node, side = null) {
    const graph = side ? state.compare.fullGraphs?.[side] || state.compare.graphs?.[side] : state.fullGraph || state.graph;
    const moduleName = graph?.moduleName || state.currentModule?.name || "";
    const occurrencePath = node.ref?.occurrencePath || (side ? [] : state.occurrenceContext?.occurrencePath || []);
    return {
      identity: JSON.stringify([side || "single", moduleName, occurrencePath, node.kind, node.id]),
      label: node.label,
      canonicalName: node.ref?.instance || node.ref?.name || node.label || node.id,
      scope: `${side ? `${side === "left" ? "A" : "B"} · Compare` : "Single"}${moduleName ? ` · ${moduleName}` : ""}${occurrencePath.length ? ` / ${occurrencePath.join("/")}` : ""}`
    };
  }

  function renderDiagnostics() {
    const diagnostics = [
      ...(state.design?.diagnostics || []),
      ...(state.compare.active ? [] : (state.graph?.diagnostics || [])),
      ...(state.compare.active ? (state.compare.graphs?.left?.diagnostics || []) : []),
      ...(state.compare.active ? (state.compare.graphs?.right?.diagnostics || []) : [])
    ];

    elements.diagnostics.innerHTML = "";
    if (diagnostics.length === 0) {
      const item = document.createElement("li");
      item.textContent = "No diagnostics";
      elements.diagnostics.append(item);
      return;
    }

    for (const diagnostic of diagnostics) {
      const item = document.createElement("li");
      item.textContent = diagnostic.message;
      elements.diagnostics.append(item);
    }
  }

  function bindSelectionControls(node) {
    const instance = services.getNodeInstance(node);
    const timingKey = getTimingKey(node);
    bindTimingPanel(elements.details, {
      onPositionChange: (position) => updateTimingBadgePosition(node, position),
      onBadgeToggle: (pin, metric, checked) =>
        updateTimingBadgeChoice(node, pin, metric, checked),
      onReset: () => {
        if (timingKey) {
          delete state.timingBadgeChoices[timingKey];
        }
        rerenderPreservingView(node.id);
        services.setStatus(`${node.label}: timing badges reset to default`);
      }
    });

    bindAdjustPanel(elements.details, node, state.calibrationMode, {
      onSizeChange: (size) => updateNodeSize(node.id, size),
      onResetSize: () => {
        services.updateSingleOverrides((overrides) => overrides.nodeSizes.delete(node.id));
        rerenderPreservingView(node.id);
        services.setStatus(`${node.label}: size reset`);
      },
      onPropertyChange: (property, value) => updateNodeProperty(node.id, property, value),
      onResetProperties: () => {
        services.updateSingleOverrides((overrides) => delete overrides.graphOverrides.nodeProperties[node.id]);
        rerenderPreservingView(node.id);
        services.setStatus(`${node.label}: properties reset`);
      },
      onPinDirectionChange: (pin, direction) => updateCellPinDirection(node, pin, direction),
      onResetPinDirections: () => {
        if (instance) {
          services.updateSingleOverrides((overrides) => delete overrides.graphOverrides.cellPinDirections[instance]);
        }
        rerenderPreservingView(node.id);
        services.setStatus(`${node.label}: pin directions reset`);
      }
    });
  }

  function updateTimingBadgePosition(node, position) {
    const timingKey = getTimingKey(node);
    if (!timingKey || !isTimingBadgePosition(position)) {
      return;
    }
    state.timingBadgePositions[timingKey] = position;
    rerenderPreservingView(node.id);
    services.setStatus(`${node.label}: timing badges ${position}`);
  }

  function updateNodeSize(nodeId, size) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    const nextSize = {
      width: services.clamp(Number(size.width), 24, 420),
      height: services.clamp(Number(size.height), 12, 260)
    };
    const previous = state.nodeSizes.get(nodeId);
    if (previous?.width === nextSize.width && previous?.height === nextSize.height) {
      return;
    }

    services.updateSingleOverrides((overrides) => overrides.nodeSizes.set(nodeId, nextSize));
    rerenderPreservingView(nodeId);
    services.setStatus(`${node.label}: width=${nextSize.width}, height=${nextSize.height}`);
  }

  function updateNodeProperty(nodeId, property, value) {
    const node = state.graph?.nodes.find((item) => item.id === nodeId);
    if (!node || !services.isEditableNodeProperty(property)) {
      return;
    }
    const trimmed = String(value ?? "").trim();
    services.updateSingleOverrides((overrides) => {
      const properties = overrides.graphOverrides.nodeProperties[nodeId] ||= {};
      if (trimmed === "") delete properties[property];
      else properties[property] = trimmed;
      if (Object.keys(properties).length === 0) delete overrides.graphOverrides.nodeProperties[nodeId];
    });
    rerenderPreservingView(nodeId);
    services.setStatus(`${node.label}: ${property} updated`);
  }

  function updateCellPinDirection(node, pinName, direction) {
    const instance = services.getNodeInstance(node);
    if (!instance || (direction !== "input" && direction !== "output")) {
      return;
    }
    services.updateSingleOverrides((overrides) => {
      const pins = overrides.graphOverrides.cellPinDirections[instance] ||= {};
      pins[pinName] = direction;
    });
    rerenderPreservingView(node.id);
    services.setStatus(`${node.label}.${pinName}: ${direction}`);
  }

  function updateTimingBadgeChoice(node, pin, metric, checked) {
    const timingKey = getTimingKey(node);
    if (!timingKey) {
      return;
    }
    const choices = getTimingBadgeChoices(node, state.timingBadgeChoices, timingKey);
    state.timingBadgeChoices[timingKey] = updateTimingBadgeChoices(choices, pin, metric, checked);
    rerenderPreservingView(node.id);
    services.setStatus(`${node.label}: ${checked ? "show" : "hide"} ${pin} ${metric}`);
  }

  function rerenderPreservingView(selectedNodeId, options = {}) {
    const previousTransform = { ...state.transform };
    services.renderCurrentModuleGraph(options);
    services.setSingleTransform(previousTransform);
    services.setSelectedNode(selectedNodeId);
    services.applyTransform();
  }

  return Object.freeze({ renderStats, signed, formatGateKinds, applyCompareHighlights, selectCompareObject, clearCompareSelection, compareObjectExists, renderCompareSelection, bindCompareSelectionControls, focusCompareSelection, renderSelection, renderNetSelection, currentHierarchyInspectionContext, renderDiagnostics, bindSelectionControls, updateTimingBadgePosition, updateNodeSize, updateNodeProperty, updateCellPinDirection, updateTimingBadgeChoice, rerenderPreservingView });
}

export const inspectorPorts = Object.freeze({
  state: [
    "calibrationMode", "compare", "currentModule", "design", "fullGraph", "graph", "nodeSizes",
    "occurrenceContext", "timing", "timingBadgeChoices", "timingBadgePositions", "transform"
  ],
  elements: [
    "compareMount", "details", "diagnostics", "leftMount", "rightMount", "stats"
  ],
  services: [
    "applyCompareTransforms", "applyTransform", "clamp", "compareViewSessions", "cssEscape",
    "getEdgeCenter", "getNodeInstance", "isEditableNodeProperty", "recordViewHistory",
    "renderCompareGraphs", "renderCurrentModuleGraph", "setCompareTransform", "setSelectedNode",
    "setSingleTransform", "setStatus", "updateCellDefinitionControls", "updateCompareOverrides",
    "updateSingleOverrides", "updateViewControls"
  ]
});
