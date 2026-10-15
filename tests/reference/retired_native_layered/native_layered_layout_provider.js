import { BuildCanonicalGraph } from "./canonical_graph.js";
import { BreakCycles } from "./cycle_breaking.js";
import { AssignRanks } from "./rank_assignment.js";
import { BuildProperLayering } from "./proper_layering.js";
import { MinimizeCrossings } from "./crossing_minimization.js";
import { MergeHyperedgeDummies } from "./hyperedge_dummy_merging.js";
import { PlaceAlignmentBlocks } from "./block_placement.js";
import { AnalyzeAndPackStructure, OrderStructureBlocks } from "./structure_packing.js";
import { RouteNativeOrthogonal } from "./router/native_orthogonal_router.js";
import { finalizeLayoutGraph } from "../../../src/layout/layoutValidator.js";

export const NATIVE_LAYERED_LAYOUT_PROVIDER_ID = "native-layered";

export class NativeLayeredLayoutProvider {
  constructor() {
    this.id = NATIVE_LAYERED_LAYOUT_PROVIDER_ID;
    this.label = "Native Layered (Experimental)";
    this.experimental = true;
  }

  layout(graph, options = {}) {
    const startedAt = Now();
    const canonicalPhase = Measure(() => BuildCanonicalGraph(graph, {
      cellPinPitch: options.layoutPolicy?.spacing?.cellPinPitch
    }));
    const model = canonicalPhase.value;
    if (model.nodes.length === 0) return {
      ...graph,
      nodes: [],
      edges: [],
      wireRoutes: [],
      width: 0,
      height: 0,
      layoutProvider: this.id,
      layoutStatus: "routed",
      layoutDiagnostics: [],
      providerDiagnostics: model.diagnostics,
      validationMetrics: { total: 0, byCode: {} },
      layoutMetrics: Object.freeze({
        phases: Object.freeze({ canonicalGraph: Object.freeze({ nodeCount: 0, edgeCount: 0, physicalNetCount: 0 }) })
      })
    };
    const cyclePhase = Measure(() => BreakCycles(model));
    const orientation = cyclePhase.value;
    const rankingPhase = Measure(() => AssignRanks(model, orientation, options.nativeLayered?.ranking));
    const ranking = rankingPhase.value;
    const properPhase = Measure(() => BuildProperLayering(model, orientation, ranking, options.nativeLayered?.properLayering));
    const proper = properPhase.value;
    const crossingPhase = Measure(() => MinimizeCrossings(proper, options.nativeLayered?.crossing));
    const crossing = crossingPhase.value;
    const dummyMergePhase = Measure(() => MergeHyperedgeDummies(proper, crossing));
    const mergedProper = dummyMergePhase.value.proper;
    const mergedCrossing = dummyMergePhase.value.crossing;
    const orderingPhase = Measure(() => OrderStructureBlocks(model, orientation, mergedProper, mergedCrossing));
    const structuredCrossing = orderingPhase.value;
    const placementPhase = Measure(() => PlaceAlignmentBlocks(mergedProper, structuredCrossing, {
      layerGap: options.layoutPolicy?.spacing?.x,
      nodeGap: options.layoutPolicy?.spacing?.cellSpacing,
      margin: options.layoutPolicy?.spacing?.margin
    }));
    const placement = placementPhase.value;
    const structurePhase = Measure(() => AnalyzeAndPackStructure(model, orientation, placement, options.nativeLayered?.packing));
    const structure = structurePhase.value;
    // x is owned by routing: slot count decides every inter-layer boundary
    // width, so node columns are projected only after the slot plan exists.
    const routingPhase = Measure(() => RouteNativeOrthogonal({
      graph,
      model,
      orientation,
      proper: mergedProper,
      structure,
      options: {
        margin: options.layoutPolicy?.spacing?.margin,
        edgeEdgeSpacing: options.layoutPolicy?.spacing?.wireLanePitch,
        edgeNodeSpacing: options.nativeLayered?.router?.edgeNodeSpacing,
        nodeNodeSpacing: options.layoutPolicy?.spacing?.x,
        ...options.nativeLayered?.router
      }
    }));
    const routing = routingPhase.value;
    const validationPhase = Measure(() => finalizeLayoutGraph({
      ...graph,
      nodes: routing.nodes,
      edges: routing.edges,
      wireRoutes: routing.wireRoutes,
      width: routing.width,
      height: routing.height,
      layoutProvider: this.id,
      providerDiagnostics: [...model.diagnostics, ...proper.diagnostics, ...routing.diagnostics]
    }));
    const result = validationPhase.value;
    result.layoutMetrics = Object.freeze({
      elapsedMs: Math.round((Now() - startedAt) * 1000) / 1000,
      phases: Object.freeze({
        canonicalGraph: Object.freeze({ elapsedMs: canonicalPhase.elapsedMs, nodeCount: model.nodes.length, edgeCount: model.logicalEdges.length, physicalNetCount: model.physicalNets.length }),
        cycleBreaking: Object.freeze({ elapsedMs: cyclePhase.elapsedMs, reversedEdgeCount: orientation.reversedEdgeKeys.length }),
        ranking: Object.freeze({ elapsedMs: rankingPhase.elapsedMs, rankCount: new Set(ranking.ranks.values()).size, refinementSweeps: ranking.refinementSweeps }),
        properLayering: Object.freeze({ elapsedMs: properPhase.elapsedMs, dummyCount: proper.nodes.filter((node) => node.dummy).length, segmentCount: proper.segments.length }),
        crossing: Object.freeze({ elapsedMs: crossingPhase.elapsedMs, initial: crossing.initialCrossings, final: crossing.crossings, sweeps: crossing.completedSweeps }),
        hyperedgeDummyMerging: Object.freeze({ elapsedMs: dummyMergePhase.elapsedMs, ...dummyMergePhase.value.metrics }),
        structureOrdering: Object.freeze({ elapsedMs: orderingPhase.elapsedMs }),
        placement: Object.freeze({ elapsedMs: placementPhase.elapsedMs, blockCount: placement.blockCount }),
        structurePacking: Object.freeze({ elapsedMs: structurePhase.elapsedMs, componentCount: structure.componentCount }),
        routing: Object.freeze({
          elapsedMs: routingPhase.elapsedMs,
          phaseElapsedMs: Object.freeze(routing.metrics.phases),
          segmentCount: routing.metrics.segmentCount,
          straightSegmentCount: routing.metrics.straightSegmentCount,
          dependencyCount: routing.metrics.dependencyCount,
          criticalDependencyCount: routing.metrics.criticalDependencyCount,
          maximumActiveCandidates: routing.metrics.maximumActiveCandidates,
          splitCount: routing.metrics.splitCount,
          slotCount: routing.metrics.slotCount,
          topologicalSlotCount: routing.metrics.topologicalSlotCount,
          separatedCount: routing.metrics.separatedCount,
          violatedConstraintCount: routing.metrics.violatedConstraintCount,
          remainingOverlaps: routing.metrics.remainingOverlaps,
          truncated: routing.metrics.truncated,
          exceptionalEdgeCount: routing.metrics.exceptionalEdgeCount,
          missingTrunkCount: routing.metrics.missingTrunkCount,
          committedNetCount: routing.metrics.committedNetCount,
          rejectedNetCount: routing.metrics.rejectedNetCount
        }),
        validation: Object.freeze({ elapsedMs: validationPhase.elapsedMs, violationCount: result.validationMetrics.total })
      })
    });
    return result;
  }
}

function Now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function Measure(action) {
  const startedAt = Now();
  const value = action();
  return { value, elapsedMs: Math.round((Now() - startedAt) * 1000) / 1000 };
}
