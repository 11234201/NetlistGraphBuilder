import { getConnectionPoint } from "../nodeGeometry.js";
import { compactOrthogonalPoints } from "../orthogonalRouting.js";
import { validatePhysicalNetCommit } from "../physical_net_commit.js";
import { computeNodeCollectionBox, createNodeSpatialIndex } from "../spatialIndex.js";
import { ROUTE_GEOMETRY_POLICY, ROUTE_SEARCH_LIMITS } from "../routeSearchPolicy.js";

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
  const anchorOffsets = normalizeAnchorOffsets(options.anchorOffsets);
  const nodeById = new Map((positionedNodes || []).map((node) => [node.id, node]));
  const nodeIndex = options.nodeIndex || createNodeSpatialIndex(positionedNodes || []);
  const nodeBounds = computeNodeCollectionBox(positionedNodes || []);
  const edgeById = new Map((layeredGraph.orientedEdges || []).map((edge) => [String(edge.id), edge]));
  const carrierXById = buildCarrierXMap(
    layeredGraph,
    positionedNodes,
    edgeById,
    nodeById,
    carrierYById,
    nodeIndex,
    nodeBounds
  );
  const carriersByEdge = indexCarriersByEdge(layeredGraph.carriers || []);
  const groupsByOffset = new Map(anchorOffsets.map((offset) => [offset, new Map()]));
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
      x: carrierXById.get(carrier.id),
      y: carrierYById?.get(carrier.id)
    }));
    if (anchors.some((anchor) => !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y))) {
      diagnostics.push({ code: "layered-carrier-route-anchor-missing", edgeId });
      continue;
    }
    const groupKey = edge.physicalNetKey;
    for (const offset of anchorOffsets) {
      const points = buildBranchPoints(
        edge,
        source,
        target,
        anchors.map((anchor) => ({ ...anchor, y: anchor.y + offset }))
      );
      const positionedEdge = {
        ...edge,
        source: edge.originalSource ?? edge.source,
        target: edge.originalTarget ?? edge.target,
        points,
        routeKind: "physical-carrier-tree",
        routeStatus: "routed"
      };
      const groups = groupsByOffset.get(offset);
      const group = groups.get(groupKey) || [];
      group.push(positionedEdge);
      groups.set(groupKey, group);
    }
  }

  const routedGroups = [];
  const physicalNetKeys = [...new Set([...groupsByOffset.values()]
    .flatMap((groups) => [...groups.keys()]))].toSorted();
  for (const physicalNetKey of physicalNetKeys) {
    const variants = anchorOffsets.map((offset) => {
      const edges = groupsByOffset.get(offset).get(physicalNetKey) || [];
      return {
        offset,
        edges,
        // Candidate generation only needs the first hard failure. Collecting
        // dozens of equivalent diagnostics for every offset made dense Whole
        // carrier trials dominate runtime without changing the decision.
        commit: validatePhysicalNetCommit(edges, positionedNodes, {
          ...options,
          nodeIndex,
          maxViolations: Math.min(Number(options.maxViolations) || 1, 8)
        })
      };
    });
    const primary = variants[0];
    routedGroups.push({
      physicalNetKey,
      edges: primary.edges,
      commit: primary.commit,
      variants
    });
    if (!variants.some((variant) => variant.commit.status === "routed")) {
      diagnostics.push({
        code: "layered-carrier-physical-net-invalid",
        physicalNetKey,
        violationCounts: countCodes(primary.commit.diagnostics),
        samples: primary.commit.diagnostics.slice(0, 8).map((item, index) => ({
          code: item.code,
          edgeId: item.edgeId,
          nodeId: item.nodeId,
          nodeBox: summarizeNodeBox(nodeById.get(item.nodeId)),
          sourceBox: summarizeNodeBox(nodeById.get(edgeById.get(String(item.edgeId))?.source)),
          targetBox: summarizeNodeBox(nodeById.get(edgeById.get(String(item.edgeId))?.target)),
          ...(index === 0 ? {
            points: primary.edges.find((edge) => String(edge.id) === String(item.edgeId))?.points
          } : {})
        }))
      });
    }
  }
  return { groups: routedGroups, diagnostics, carrierXById };
}

function summarizeNodeBox(node) {
  if (!node) return null;
  return {
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    level: node.level,
    kind: node.kind
  };
}

