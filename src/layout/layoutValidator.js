import { getConnectionPoint } from "./nodeGeometry.js";
import {
  collinearSegmentsOverlap,
  getRouteSegments,
  near,
  nodeBox,
  orthogonalSegmentIntersectsBox,
  routeFollowsEndpointSides,
  routePreservesEndpointAccess
} from "./orthogonalRouting.js";
import { createNodeSpatialIndex, RouteSegmentIndex, segmentBox } from "./spatialIndex.js";
import { getNetGroupKey } from "./layoutTopology.js";

export function validateLayoutGraph(graph, options = {}) {
  const violations = [];
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndex = createNodeSpatialIndex(nodes);
  const checkObstacles = options.checkObstacles !== false;
  const checkOverlaps = options.checkOverlaps !== false;
  const checkBounds = options.checkBounds === true;
  const maximumViolations = normalizeMaximumViolations(options.maxViolations);

  for (const edge of edges) {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    if (!source || !target) {
      violations.push(violation(edge, "missing-endpoint", "Edge endpoint node is missing"));
      continue;
    }
    const points = edge.points || [];
    if (points.length < 2) {
      violations.push(violation(edge, "missing-route", "Edge has fewer than two route points"));
      continue;
    }

    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    if (!samePoint(points[0], sourcePoint) || !samePoint(points.at(-1), targetPoint)) {
      violations.push(violation(edge, "detached-endpoint", "Route is detached from a pin"));
    }
    if (!isOrthogonal(points)) {
      violations.push(violation(edge, "non-orthogonal", "Route contains a diagonal segment"));
    }
    if (!routeFollowsEndpointSides(points, source, target, sourcePoint, targetPoint)) {
      violations.push(violation(edge, "wrong-port-side", "Route enters or exits through the wrong side"));
    }
    if (!routePreservesEndpointAccess(points, source, target)) {
      violations.push(violation(edge, "endpoint-body-crossing", "Route crosses an endpoint node body"));
    }
    if (checkObstacles) {
      const blockedBy = findBlockingNode(
        points,
        nodeIndex,
        source,
        target,
        options.nodePadding || 0
      );
      if (blockedBy) {
        violations.push(violation(
          edge,
          "node-crossing",
          `Route crosses node ${blockedBy.id}`,
          { nodeId: blockedBy.id }
        ));
      }
    }
    if (checkBounds) {
      const outOfBounds = findOutOfBoundsPoint(points, graph.width, graph.height);
      if (outOfBounds) {
        violations.push(violation(
          edge,
          "out-of-bounds",
          "Route extends outside the provider bounds",
          { point: outOfBounds }
        ));
      }
    }
  }

  if (checkOverlaps) appendViolations(violations, findNetOverlaps(edges, maximumViolations), maximumViolations);
  if (Array.isArray(graph.wireRoutes)) {
    appendViolations(violations, findWireRouteViolations(graph.wireRoutes, nodes, {
      checkObstacles,
      checkBounds,
      width: graph.width,
      height: graph.height
    }, maximumViolations), maximumViolations);
  }
  return violations;
}

function appendViolations(target, source, maximum = Infinity) {
  for (const item of source || []) {
    if (target.length >= maximum) break;
    target.push(item);
  }
}

/** Attach a single provider-level status without changing the graph contract. */
export function finalizeLayoutGraph(graph, options = {}) {
  const diagnostics = validateLayoutGraph(graph, {
    checkObstacles: options.checkObstacles !== false,
    checkOverlaps: options.checkOverlaps !== false,
    checkBounds: options.checkBounds !== false,
    maxViolations: options.maxViolations ?? 256
  });
  const maximumViolations = normalizeMaximumViolations(options.maxViolations ?? 256);
  return {
    ...graph,
    layoutStatus: diagnostics.length === 0 ? "routed" : "unroutable",
    layoutDiagnostics: diagnostics.slice(0, maximumViolations),
    layoutDiagnosticsTruncated: maximumViolations !== Infinity && diagnostics.length >= maximumViolations
  };
}

function findWireRouteViolations(wireRoutes, nodes = [], options = {}, maximumViolations = Infinity) {
  const violations = [];
  const nodeIndex = options.checkObstacles !== false && nodes.length > 0
    ? createNodeSpatialIndex(nodes)
    : null;
  for (const route of wireRoutes) {
    if (violations.length >= maximumViolations) break;
    const segments = route.segments || [];
    if (Number(route.reachableTargetCount) < (route.logicalEdgeIds?.length || 0)) {
      violations.push(violation(
        route,
        "wire-route-disconnected",
        "Physical wire tree does not reach every logical target",
        {
          reachableTargetCount: Number(route.reachableTargetCount) || 0,
          targetCount: route.logicalEdgeIds?.length || 0
        }
      ));
    }
    const seen = new Set();
    const crossedNodes = new Set();
    for (const segment of segments) {
      const horizontal = near(segment.start?.y, segment.end?.y);
      const vertical = near(segment.start?.x, segment.end?.x);
      if (!horizontal && !vertical) {
        violations.push(violation(route, "wire-route-non-orthogonal", "Wire route contains a diagonal segment"));
        continue;
      }
      const coordinate = horizontal ? segment.start.y : segment.start.x;
      const minimum = horizontal
        ? Math.min(segment.start.x, segment.end.x)
        : Math.min(segment.start.y, segment.end.y);
      const maximum = horizontal
        ? Math.max(segment.start.x, segment.end.x)
        : Math.max(segment.start.y, segment.end.y);
      const key = `${horizontal ? "h" : "v"}:${Math.round(coordinate * 100) / 100}:${minimum}:${maximum}`;
      if (seen.has(key)) {
        violations.push(violation(route, "wire-route-duplicate-segment", "Wire route contains a duplicate physical segment"));
      }
      seen.add(key);

      for (const node of nodeIndex?.query(segmentBox(segment)) || []) {
        // Collapsed groups are visual summaries of hidden cells. Their
        // boundary routes are intentionally allowed to pass through the
        // summary box; validate the concrete cell/port geometry instead.
        if (node.kind === "group") continue;
        if (crossedNodes.has(node.id) || !segmentCrossesNodeBody(segment, node)) continue;
        crossedNodes.add(node.id);
        violations.push(violation(
          route,
          "wire-route-node-crossing",
          `Physical wire route crosses node ${node.id}`,
          { nodeId: node.id }
        ));
      }
      if (options.checkBounds === true) {
        const point = findOutOfBoundsPoint([segment.start, segment.end], options.width, options.height);
        if (point) {
          violations.push(violation(route, "wire-route-out-of-bounds", "Physical wire route extends outside provider bounds", { point }));
          break;
        }
      }
    }
    for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
        if (collinearSegmentsOverlap(segments[leftIndex], segments[rightIndex])) {
          violations.push(violation(route, "wire-route-overlap", "Wire route contains overlapping physical segments"));
          leftIndex = segments.length;
          break;
        }
      }
    }
  }
  return violations;
}

