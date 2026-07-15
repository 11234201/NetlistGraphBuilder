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

export function validateLayoutGraph(graph, options = {}) {
  const violations = [];
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const checkObstacles = options.checkObstacles !== false;
  const checkOverlaps = options.checkOverlaps !== false;

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
      const blockedBy = findBlockingNode(points, nodes, source, target, options.nodePadding || 0);
      if (blockedBy) {
        violations.push(violation(
          edge,
          "node-crossing",
          `Route crosses node ${blockedBy.id}`,
          { nodeId: blockedBy.id }
        ));
      }
    }
  }

  if (checkOverlaps) violations.push(...findNetOverlaps(edges));
  return violations;
}

function findBlockingNode(points, nodes, source, target, padding) {
  for (const node of nodes) {
    if (node.id === source.id || node.id === target.id) continue;
    const box = nodeBox(node, padding);
    for (let index = 0; index < points.length - 1; index += 1) {
      if (orthogonalSegmentIntersectsBox(points[index], points[index + 1], box)) return node;
    }
  }
  return null;
}

function findNetOverlaps(edges) {
  const violations = [];
  const lineGroups = new Map();
  for (const edge of edges) {
    for (const segment of getRouteSegments(edge.points, edge.net)) {
      const horizontal = near(segment.start.y, segment.end.y);
      const vertical = near(segment.start.x, segment.end.x);
      if (!horizontal && !vertical) continue;
      const coordinate = horizontal ? segment.start.y : segment.start.x;
      const key = `${horizontal ? "h" : "v"}:${Math.round(coordinate * 2) / 2}`;
      if (!lineGroups.has(key)) lineGroups.set(key, []);
      const start = horizontal ? segment.start.x : segment.start.y;
      const end = horizontal ? segment.end.x : segment.end.y;
      lineGroups.get(key).push({
        edge,
        segment,
        minimum: Math.min(start, end),
        maximum: Math.max(start, end)
      });
    }
  }

  const reported = new Set();
  for (const line of lineGroups.values()) {
    line.sort((left, right) => left.minimum - right.minimum || left.maximum - right.maximum);
    for (let leftIndex = 0; leftIndex < line.length; leftIndex += 1) {
      const left = line[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < line.length; rightIndex += 1) {
        const right = line[rightIndex];
        if (right.minimum >= left.maximum) break;
        if (left.edge.id === right.edge.id || left.edge.net === right.edge.net) continue;
        if (!collinearSegmentsOverlap(left.segment, right.segment)) continue;
        const pairKey = [left.edge.id, right.edge.id].sort().join("\u0000");
        if (reported.has(pairKey)) continue;
        reported.add(pairKey);
        violations.push(violation(
          left.edge,
          "net-overlap",
          `Route overlaps edge ${right.edge.id}`,
          { otherEdgeId: right.edge.id }
        ));
      }
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