function countCodes(diagnostics) {
  const counts = {};
  for (const diagnostic of diagnostics || []) {
    const code = diagnostic?.code || "unknown";
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

function normalizeAnchorOffsets(values) {
  const source = Array.isArray(values) && values.length > 0 ? values : [0];
  const offsets = [];
  for (const value of source.slice(0, 9)) {
    const offset = Number(value);
    if (!Number.isFinite(offset) || offsets.includes(offset)) continue;
    offsets.push(offset);
  }
  return offsets.length > 0 ? offsets : [0];
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

function buildCarrierXMap(
  layeredGraph,
  positionedNodes,
  edgeById,
  nodeById,
  carrierYById,
  nodeIndex,
  nodeBounds
) {
  const nodesByLevel = new Map();
  for (const node of positionedNodes || []) {
    const entries = nodesByLevel.get(node.level) || [];
    entries.push(node);
    nodesByLevel.set(node.level, entries);
  }
  const result = new Map();
  for (const boundary of layeredGraph.carrierBoundaries || []) {
    const activeCarriers = (boundary.carriers || [])
      .filter((carrier) => carrierYById?.has(carrier.id))
      .toSorted((left, right) => (left.order || 0) - (right.order || 0) ||
        String(left.id).localeCompare(String(right.id)));
    if (activeCarriers.length === 0) continue;
    const allLeft = nodesByLevel.get(boundary.leftLevel) || [];
    const allRight = nodesByLevel.get(boundary.rightLevel) || [];
    const structuralLeft = allLeft.filter(isStructuralLayerNode);
    const structuralRight = allRight.filter(isStructuralLayerNode);
    const terminatingTargets = [...new Set((boundary.carriers || [])
      .flatMap((carrier) => carrier.terminatingEdgeIds || [])
      .map((edgeId) => edgeById.get(String(edgeId))?.target)
      .filter(Boolean))]
      .map((nodeId) => nodeById.get(nodeId))
      .filter(Boolean);
    const startingSources = [...new Set((boundary.carriers || [])
      .filter((carrier) => !carrier.previousCarrierId)
      .map((carrier) => carrier.sourceNodeId)
      .filter(Boolean))]
      .map((nodeId) => nodeById.get(nodeId))
      .filter(Boolean);
    const left = structuralLeft.length > 0 ? structuralLeft : allLeft;
    const right = terminatingTargets.length > 0
      ? terminatingTargets
      : structuralRight.length > 0
        ? structuralRight
        : allRight;
    if (left.length === 0 || right.length === 0) continue;
    const leftEdge = Math.max(...left.map((node) => Number(node.x) + Number(node.width)));
    const rightEdge = Math.min(...right.map((node) => Number(node.x)));
    if (!Number.isFinite(leftEdge) || !Number.isFinite(rightEdge) || rightEdge <= leftEdge) continue;
    const sourceEscapeX = startingSources.length > 0
      ? Math.max(...startingSources.map((node) => Number(node.x) + Number(node.width))) + 24
      : null;
    const preferredCoordinate = Number.isFinite(sourceEscapeX)
      ? sourceEscapeX
      : terminatingTargets.length > 0
        ? Math.max(leftEdge + 8, rightEdge - 24)
        : (leftEdge + rightEdge) / 2;
    const coordinates = chooseClearBoundaryXs(
      preferredCoordinate,
      leftEdge + 8,
      rightEdge - 8,
      nodeIndex,
      nodeBounds,
      activeCarriers.length
    ).toSorted((left, right) => left - right);
    activeCarriers.forEach((carrier, index) => {
      const coordinate = coordinates[index];
      if (Number.isFinite(coordinate) && coordinate < rightEdge) {
        result.set(carrier.id, coordinate);
      }
    });
  }
  return result;
}

function chooseClearBoundaryXs(preferred, minimum, maximum, nodeIndex, nodeBounds, count) {
  if (!(maximum >= minimum) || count <= 0) return [];
  const candidates = [preferred, minimum, maximum];
  const pitch = ROUTE_GEOMETRY_POLICY.boundaryCarrierTrackPitch;
  const maximumTracks = ROUTE_SEARCH_LIMITS.maximumBoundaryCarrierTracks;
  for (let step = 1; step <= maximumTracks; step += 1) {
    const left = preferred - step * pitch;
    const right = preferred + step * pitch;
    if (left < minimum && right > maximum) break;
    candidates.push(left, right);
  }
  return [...new Set(candidates
    .filter((value) => Number.isFinite(value) && value >= minimum && value <= maximum)
    .toSorted((left, right) => Math.abs(left - preferred) - Math.abs(right - preferred) || left - right)
    .filter((value) => nodeIndex.query({
      left: value - 8,
      right: value + 8,
      top: nodeBounds.top,
      bottom: nodeBounds.bottom
    }).every((node) =>
      value <= Number(node.x) - 8 || value >= Number(node.x) + Number(node.width) + 8)))]
    .slice(0, Math.min(count, maximumTracks));
}

function isStructuralLayerNode(node) {
  return node?.kind === "cell" || node?.kind === "hub" || node?.kind === "group";
}
