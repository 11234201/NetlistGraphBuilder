import { normalizeGraphAliases } from "../analysis/aliasNormalizer.js";
import { simplifyFanoutWithHubs } from "../analysis/fanoutHub.js";
import { createConeGraph } from "../analysis/graphCone.js";
import { collapseLargeGraph } from "../analysis/groupCollapse.js";
import { applyPositionedOverrides } from "../layout/positionedRouting.js";
import { buildSchematicGraph } from "../netlist/graph.js";
import { annotateGraphTiming } from "../timing/timingAnnotation.js";

export function buildModuleWorkspace(options) {
  const {
    module,
    moduleLibrary = [],
    graphOverrides = null,
    timing = null,
    timingBadgeChoices = {},
    timingBadgePositions = {},
    showAliases = false,
    viewMode = "whole",
    coneRootNodeId = null,
    coneDepth = 3,
    useFanoutHubs = true,
    collapseLargeGroups = true,
    expandedGroupIds = new Set(),
    layoutProvider,
    layoutPolicy,
    nodePositions = new Map(),
    nodeSizes = new Map()
  } = options;
  const annotatedGraph = annotateGraphTiming(
    buildSchematicGraph(module, { overrides: graphOverrides, moduleLibrary }),
    timing,
    { badgeChoices: timingBadgeChoices, badgePositions: timingBadgePositions }
  );
  const fullGraph = normalizeGraphAliases(annotatedGraph, { showAliases });
  const sourceGraph = viewMode === "whole"
    ? fullGraph
    : createConeGraph(fullGraph, coneRootNodeId, {
      direction: viewMode,
      maxDepth: coneDepth
    });
  let displayGraph = sourceGraph;
  if (useFanoutHubs) displayGraph = simplifyFanoutWithHubs(displayGraph);
  if (collapseLargeGroups) {
    displayGraph = collapseLargeGraph(displayGraph, { expandedGroupIds });
  }

  const layoutOptions = { layoutPolicy };
  const layoutResult = layoutProvider.layout(displayGraph, layoutOptions);
  const finalize = (autoGraph) => ({
    fullGraph,
    autoGraph,
    graph: applyPositionedOverrides(autoGraph, {
      ...layoutOptions,
      nodePositions,
      nodeSizes
    })
  });
  return isPromise(layoutResult) ? layoutResult.then(finalize) : finalize(layoutResult);
}

function isPromise(value) {
  return Boolean(value && typeof value.then === "function");
}
