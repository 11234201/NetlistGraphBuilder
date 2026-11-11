import { alignModulePorts, compareModules } from "../analysis/moduleCompare.js";
import { normalizeFocusedRootNodeIds } from "./focusedViewPolicy.js";
import { buildModuleFullGraph, buildModuleWorkspace } from "./moduleWorkspace.js";
import { shouldUseSearchFirst } from "./graphWorkspace.js";
import { workspaceArtifactReference } from "./workspaceArtifactCache.js";

export function prepareCompareWorkspace(options = {}) {
  const {
    leftModule,
    rightModule,
    showAliases = false,
    timing = null,
    timingDisplayPolicy = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    graphOverrides = { left: null, right: null },
    cellConfig = null,
    cellLibrary = null,
    focusedRootNodeIds = { left: [], right: [] },
    activeFocusedRootNodeId = { left: null, right: null },
    moduleLibrary = [],
    searchFirstThreshold = 500,
    forceWhole = false,
    artifactCache = null,
    artifactIdentity = null,
    signal = null
  } = options;
  throwIfAborted(signal);
  const fullGraphs = {
    left: buildModuleFullGraph({
      module: leftModule,
      showAliases, timing, timingDisplayPolicy,
      timingBadgeChoices: timingBadgeChoices.left || timingBadgeChoices,
      timingBadgePositions: timingBadgePositions.left || timingBadgePositions,
      graphOverrides: graphOverrides.left,
      cellConfig,
      cellLibrary,
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
      cellLibrary,
      moduleLibrary,
      artifactCache,
      artifactIdentity: artifactIdentity && { ...artifactIdentity, sessionId: "compare:right", unitId: rightModule?.name }
    })
  };
  const alignedPorts = alignModulePorts(leftModule, rightModule);
  for (const side of ["left", "right"]) {
    const graph = fullGraphs[side];
    const key = { stage: "compare-port-order", graph: workspaceArtifactReference(graph), ports: alignedPorts.map((port) => port.name) };
    let aligned = artifactCache?.get(key);
    if (!aligned) {
      aligned = { ...graph, nodes: graph.nodes.map((node) => ({ ...node })) };
      alignPortNodeOrder({ [side]: aligned }, alignedPorts);
      artifactCache?.put(key, aligned, { documentId: artifactIdentity?.documentId, sessionId: `compare:${side}` });
    }
    fullGraphs[side] = aligned;
  }
  throwIfAborted(signal);

  const workspaceInputs = resolveWorkspaceInputs({
    leftModule,
    rightModule,
    fullGraphs,
    outputName: options.outputName,
    coneDepth: options.coneDepth,
    faninDepth: options.faninDepth,
    fanoutDepth: options.fanoutDepth,
    focusedRootNodeIds,
    activeFocusedRootNodeId,
    searchFirstThreshold: options.searchFirstThreshold,
    forceWhole: options.forceWhole
  });
  return { fullGraphs, workspaceInputs };
}

export function buildCompareSideWorkspace(options = {}) {
  const {
    side,
    module,
    fullGraph,
    workspaceInput = {},
    layoutProvider,
    layoutPolicy,
    presentationPolicy = null,
    nodePositions = { left: new Map(), right: new Map() },
    nodeSizes = { left: new Map(), right: new Map() },
    useFanoutHubs = true,
    collapseLargeGroups = false,
    expandedGroupIds = new Set(),
    artifactCache = null,
    artifactIdentity = null,
    signal = null,
    sideSignal = null,
    onSideStatus = () => {}
  } = options;
  const activeSignal = sideSignal || signal;
  throwIfAborted(signal);
  throwIfAborted(activeSignal);
  onSideStatus(side, "loading", { moduleName: module?.name || null });
  try {
    const result = buildModuleWorkspace({
      module,
      preparedFullGraph: fullGraph,
      graphOverrides: options.graphOverrides?.[side],
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
      ...workspaceInput,
      signal: activeSignal
    });
    const finish = (value) => {
      throwIfAborted(signal);
      throwIfAborted(activeSignal);
      onSideStatus(side, "ready", { moduleName: module?.name || null });
      return value;
    };
    if (isPromise(result)) {
      return result.then(finish).catch((error) => {
        onSideStatus(side, error?.name === "AbortError" ? "cancelled" : "failed", {
          moduleName: module?.name || null,
          error
        });
        throw error;
      });
    }
    return finish(result);
  } catch (error) {
    onSideStatus(side, error?.name === "AbortError" ? "cancelled" : "failed", {
      moduleName: module?.name || null,
      error
    });
    throw error;
  }
}

export function buildCompareWorkspace(options = {}) {
  const {
    leftModule,
    rightModule,
    signal = null,
    onSideStatus = () => {}
  } = options;
  const prepared = prepareCompareWorkspace(options);
  const buildSide = (side, module) => buildCompareSideWorkspace({
    ...options,
    side,
    module,
    fullGraph: prepared.fullGraphs[side],
    workspaceInput: prepared.workspaceInputs[side],
    signal,
    onSideStatus
  });
  const leftLayout = buildSide("left", leftModule);
  const rightLayout = buildSide("right", rightModule);
  const finalize = ([left, right]) => {
    throwIfAborted(signal);
    return {
      fullGraphs: prepared.fullGraphs,
      autoGraphs: { left: left.autoGraph, right: right.autoGraph },
      graphs: { left: left.graph, right: right.graph },
      scenes: { left: left.scene, right: right.scene },
      analysis: compareModules(leftModule, rightModule, prepared.fullGraphs.left, prepared.fullGraphs.right)
    };
  };
  return isPromise(leftLayout) || isPromise(rightLayout)
    ? Promise.all([leftLayout, rightLayout]).then(finalize)
    : finalize([leftLayout, rightLayout]);
}

function resolveWorkspaceInputs({
  leftModule,
  rightModule,
  fullGraphs,
  outputName = null,
  coneDepth = 3,
  faninDepth = coneDepth,
  fanoutDepth = coneDepth,
  focusedRootNodeIds = { left: [], right: [] },
  activeFocusedRootNodeId = { left: null, right: null },
  searchFirstThreshold = 500,
  forceWhole = false
}) {
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
  return workspaceInputs;
}

function normalizeRootNodeIds(value) {
  return normalizeFocusedRootNodeIds(value);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  const error = new Error("Compare workspace request was cancelled");
  error.name = "AbortError";
  throw error;
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
