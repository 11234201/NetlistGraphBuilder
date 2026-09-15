import { getConnectionPoint } from "../nodeGeometry.js";
import { compactOrthogonalPoints } from "../orthogonalRouting.js";
import { validatePhysicalNetCommit } from "../physical_net_commit.js";

/**
 * Join logical branches back through their physical carrier chain. Every net
 * is validated and published as one atomic unit; callers may fall back to the
 * legacy router for groups whose carrier geometry is incomplete or invalid.
 */
export function buildCarrierPhysicalNetRoutes(
  layeredGraph,
  positionedNodes,
  carrierYById,
  options = {}
) {
  const nodeById = new Map((positionedNodes || []).map((node) => [node.id, node]));
  const edgeById = new Map((layeredGraph.orientedEdges || []).map((edge) => [String(edge.id), edge]));
  const boundaryX = buildBoundaryXMap(layeredGraph, positionedNodes);
  const carriersByEdge = indexCarriersByEdge(layeredGraph.carriers || []);
  const groups = new Map();
  const diagnostics = [];

  for (const [edgeId, carriers] of carriersByEdge) {
    const edge = edgeById.get(edgeId);
    if (!edge || edge.reversedForLayout || edge.ignoredForLayering) continue;
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      diagnostics.push({ code: "layered-carrier-route-endpoint-missing", edgeId });
      continue;
    }
    const anchors = carriers.map((carrier) => ({
      carrier,
      x: boundaryX.get(carrier.boundaryColumn),
      y: carrierYById?.get(carrier.id)
    }));
    if (anchors.some((anchor) => !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))) {
      diagnostics.push({ code: "layered-carrier-route-anchor-missing", edgeId });
      continue;
    }
    const points = buildBranchPoints(edge, source, target, anchors);
    const positionedEdge = {
      ...edge,
      source: edge.originalSource ?? edge.source,
      target: edge.originalTarget ?? edge.target,
      points,
      routeKind: "physical-carrier-tree",
      routeStatus: "routed"
    };
    const groupKey = edge.physicalNetKey;
    const group = groups.get(groupKey) || [];
    group.push(positionedEdge);
    groups.set(groupKey, group);
  }

  const routedGroups = [];
  for (const [physicalNetKey, edges] of [...groups].toSorted(([left], [right]) =>
    String(left).localeCompare(String(right)))) {
    const commit = validatePhysicalNetCommit(edges, positionedNodes, options);
    routedGroups.push({ physicalNetKey, edges, commit });
    if (commit.status !== "routed") {
      diagnostics.push({
        code: "layered-carrier-physical-net-invalid",
        physicalNetKey,
        violations: commit.diagnostics.map((item) => item.code)
      });
    }
  }
  return { groups: routedGroups, diagnostics, boundaryX };
}

function buildBranchPoints(edge, source, target, anchors) {
  const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
  const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
  const points = [sourcePoint];
  const first = anchors[0];
  points.push({ x: first.x, y: sourcePoint.y }, { x: first.x, y: first.y });
  let previous = first;
  for (const anchor of anchors.slice(1)) {
    points.push({ x: anchor.x, y: previous.y }, { x: anchor.x, y: anchor.y });
    previous = anchor;
  }
  points.push({ x: previous.x, y: targetPoint.y }, targetPoint);
  return compactOrthogonalPoints(points);
}

function indexCarriersByEdge(carriers) {
  const byEdge = new Map();
  for (const carrier of carriers) {
    for (const edgeId of carrier.logicalEdgeIds || []) {
      const key = String(edgeId);
      const entries = byEdge.get(key) || [];
      entries.push(carrier);
      byEdge.set(key, entries);
    }
  }
  for (const entries of byEdge.values()) {
    entries.sort((left, right) => left.boundaryColumn - right.boundaryColumn ||
      String(left.id).localeCompare(String(right.id)));
  }
  return byEdge;
}

function buildBoundaryXMap(layeredGraph, positionedNodes) {
  const nodesByLevel = new Map();
  for (const node of positionedNodes || []) {
    const entries = nodesByLevel.get(node.level) || [];
    entries.push(node);
    nodesByLevel.set(node.level, entries);
  }
  const result = new Map();
  for (const boundary of layeredGraph.carrierBoundaries || []) {
    const left = nodesByLevel.get(boundary.leftLevel) || [];
    const right = nodesByLevel.get(boundary.rightLevel) || [];
    if (left.length === 0 || right.length === 0) continue;
    const leftEdge = Math.max(...left.map((node) => Number(node.x) + Number(node.width)));
    const rightEdge = Math.min(...right.map((node) => Number(node.x)));
    if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge) || rightEdge <= leftEdge) continue;
    result.set(boundary.boundaryColumn, (leftEdge + rightEdge) / 2);
  }
  return result;
}