function findOutOfBoundsPoint(points, width, height) {
  if (!Number.isFinite(Number(width)) || !Number.isFinite(Number(height))) return null;
  for (const point of points || []) {
    if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y)) ||
      point.x < 0 || point.y < 0 || point.x > width || point.y > height) {
      return point || null;
    }
  }
  return null;
}

function normalizeMaximumViolations(value) {
  if (value === undefined || value === null) return Infinity;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : Infinity;
}

function segmentCrossesNodeBody(segment, node) {
  if (!segment?.start || !segment?.end || !node) return false;
  if (near(segment.start.y, segment.end.y)) {
    return segment.start.y > node.y &&
      segment.start.y < node.y + node.height &&
      Math.max(segment.start.x, segment.end.x) > node.x &&
      Math.min(segment.start.x, segment.end.x) < node.x + node.width;
  }
  if (near(segment.start.x, segment.end.x)) {
    return segment.start.x > node.x &&
      segment.start.x < node.x + node.width &&
      Math.max(segment.start.y, segment.end.y) > node.y &&
      Math.min(segment.start.y, segment.end.y) < node.y + node.height;
  }
  return true;
}

function findBlockingNode(points, nodeIndex, source, target, padding) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const segment = { start: points[index], end: points[index + 1] };
    for (const node of nodeIndex.query(segmentBox(segment, padding))) {
      if (node.id === source.id || node.id === target.id) continue;
      const box = nodeBox(node, padding);
      if (orthogonalSegmentIntersectsBox(points[index], points[index + 1], box)) return node;
    }
  }
  return null;
}

function findNetOverlaps(edges, maximumViolations = Infinity) {
  const records = [];
  for (const edge of edges) {
    for (const segment of getRouteSegments(edge.points, edge.net, getNetGroupKey(edge))) {
      const horizontal = near(segment.start.y, segment.end.y);
      const vertical = near(segment.start.x, segment.end.x);
      if (!horizontal && !vertical) continue;
      records.push({
        edge,
        segment: { ...segment, validatorEdgeId: String(edge.id ?? "") },
        orientation: horizontal ? "h" : "v",
        coordinate: horizontal ? segment.start.y : segment.start.x,
        minimum: horizontal
          ? Math.min(segment.start.x, segment.end.x)
          : Math.min(segment.start.y, segment.end.y),
        maximum: horizontal
          ? Math.max(segment.start.x, segment.end.x)
          : Math.max(segment.start.y, segment.end.y)
      });
    }
  }
  records.sort((left, right) => left.orientation.localeCompare(right.orientation) ||
    left.coordinate - right.coordinate || left.minimum - right.minimum ||
    left.maximum - right.maximum ||
    left.segment.validatorEdgeId.localeCompare(right.segment.validatorEdgeId));
  const index = new RouteSegmentIndex(records.map((record) => record.segment));
  const recordBySegment = new Map(records.map((record) => [record.segment, record]));
  const orderBySegment = new Map(records.map((record, index) => [record.segment, index]));
  const reported = new Set();
  const violations = [];
  for (const left of records) {
    if (violations.length >= maximumViolations) break;
    const candidates = index.querySegment(left.segment)
      .map((segment) => recordBySegment.get(segment))
      .filter(Boolean)
      .sort((a, b) => orderBySegment.get(a.segment) - orderBySegment.get(b.segment));
    for (const right of candidates) {
      if (orderBySegment.get(right.segment) <= orderBySegment.get(left.segment)) continue;
      if (left.edge.id === right.edge.id ||
        getNetGroupKey(left.edge) === getNetGroupKey(right.edge) ||
        !collinearSegmentsOverlap(left.segment, right.segment)) continue;
      const pairKey = [left.edge.id, right.edge.id].sort().join("\u0000");
      if (reported.has(pairKey)) continue;
      reported.add(pairKey);
      violations.push(violation(
        left.edge,
        "net-overlap",
        `Route overlaps edge ${right.edge.id}`,
        { otherEdgeId: right.edge.id }
      ));
      if (violations.length >= maximumViolations) break;
    }
  }
  return violations;
}

function isOrthogonal(points) {
  return points.every((point, index) => index === points.length - 1 ||
    near(point.x, points[index + 1].x) || near(point.y, points[index + 1].y));
}

function samePoint(left, right) {
  return near(left.x, right.x) && near(left.y, right.y);
}

function violation(edge, code, message, details = {}) {
  return { edgeId: edge.id, net: edge.net, code, message, ...details };
}
