import { validatePhysicalNetCommit } from "../../../../src/layout/physical_net_commit.js";
import { validateLayoutGraph } from "../../../../src/layout/layoutValidator.js";
import { buildWireRoutes } from "../../../../src/layout/wireRoutes.js";
import { placeWireLabels } from "../../../../src/layout/wireLabelPlacement.js";

/**
 * NLR-08 — atomic physical-net commit.
 *
 * A physical net is published as a unit through the shared
 * `validatePhysicalNetCommit` boundary. If any branch of the net fails, none of
 * the net is published and one stable net-level diagnostic records the affected
 * edge ids. Publishing a partial net is what let the retired router leave
 * high-fanout control nets half wired, so it is not allowed here.
 */

export function CommitPhysicalNets({ nets = [], routedEdges, positionedNodes = [], width, height, nodeIndex }) {
  const published = [];
  const diagnostics = [];
  let committedNetCount = 0;
  let rejectedNetCount = 0;

  const candidates = nets.map((net) => ({
    net,
    edges: net.edgeKeys
      .map((edgeKey) => routedEdges.get(edgeKey))
      .filter(Boolean)
      .map((result) => Object.freeze({
        ...result.publicEdge,
        points: result.points,
        routeKind: "native-layered-orthogonal",
        routeStatus: "routed"
      }))
  })).filter((entry) => entry.edges.length > 0);
  const candidateEdges = candidates.flatMap((entry) => entry.edges);
  const batchViolations = validateLayoutGraph({
    nodes: positionedNodes,
    edges: candidateEdges,
    wireRoutes: buildWireRoutes(candidateEdges),
    width,
    height
  }, {
    nodeIndex,
    checkObstacles: true,
    checkOverlaps: true,
    checkBounds: false,
    maxViolations: 1
  });

  // The common case validates the complete routed scene once. This is both
  // stronger and substantially cheaper than rebuilding indexes for thousands
  // of one-edge physical nets. The per-net path remains the attribution path
  // when the batch gate finds a violation.
  if (batchViolations.length === 0) {
    published.push(...candidateEdges);
    committedNetCount = candidates.length;
  }

  for (const { net, edges } of batchViolations.length === 0 ? [] : candidates) {
    const verdict = validatePhysicalNetCommit(edges, positionedNodes, {
      width,
      height,
      nodeIndex,
      checkBounds: false
    });
    if (verdict.status !== "routed") {
      rejectedNetCount += 1;
      const diagnostic = Object.freeze({
        code: "native-router-physical-net-rejected",
        physicalNetKey: net.key,
        edgeIds: Object.freeze(edges.map((edge) => edge.id)),
        violations: Object.freeze(verdict.diagnostics.slice(0, 8))
      });
      diagnostics.push(diagnostic);
      for (const edge of edges) {
        published.push({
          ...edge,
          points: [],
          routeKind: "unroutable",
          routeStatus: "unroutable",
          routeDiagnostics: [diagnostic],
          showLabel: false,
          labelPoint: null
        });
      }
      continue;
    }
    committedNetCount += 1;
    published.push(...edges);
  }

  const labeled = placeWireLabels(published, positionedNodes, {
    order: "longest",
    minimumPadding: 32,
    baselineOffsets: [-5],
    checkCollisions: false,
    includeEmpty: true
  });

  return Object.freeze({
    edges: Object.freeze(labeled),
    wireRoutes: Object.freeze(buildWireRoutes(labeled)),
    diagnostics: Object.freeze(diagnostics),
    metrics: Object.freeze({ committedNetCount, rejectedNetCount })
  });
}
