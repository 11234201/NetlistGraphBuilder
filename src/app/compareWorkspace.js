import { alignModulePorts, compareModules } from "../analysis/moduleCompare.js";
import { normalizeFocusedRootNodeIds } from "./focusedViewPolicy.js";
import { buildModuleFullGraph, buildModuleWorkspace } from "./moduleWorkspace.js";
import { shouldUseSearchFirst } from "./graphWorkspace.js";

export function buildCompareWorkspace(options) {
  const {
    leftModule,
    rightModule,
    layoutProvider,
    layoutPolicy,
    presentationPolicy = null,
    outputName = null,
    coneDepth = 3,
    faninDepth = coneDepth,
    fanoutDepth = coneDepth,
    showAliases = false,
    timing = null,
    timingDisplayPolicy = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    graphOverrides = { left: null, right: null },
    cellConfig = null,
    nodePositions = { left: new Map(), right: new Map() },
    nodeSizes = { left: new Map(), right: new Map() },
    useFanoutHubs = true,
    collapseLargeGroups = false,
    expandedGroupIds = new Set(),
    focusedRootNodeIds = { left: [], right: [] },
    activeFocusedRootNodeId = { left: null, right: null },
    moduleLibrary = [],
    searchFirstThreshold = 500,
    forceWhole = false,
    artifactCache = null,
    artifactIdentity = null
  } = options;
  const fullGraphs = {
    left: buildModuleFullGraph({
      module: leftModule,
      showAliases, timing, timingDisplayPolicy,
      timingBadgeChoices: timingBadgeChoices.left || timingBadgeChoices,
      timingBadgePositions: timingBadgePositions.left || timingBadgePositions,
      graphOverrides: graphOverrides.left,
      cellConfig,
      moduleLibrary,
      artifactCache,
      artifactIdentity: artifactIdentity && { ...artifactIdentity, sessionId: "compare:left", unitId: leftModule?.name }
    }),
    right: buildModuleFullGraph({
      module: rightModule,
      showAliases, timing, timingDisplayPolicy,
      timingBadgeChoices: timingBadgeChoices.right || timingBadgeChoices,
      timingBadgePositions: timingBadgePositions.right || timingBadgePositions,
      graphOverrides: graphOverrides.right,
      cellConfig,
      moduleLibrary,
      artifactCache,
      artifactIdentity: artifactIdentity && { ...artifactIdentity, sessionId: "compare:right", unitId: rightModule?.name }
    })
  };
  alignPortNodeOrder(fullGraphs, alignModulePorts(leftModule, rightModule));

  const workspaceInputs = {};
  for (const side of ["left", "right"]) {
    const rootNodeIds = normalizeRootNodeIds(focusedRootNodeIds?.[side]);
    if (rootNodeIds.length > 0) {
      workspaceInputs[side] = {
        viewMode: "focused",
        focusedRootNodeIds: rootNodeIds,
        activeFocusedRootNodeId: activeFocusedRootNodeId?.[side] || rootNodeIds[0],
        faninDepth,
        fanoutDepth
      };
      continue;
    }
    if (outputName) {
      const outputNodeId = findCompareNode(fullGraphs[side], "port", outputName, "output")?.id;
      workspaceInputs[side] = {
        viewMode: "fanin",
        coneRootNodeId: outputNodeId,
        coneDepth,
        faninDepth: coneDepth,
        fanoutDepth: 0
      };
    } else if (!forceWhole && shouldUseSearchFirst(side === "left" ? leftModule : rightModule, searchFirstThreshold)) {
      workspaceInputs[side] = { viewMode: "search-first" };
    }
  }
  const buildSide = (side, module) => buildModuleWorkspace({
    module,
    preparedFullGraph: fullGraphs[side],
    layoutProvider,
    layoutPolicy,
    presentationPolicy,
    nodePositions: nodePositions[side],
    nodeSizes: nodeSizes[side],
    useFanoutHubs,
    collapseLargeGroups,
    expandedGroupIds,
    artifactCache,
    artifactIdentity: artifactIdentity && { ...artifactIdentity, sessionId: `compare:${side}`, unitId: module?.name },
    ...(workspaceInputs[side] || {})
  });
  const leftLayout = buildSide("left", leftModule);
  const rightLayout = buildSide("right", rightModule);
  const finalize = ([left, right]) => ({
    fullGraphs,
    autoGraphs: { left: left.autoGraph, right: right.autoGraph },
    graphs: { left: left.graph, right: right.graph },
    scenes: { left: left.scene, right: right.scene },
    analysis: compareModules(leftModule, rightModule, fullGraphs.left, fullGraphs.right)
  });
  return isPromise(leftLayout) || isPromise(rightLayout)
    ? Promise.all([leftLayout, rightLayout]).then(finalize)
    : finalize([leftLayout, rightLayout]);

}

function normalizeRootNodeIds(value) {
  return normalizeFocusedRootNodeIds(value);
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
