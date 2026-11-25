import { renderDefinitionRows as statsRows } from "../ui/html.js";
import { renderModuleAttributesSummary } from "../ui/attributesPanel.js";

export function renderInspectorStats({ compare, design, currentModule, graph, timing }, elements) {
  if (compare.active && compare.analysis) {
    const { left, right, delta, unmatchedPorts, unmatchedNets } = compare.analysis;
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
    if (elements.moduleAttributes) {
      const leftGraph = compare.fullGraphs?.left || compare.graphs?.left;
      const rightGraph = compare.fullGraphs?.right || compare.graphs?.right;
      elements.moduleAttributes.innerHTML = renderModuleAttributesSummary({
        compareActive: true,
        leftModule: design?.modules.find((item) => item.name === compare.leftModuleName) || null,
        rightModule: design?.modules.find((item) => item.name === compare.rightModuleName) || null,
        leftGraph,
        rightGraph
      });
    }
    return;
  }
  const module = currentModule;
  if (!module || !graph) {
    elements.stats.innerHTML = statsRows([
      ["Module", module?.displayName || "-"],
      ["Layout", "Pending"]
    ]);
    if (elements.moduleAttributes) {
      elements.moduleAttributes.innerHTML = renderModuleAttributesSummary({ currentModule: module, graph });
    }
    return;
  }
  elements.stats.innerHTML = statsRows([
    ["Module", module.displayName],
    ["Ports", graph.stats.ports],
    ["Nets", graph.stats.nets],
    ["Cells", graph.stats.cells],
    ["Assigns", graph.stats.assigns],
    ["Timing inst", timing?.instanceCount || 0],
    ["Graph nodes", graph.nodes.length],
    ["Graph edges", graph.edges.length]
  ]);
  if (elements.moduleAttributes) {
    elements.moduleAttributes.innerHTML = renderModuleAttributesSummary({ currentModule: module, graph });
  }
}

export function signed(value) { return value > 0 ? `+${value}` : String(value); }

export function formatGateKinds(counts) { return Object.entries(counts).map(([kind, count]) => `${kind}:${count}`).join(", ") || "-"; }

export function renderInspectorDiagnostics({ design, graph, compare }, list) {
  const diagnostics = [
    ...(design?.diagnostics || []),
    ...(compare.active ? [] : (graph?.diagnostics || [])),
    ...(compare.active ? (compare.graphs?.left?.diagnostics || []) : []),
    ...(compare.active ? (compare.graphs?.right?.diagnostics || []) : [])
  ];

  list.innerHTML = "";
  if (diagnostics.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No diagnostics";
    list.append(item);
    return;
  }

  for (const diagnostic of diagnostics) {
    const item = document.createElement("li");
    item.textContent = diagnostic.message;
    list.append(item);
  }
}
