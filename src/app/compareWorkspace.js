import { normalizeGraphAliases } from "../analysis/aliasNormalizer.js";
import { createConeGraph } from "../analysis/graphCone.js";
import { alignModulePorts, compareModules } from "../analysis/moduleCompare.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";

export function buildCompareWorkspace(options) {
  const {
    leftModule,
    rightModule,
    layoutProvider,
    layoutPolicy,
    outputName = null,
    coneDepth = 3,
    showAliases = false,
    timing = null,
    timingBadgeChoices = {},
    timingBadgePositions = {}
  } = options;
  const graphOptions = {
    showAliases,
    timing,
    timingBadgeChoices,
    timingBadgePositions
  };
  const fullGraphs = {
    left: buildCompareGraph(leftModule, graphOptions),
    right: buildCompareGraph(rightModule, graphOptions)
  };
  alignPortNodeOrder(fullGraphs, alignModulePorts(leftModule, rightModule));

  const sourceGraphs = { ...fullGraphs };
  if (outputName) {
    for (const side of ["left", "right"]) {
      const outputNodeId = findCompareNode(fullGraphs[side], "port", outputName, "output")?.id;
      sourceGraphs[side] = createConeGraph(fullGraphs[side], outputNodeId, {
        direction: "fanin",
        maxDepth: coneDepth
      });
    }
  }

  const graphs = {
    left: layoutProvider.layout(sourceGraphs.left, { layoutPolicy }),
    right: layoutProvider.layout(sourceGraphs.right, { layoutPolicy })
  };
  return {
    fullGraphs,
    graphs,
    analysis: compareModules(leftModule, rightModule, sourceGraphs.left, sourceGraphs.right)
  };

}

export function findCompareNode(graph, kind, name, portKind = null) {
  return graph?.nodes.find((node) => {
    if (kind === "cell") {
      return node.kind === "cell" && getCompareNodeName(node) === name;
    }
    if (kind === "port") {
      return (node.kind === "input" || node.kind === "output")
        && (!portKind || node.kind === portKind)
        && getCompareNodeName(node) === name;
    }
    return false;
  }) || null;
}

export function getCompareNodeName(node) {
  if (!node) {
    return null;
  }
  return node.kind === "cell"
    ? node.ref?.instance || node.label
    : node.ref?.name || node.label;
}

function buildCompareGraph(module, options) {
  const annotatedGraph = annotateGraphTiming(
    buildSchematicGraph(module),
    options.timing,
    {
      badgeChoices: options.timingBadgeChoices,
      badgePositions: options.timingBadgePositions
    }
  );
  return normalizeGraphAliases(annotatedGraph, { showAliases: options.showAliases });
}

function alignPortNodeOrder(graphs, alignedPorts) {
  alignedPorts.forEach((port, order) => {
    for (const graph of Object.values(graphs)) {
      for (const kind of ["input", "output"]) {
        const node = findCompareNode(graph, "port", port.name, kind);
        if (node) {
          node.order = order;
        }
      }
    }
  });
}
