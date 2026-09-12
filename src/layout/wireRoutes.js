import { getRouteSegments } from "./orthogonalRouting.js";
import {
  getNetGroupKey,
  getPhysicalNetKey as getCanonicalPhysicalNetKey
} from "./layoutTopology.js";
import { buildNetTreeSegments } from "./netTreeRouter.js";
import { SpatialHashIndex } from "./spatialIndex.js";

const GEOMETRY_EPSILON = 0.01;

/**
 * Build the physical wire geometry used by the renderer from logical edges.
 *
 * Logical edges remain untouched for analysis, hit testing and persistence. A
 * route is grouped by net and its collinear segments are unioned so a shared
 * fanout trunk is painted once instead of once per sink.
 */
export function buildWireRoutes(edges = []) {
  const groups = new Map();
  for (const edge of edges) {
    const netKey = getPhysicalNetKey(edge);
    if (!groups.has(netKey)) groups.set(netKey, []);
    groups.get(netKey).push(edge);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([netKey, groupEdges]) => buildPhysicalWireRoute(netKey, groupEdges));
}

export function getPhysicalNetKey(edge) {
  return getCanonicalPhysicalNetKey(edge);
}

export function shiftWireRoutes(wireRoutes = [], delta = {}) {
  const dx = Number(delta.x) || 0;
  const dy = Number(delta.y) || 0;
  if (dx === 0 && dy === 0) return wireRoutes;
  return wireRoutes.map((route) => ({
    ...route,
    segments: (route.segments || []).map((segment) => ({
      ...segment,
      start: shiftPoint(segment.start, dx, dy),
      end: shiftPoint(segment.end, dx, dy)
    })),
    junctions: Array.isArray(route.junctions)
      ? route.junctions.map((point) => shiftPoint(point, dx, dy))
      : route.junctions,
    labelPoint: route.labelPoint ? shiftPoint(route.labelPoint, dx, dy) : route.labelPoint
  }));
}

export function buildPhysicalWireRoute(netKey, edges) {
  const sortedEdges = [...edges].sort(compareEdges);
  const records = sortedEdges.flatMap((edge) => getRouteSegments(
    edge.points || [],
    edge.net,
    getPhysicalNetKey(edge)
  )
    .map((segment, index) => toSegmentRecord(segment, edge, index))
    .filter(Boolean));
  const merged = mergeSegments(records);
  const normalizedSegments = splitSegmentsAtJunctions(merged);
  const tree = buildNetTreeSegments(normalizedSegments, sortedEdges);
  const labelEdge = sortedEdges.find((edge) => edge.showLabel !== false && edge.label) ||
    sortedEdges.find((edge) => edge.label) || sortedEdges[0];
  const logicalEdgeIds = sortedEdges
    .map((edge) => edge.id)
    .filter((id) => id !== undefined && id !== null)
    .map(String)
    .sort((left, right) => left.localeCompare(right));
  const labelPoint = isPointOnSegments(labelEdge?.labelPoint, tree.segments)
    ? labelEdge.labelPoint
    : chooseLabelPoint(tree.segments);

  return {
    id: `wire:${encodeKey(netKey)}`,
    netGroupKey: netKey,
    net: labelEdge?.net || labelEdge?.label || netKey,
    logicalEdgeIds,
    sourceNodeId: uniqueSorted(sortedEdges.map((edge) => edge.source))[0] || null,
    sourceNodeIds: uniqueSorted(sortedEdges.map((edge) => edge.source)),
    targetNodeIds: uniqueSorted(sortedEdges.map((edge) => edge.target)),
    topology: tree.topology,
    treeFallback: tree.treeFallback,
    componentCount: tree.componentCount,
    cycleCount: tree.cycleCount,
    reachableTargetCount: tree.reachableTargetCount,
    segments: tree.segments.map((segment, index) => ({
      id: `wire-segment:${encodeKey(netKey)}:${index}`,
      start: segment.start,
      end: segment.end,
      kind: segment.logicalEdgeIds.length > 1 ? "trunk" : "branch",
      netGroupKey: netKey,
      physicalOwner: netKey,
      logicalEdgeIds: [...segment.logicalEdgeIds].sort((left, right) => left.localeCompare(right))
    })),
    // Junction markers describe the rendered physical tree, not provider
    // candidate geometry that was removed while selecting the tree. Using
    // the pre-tree segments can place dots on same-net crossings that are
    // not electrically connected in the final route.
    junctions: findJunctions(tree.segments),
    label: labelEdge?.label || labelEdge?.net || "",
    labelPoint,
    labelAnchor: labelEdge?.labelAnchor || "middle",
    showLabel: Boolean(labelEdge?.label) && labelEdge?.showLabel !== false
  };
}

