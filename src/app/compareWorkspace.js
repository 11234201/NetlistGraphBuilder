import { alignModulePorts, compareModules } from "../analysis/moduleCompare.js";
import {
  applyWorkspaceGraphTransforms,
  buildWorkspaceGraph,
  selectWorkspaceGraphView
} from "./graphWorkspace.js";

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
    timingBadgePositions = {},
    graphOverrides = { left: null, right: null },
    nodePositions = { left: new Map(), right: new Map() },
    nodeSizes = { left: new Map(), right: new Map() },
    useFanoutHubs = true,
    collapseLargeGroups = true,
    expandedGroupIds = new Set(),
    moduleLibrary = []
  } = options;
  const fullGraphs = {
    left: buildWorkspaceGraph(leftModule, {
      showAliases, timing,
      timingBadgeChoices: timingBadgeChoices.left || timingBadgeChoices,
      timingBadgePositions: timingBadgePositions.left || timingBadgePositions,
      graphOverrides: graphOverrides.left,
      moduleLibrary
    }),
    right: buildWorkspaceGraph(rightModule, {
      showAliases, timing,
      timingBadgeChoices: timingBadgeChoices.right || timingBadgeChoices,
      timingBadgePositions: timingBadgePositions.right || timingBadgePositions,
      graphOverrides: graphOverrides.right,
      moduleLibrary
    })
  };
  alignPortNodeOrder(fullGraphs, alignModulePorts(leftModule, rightModule));

  const sourceGraphs = { ...fullGraphs };
  if (outputName) {
    for (const side of ["left", "right"]) {
      const outputNodeId = findCompareNode(fullGraphs[side], "port", outputName, "output")?.id;
      sourceGraphs[side] = selectWorkspaceGraphView(fullGraphs[side], {
        viewMode: "fanin",
        rootNodeId: outputNodeId,
        maxDepth: coneDepth
      });
    }
  }
  for (const side of ["left", "right"]) {
    sourceGraphs[side] = applyWorkspaceGraphTransforms(sourceGraphs[side], {
      useFanoutHubs,
      collapseLargeGroups,
      expandedGroupIds
    });
  }

  const leftLayout = layoutProvider.layout(sourceGraphs.left, {
    layoutPolicy, nodePositions: nodePositions.left, nodeSizes: nodeSizes.left
  });
  const rightLayout = layoutProvider.layout(sourceGraphs.right, {
    layoutPolicy, nodePositions: nodePositions.right, nodeSizes: nodeSizes.right
  });
  const finalize = ([left, right]) => ({
    fullGraphs,
    graphs: { left, right },
    analysis: compareModules(leftModule, rightModule, sourceGraphs.left, sourceGraphs.right)
  });
  return isPromise(leftLayout) || isPromise(rightLayout)
    ? Promise.all([leftLayout, rightLayout]).then(finalize)
    : finalize([leftLayout, rightLayout]);

}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
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