function isPointOnSegments(point, segments) {
  if (!point || !Array.isArray(segments)) return false;
  return segments.some((segment) => {
    const horizontal = Math.abs(segment.start.y - segment.end.y) <= GEOMETRY_EPSILON;
    const vertical = Math.abs(segment.start.x - segment.end.x) <= GEOMETRY_EPSILON;
    if (horizontal && Math.abs(point.y - segment.start.y) <= GEOMETRY_EPSILON) {
      return point.x >= Math.min(segment.start.x, segment.end.x) - GEOMETRY_EPSILON &&
        point.x <= Math.max(segment.start.x, segment.end.x) + GEOMETRY_EPSILON;
    }
    if (vertical && Math.abs(point.x - segment.start.x) <= GEOMETRY_EPSILON) {
      return point.y >= Math.min(segment.start.y, segment.end.y) - GEOMETRY_EPSILON &&
        point.y <= Math.max(segment.start.y, segment.end.y) + GEOMETRY_EPSILON;
    }
    return false;
  });
}

function findJunctions(segments) {
  const points = new Map();
  const add = (point, segment) => {
    const key = `${quantize(point.x)}:${quantize(point.y)}`;
    const value = points.get(key) || { count: 0, signatures: new Set() };
    value.count += 1;
    value.signatures.add([...segment.logicalEdgeIds].sort().join("\u0000"));
    points.set(key, value);
  };
  for (const segment of segments) {
    add(segment.start, segment);
    add(segment.end, segment);
  }
  return [...points.entries()]
    .filter(([, value]) => value.count >= 3 || value.signatures.size > 1)
    .map(([key]) => {
      const [x, y] = key.split(":").map(Number);
      return { x, y };
    })
    .sort((left, right) => left.x - right.x || left.y - right.y);
}

function splitSegmentsAtJunctions(segments) {
  const splitPoints = segments.map(() => []);
  if (segments.length < 2) return segments;

  // Intersections are only possible between perpendicular segments after
  // mergeSegments() has removed same-axis overlaps. Query a shared spatial
  // index instead of comparing every pair in the physical net. This keeps
  // sparse large nets near O(S log S + I), while dense junctions still pay
  // only for the intersections that can actually create split points.
  const segmentIndex = new SpatialHashIndex(128);
  segments.forEach((segment, index) => segmentIndex.insert({ segment, index }, segmentBox(segment)));
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex];
    for (const record of segmentIndex.query(segmentBox(left))) {
      const rightIndex = record.index;
      if (rightIndex <= leftIndex) continue;
      const point = orthogonalIntersection(left, record.segment);
      if (!point) continue;
      splitPoints[leftIndex].push(point);
      splitPoints[rightIndex].push(point);
    }
  }
  return segments.flatMap((segment, index) => {
    const points = [segment.start, ...splitPoints[index], segment.end]
      .sort((left, right) => segment.orientation === "horizontal"
        ? left.x - right.x
        : left.y - right.y)
      .filter((point, pointIndex, list) => pointIndex === 0 ||
        Math.abs(point.x - list[pointIndex - 1].x) > GEOMETRY_EPSILON ||
        Math.abs(point.y - list[pointIndex - 1].y) > GEOMETRY_EPSILON);
    return points.slice(0, -1).map((start, pointIndex) => ({
      start,
      end: points[pointIndex + 1],
      logicalEdgeIds: segment.logicalEdgeIds
    }));
  });
}

function segmentBox(segment) {
  return {
    left: Math.min(segment.start.x, segment.end.x),
    right: Math.max(segment.start.x, segment.end.x),
    top: Math.min(segment.start.y, segment.end.y),
    bottom: Math.max(segment.start.y, segment.end.y)
  };
}

function orthogonalIntersection(left, right) {
  const leftHorizontal = Math.abs(left.start.y - left.end.y) <= GEOMETRY_EPSILON;
  const rightHorizontal = Math.abs(right.start.y - right.end.y) <= GEOMETRY_EPSILON;
  if (leftHorizontal === rightHorizontal) return null;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const x = vertical.start.x;
  const y = horizontal.start.y;
  if (x < Math.min(horizontal.start.x, horizontal.end.x) - GEOMETRY_EPSILON ||
      x > Math.max(horizontal.start.x, horizontal.end.x) + GEOMETRY_EPSILON ||
      y < Math.min(vertical.start.y, vertical.end.y) - GEOMETRY_EPSILON ||
      y > Math.max(vertical.start.y, vertical.end.y) + GEOMETRY_EPSILON) {
    return null;
  }
  return { x, y };
}

function toSegmentRecord(segment, edge, index) {
  const start = finitePoint(segment.start);
  const end = finitePoint(segment.end);
  if (!start || !end) return null;
  const horizontal = Math.abs(start.y - end.y) <= GEOMETRY_EPSILON;
  const vertical = Math.abs(start.x - end.x) <= GEOMETRY_EPSILON;
  if (!horizontal && !vertical) return null;
  if (horizontal && Math.abs(start.x - end.x) <= GEOMETRY_EPSILON) return null;
  if (vertical && Math.abs(start.y - end.y) <= GEOMETRY_EPSILON) return null;
  const orientation = horizontal ? "horizontal" : "vertical";
  const coordinate = horizontal ? (start.y + end.y) / 2 : (start.x + end.x) / 2;
  const minimum = horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y);
  const maximum = horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y);
  return {
    orientation,
    coordinate,
    minimum,
    maximum,
    start,
    end,
    edgeId: String(edge.id ?? `${edge.source || ""}:${edge.target || ""}:${index}`),
    logicalEdgeIds: [String(edge.id ?? `${edge.source || ""}:${edge.target || ""}`)]
  };
}

function mergeSegments(records) {
  const buckets = new Map();
  for (const record of records) {
    const key = `${record.orientation}:${quantize(record.coordinate)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(record);
  }
  const merged = [];
  for (const bucket of buckets.values()) {
    const breakpoints = uniqueNumbers(bucket.flatMap((record) => [record.minimum, record.maximum]));
    const starts = bucket.toSorted((left, right) => left.minimum - right.minimum ||
      left.maximum - right.maximum || left.edgeId.localeCompare(right.edgeId));
    const ends = bucket.toSorted((left, right) => left.maximum - right.maximum ||
      left.minimum - right.minimum || left.edgeId.localeCompare(right.edgeId));
    const active = new Set();
    let startIndex = 0;
    let endIndex = 0;
    for (let index = 0; index < breakpoints.length - 1; index += 1) {
      const minimum = breakpoints[index];
      const maximum = breakpoints[index + 1];
      if (maximum - minimum <= GEOMETRY_EPSILON) continue;
      while (endIndex < ends.length && ends[endIndex].maximum <= minimum + GEOMETRY_EPSILON) {
        active.delete(ends[endIndex]);
        endIndex += 1;
      }
      while (startIndex < starts.length && starts[startIndex].minimum <= minimum + GEOMETRY_EPSILON) {
        if (starts[startIndex].maximum > minimum + GEOMETRY_EPSILON) active.add(starts[startIndex]);
        startIndex += 1;
      }
      if (active.size === 0) continue;
      const covering = [...active];
      merged.push({
        orientation: covering[0].orientation,
        coordinate: covering[0].coordinate,
        minimum,
        maximum,
        logicalEdgeIds: new Set(covering.flatMap((record) => record.logicalEdgeIds))
      });
    }
  }
  return merged
    .sort((left, right) => left.orientation.localeCompare(right.orientation) ||
      left.coordinate - right.coordinate || left.minimum - right.minimum)
    .map((segment) => ({
      start: segment.orientation === "horizontal"
        ? { x: segment.minimum, y: segment.coordinate }
        : { x: segment.coordinate, y: segment.minimum },
      end: segment.orientation === "horizontal"
        ? { x: segment.maximum, y: segment.coordinate }
        : { x: segment.coordinate, y: segment.maximum },
      logicalEdgeIds: segment.logicalEdgeIds
    }));
}

function uniqueNumbers(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return sorted.filter((value, index) => index === 0 ||
    Math.abs(value - sorted[index - 1]) > GEOMETRY_EPSILON);
}

function chooseLabelPoint(segments) {
  const horizontal = segments
    .filter((segment) => Math.abs(segment.start.y - segment.end.y) <= GEOMETRY_EPSILON)
    .sort((left, right) => segmentLength(right) - segmentLength(left))[0];
  const segment = horizontal || segments[0];
  if (!segment) return { x: 0, y: 0 };
  return {
    x: (segment.start.x + segment.end.x) / 2,
    y: segment.start.y - 6
  };
}

function segmentLength(segment) {
  return Math.abs(segment.end.x - segment.start.x) + Math.abs(segment.end.y - segment.start.y);
}

function finitePoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))
    ? { x: Number(point.x), y: Number(point.y) }
    : null;
}

function shiftPoint(point, dx, dy) {
  return point ? { x: point.x + dx, y: point.y + dy } : point;
}

function compareEdges(left, right) {
  return getPhysicalNetKey(left).localeCompare(getPhysicalNetKey(right)) ||
    String(left?.id || "").localeCompare(String(right?.id || ""));
}

function uniqueSorted(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null).map(String))]
    .sort((left, right) => left.localeCompare(right));
}

function quantize(value) {
  return Math.round(value * 100) / 100;
}

function encodeKey(value) {
  return encodeURIComponent(String(value)).replaceAll("%", "_");
}
