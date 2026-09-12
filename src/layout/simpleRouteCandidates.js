import {
  compactOrthogonalPoints,
  ensureVisibleTargetCornerLaneY,
  getTargetApproachPoint,
  getTargetLaneInset,
  isVerticalTargetPin
} from "./orthogonalRouting.js";
import { getPort } from "./nodeGeometry.js";
import {
  routeCandidateIsUsable,
  routeOverlapsReserved,
  routeSegmentIsClear
} from "./routeCandidateValidation.js";
import {
  collectLocalLaneYs,
  queryReservedSegments,
  uniqueRoundedNumbers
} from "./routeLaneCandidates.js";
import { ROUTE_SEARCH_LIMITS } from "./routeSearchPolicy.js";

export const MAX_GLOBAL_LANE_CANDIDATES =
  ROUTE_SEARCH_LIMITS.maximumGlobalLaneCandidates;
export const MAX_LOCAL_LANE_CANDIDATES =
  ROUTE_SEARCH_LIMITS.localChannelAlternatives;
export const MAX_EXPANDED_LOCAL_LANE_CANDIDATES =
  ROUTE_SEARCH_LIMITS.expandedLocalChannelAlternatives;
export const MAX_EXPANDED_LOCAL_CANDIDATE_ATTEMPTS =
  ROUTE_SEARCH_LIMITS.maximumExpandedLocalCandidateAttempts;

export function createBasicSimpleRouteCandidates(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    edgePlan,
    levelBounds,
    wireLanePitch,
    edgeIntent,
    routingGeometry
  } = context;
  const sourceLevel = source.level ?? 0;
  const targetLevel = target.level ?? sourceLevel + 1;
  const levelDistance = targetLevel - sourceLevel;
  const sourceBounds = levelBounds.get(sourceLevel) || { right: source.x + source.width };
  const horizontalGap = targetPoint.x - sourcePoint.x;
  const yDelta = Math.abs(targetPoint.y - sourcePoint.y);
  const candidates = [];

  if (horizontalGap > 0 && yDelta <= 4) {
    candidates.push(createRoute("direct", [sourcePoint, targetPoint]));
  }
  if (Math.abs(horizontalGap) <= 4 && yDelta > 0) {
    candidates.push(createRoute("direct", [sourcePoint, targetPoint]));
  }

  const plannedLane = edgeIntent?.fanout > 1 && !edgeIntent.isPrimary
    ? sourceBounds.right + 24 + (edgePlan?.lane ?? edgePlan?.sourceLane ?? 0) * wireLanePitch
    : null;
  if (plannedLane !== null) {
    candidates.push(createRoute("fanout-trunk", [
      sourcePoint,
      { x: plannedLane, y: sourcePoint.y },
      { x: plannedLane, y: targetPoint.y },
      targetPoint
    ]));
  }

  if (horizontalGap > 0) {
    const inset = getTargetLaneInset(target, targetPoint, horizontalGap, routingGeometry);
    const minLaneX = sourcePoint.x + inset;
    const maxLaneX = targetPoint.x - inset;
    for (const ratio of [0.5, 0.25, 0.75]) {
      const laneX = minLaneX + (maxLaneX - minLaneX) * ratio;
      candidates.push(createRoute("local-dogleg", [
        sourcePoint,
        { x: laneX, y: sourcePoint.y },
        { x: laneX, y: targetPoint.y },
        targetPoint
      ]));
    }
    if (levelDistance <= 1) {
      const laneX = sourceBounds.right + 18 + (edgePlan?.lane || 0) * wireLanePitch;
      if (laneX > sourcePoint.x && laneX < targetPoint.x) {
        candidates.push(createRoute("channel", [
          sourcePoint,
          { x: laneX, y: sourcePoint.y },
          { x: laneX, y: targetPoint.y },
          targetPoint
        ]));
      }
    }
  }
  return candidates;
}

export function createLocalObstacleCandidates(context, options = {}) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    nodeIndex,
    nodeBounds,
    levelBounds,
    reservedSegments,
    net,
    netGroupKey,
    wireLanePitch,
    edgePlan,
    routingGeometry
  } = context;
  const geometry = routingGeometry || {};
  const padding = Number(geometry.targetApproachClearance) || 9;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint, padding);
  const forward = sourcePoint.x < routeTargetPoint.x;
  const gap = Math.abs(routeTargetPoint.x - sourcePoint.x);
  const sourceInset = forward
    ? Math.min(
      Number(geometry.maximumEndpointInset) || 24,
      Math.max(Number(geometry.minimumEndpointInset) || 2, gap / 4)
    )
    : Number(geometry.reverseEndpointInset) || 12;
  const targetInset = getTargetLaneInset(
    target,
    targetPoint,
    routeTargetPoint.x - sourcePoint.x,
    geometry
  );
  const verticalTargetPin = isVerticalTargetPin(target, targetPoint);
  const sourceColumnRight = Math.max(
    sourcePoint.x,
    levelBounds?.get(source.level)?.right ?? source.x + source.width
  );
  const targetColumnLeft = Math.min(
    targetPoint.x,
    levelBounds?.get(target.level)?.left ?? target.x
  );
  const sourceUsesLocalEscape = source.kind === "input" ||
    source.kind === "focus-input" ||
    source.kind === "implicit" ||
    source.kind === "constant";
  const sourceLaneX = forward
    ? sourceUsesLocalEscape
      ? Math.min(routeTargetPoint.x - 2, sourcePoint.x + sourceInset)
      : Math.min(routeTargetPoint.x - 2, Math.max(sourcePoint.x + sourceInset, sourceColumnRight + padding))
    : sourcePoint.x + sourceInset;
  const targetLaneX = forward
    ? verticalTargetPin
      ? routeTargetPoint.x - targetInset
      : Math.max(sourcePoint.x + 2, Math.min(routeTargetPoint.x - targetInset, targetColumnLeft - padding))
    : routeTargetPoint.x - targetInset;
  const laneAdjustedSourceX = applyNodeLocalEscapeLane(
    sourceLaneX,
    source,
    sourcePoint,
    edgePlan,
    wireLanePitch,
    "source"
  );
  const laneAdjustedTargetX = applyNodeLocalEscapeLane(
    targetLaneX,
    target,
    targetPoint,
    edgePlan,
    wireLanePitch,
    "target"
  );
  const effectiveSourceLaneX = laneAdjustedSourceX;
  const effectiveTargetLaneX = laneAdjustedTargetX;
  const minX = Math.min(effectiveSourceLaneX, effectiveTargetLaneX);
  const maxX = Math.max(effectiveSourceLaneX, effectiveTargetLaneX);
  const corridorTop = Math.min(
    source.y,
    target.y,
    sourcePoint.y,
    routeTargetPoint.y
  ) - padding * 4;
  const corridorBottom = Math.max(
    source.y + source.height,
    target.y + target.height,
    sourcePoint.y,
    routeTargetPoint.y
  ) + padding * 4;
  const relevantNodes = nodeIndex && nodeBounds
    ? nodeIndex.query({
      left: minX - padding,
      right: maxX + padding,
      top: corridorTop,
      bottom: corridorBottom
    })
    : nodes.filter((node) =>
      node.x + node.width + padding > minX && node.x - padding < maxX &&
      node.y + node.height + padding > corridorTop && node.y - padding < corridorBottom);
  const relevantSegments = queryReservedSegments(reservedSegments, {
    left: minX - padding,
    right: maxX + padding,
    top: corridorTop,
    bottom: corridorBottom
  }, net, netGroupKey);
  const laneYs = collectLocalLaneYs({
    sourceY: sourcePoint.y,
    targetY: routeTargetPoint.y,
    nodes: relevantNodes,
    segments: relevantSegments,
    padding,
    preferredLaneY: edgePlan?.preferredLaneY
  });

  const laneOffsets = options.expandXLanes === true
    ? createExpandedLocalLaneOffsets(wireLanePitch)
    : createObstacleEscapeOffsets(
      relevantNodes,
      effectiveSourceLaneX,
      effectiveTargetLaneX,
      padding,
      wireLanePitch
    );
  const maximumCandidates = options.expandXLanes === true
    ? MAX_EXPANDED_LOCAL_LANE_CANDIDATES
    : MAX_LOCAL_LANE_CANDIDATES;
  const candidates = [];
  const overlappingCandidates = [];
  let attempts = 0;
  const appendCandidate = (laneY, laneOffset) => {
    const visibleLaneY = ensureVisibleTargetCornerLaneY(
      laneY,
      routeTargetPoint.y,
      target,
      targetPoint,
      padding
    );
    const candidateSourceLaneX = effectiveSourceLaneX + laneOffset.source;
    const candidateTargetLaneX = effectiveTargetLaneX + laneOffset.target;
    const candidate = createRoute("obstacle-local", [
      sourcePoint,
      { x: candidateSourceLaneX, y: sourcePoint.y },
      { x: candidateSourceLaneX, y: visibleLaneY },
      { x: candidateTargetLaneX, y: visibleLaneY },
      { x: candidateTargetLaneX, y: routeTargetPoint.y },
      routeTargetPoint,
      targetPoint
    ]);
    if (options.expandXLanes === true && !routeCandidateIsUsable(candidate.points, {
      source,
      target,
      sourcePoint,
      targetPoint,
      nodeIndex
    })) return;
    if (options.expandXLanes === true && routeOverlapsReserved(
      candidate.points,
      net,
      reservedSegments || [],
      netGroupKey
    )) {
      overlappingCandidates.push(candidate);
      return;
    }
    candidates.push(candidate);
  };
  const firstDimension = options.expandXLanes === true ? laneOffsets : laneYs;
  const secondDimension = options.expandXLanes === true ? laneYs : laneOffsets;
  if (options.reservedDetours === true) {
    return createReservedDetourCandidates(
      sourcePoint,
      routeTargetPoint,
      targetPoint,
      effectiveSourceLaneX,
      effectiveTargetLaneX,
      relevantSegments,
      wireLanePitch
    );
  }
  for (const first of firstDimension) {
    for (const second of secondDimension) {
      attempts += 1;
      if (attempts > MAX_EXPANDED_LOCAL_CANDIDATE_ATTEMPTS ||
        candidates.length >= maximumCandidates) {
        return [...candidates, ...overlappingCandidates].slice(0, maximumCandidates);
      }
      appendCandidate(
        options.expandXLanes === true ? second : first,
        options.expandXLanes === true ? first : second
      );
    }
  }
  return [...candidates, ...overlappingCandidates].slice(0, maximumCandidates);
}

/**
 * Consume the node-local long-edge lane assigned by simpleRoutingPlan.  The
 * offset is only applied to collapsed group boundaries with horizontal ports;
 * ordinary cell/input geometry keeps the existing local candidates.  The
 * direction is derived from the actual port side so a reverse edge still
 * expands away from the node instead of crossing a neighbouring column.
 */
function applyNodeLocalEscapeLane(baseX, node, point, edgePlan, wireLanePitch, role) {
  if (node?.kind !== "group" || edgePlan?.kind !== "long") return baseX;
  const port = getPort(node, role === "source" ? edgePlan.sourcePin : edgePlan.targetPin, role);
  const side = port?.side || (role === "source" ? "right" : "left");
  if (side !== "left" && side !== "right") return baseX;
  const laneIndex = Math.max(0, Math.floor(Number(
    role === "source" ? edgePlan.sourceLane : edgePlan.targetLane
  ) || 0));
  if (laneIndex === 0) return baseX;
  const pitch = Math.max(4, Number(wireLanePitch) || 24);
  const outward = side === "right" ? 1 : -1;
  // Keep the lane outside the endpoint body even when a malformed port point
  // falls on the opposite side; the candidate validator remains authoritative.
  const fallbackOutward = role === "source"
    ? (point.x >= node.x + node.width / 2 ? 1 : -1)
    : (point.x <= node.x + node.width / 2 ? -1 : 1);
  return baseX + (outward || fallbackOutward) * laneIndex * pitch;
}

function createReservedDetourCandidates(
  sourcePoint,
  routeTargetPoint,
  targetPoint,
  sourceLaneX,
  targetLaneX,
  segments,
  wireLanePitch
) {
  const delta = Math.max(4, Math.round((Number(wireLanePitch) || 24) / 3));
  const candidates = [];
  for (const segment of segments || []) {
    const horizontal = Math.abs(segment.start.y - segment.end.y) < 0.5;
    if (horizontal) continue;
    const segmentX = segment.start.x;
    const minimumY = Math.min(segment.start.y, segment.end.y);
    const maximumY = Math.max(segment.start.y, segment.end.y);
    for (const laneX of [segmentX - delta, segmentX + delta]) {
      for (const laneY of [minimumY - 9, maximumY + 9]) {
        candidates.push(createRoute("reserved-detour", [
          sourcePoint,
          { x: laneX, y: sourcePoint.y },
          { x: laneX, y: laneY },
          { x: targetLaneX, y: laneY },
          { x: targetLaneX, y: routeTargetPoint.y },
          routeTargetPoint,
          targetPoint
        ]));
      }
    }
  }
  return candidates.slice(0, MAX_LOCAL_LANE_CANDIDATES);
}

function createObstacleEscapeOffsets(nodes, sourceLaneX, targetLaneX, padding, wireLanePitch) {
  const offsets = [{ source: 0, target: 0 }];
  const critical = [];
  const candidates = [];
  for (const node of nodes || []) {
    const sourceInside = sourceLaneX > node.x - padding &&
      sourceLaneX < node.x + node.width + padding;
    const targetInside = targetLaneX > node.x - padding &&
      targetLaneX < node.x + node.width + padding;
    const destination = sourceInside ? critical : candidates;
    destination.push(
      { source: node.x + node.width + padding - sourceLaneX, target: 0 },
      { source: node.x - padding - sourceLaneX, target: 0 }
    );
    if (targetInside) {
      critical.push(
        { source: 0, target: node.x + node.width + padding - targetLaneX },
        { source: 0, target: node.x - padding - targetLaneX }
      );
    } else {
      candidates.push(
        { source: 0, target: node.x + node.width + padding - targetLaneX },
        { source: 0, target: node.x - padding - targetLaneX }
      );
    }
  }
  const maxOffset = Math.max(256, (Number(wireLanePitch) || 24) * 8);
  [...critical, ...candidates]
    .filter((offset) => Math.abs(offset.source) <= maxOffset && Math.abs(offset.target) <= maxOffset)
    .forEach((offset) => {
      if (offset.source === 0 && offset.target === 0) return;
      if (!offsets.some((item) => item.source === offset.source && item.target === offset.target)) {
        offsets.push(offset);
      }
    });
  return offsets.slice(0, MAX_LOCAL_LANE_CANDIDATES);
}

function createExpandedLocalLaneOffsets(wireLanePitch) {
  const pitch = Number.isFinite(Number(wireLanePitch)) && Number(wireLanePitch) > 0
    ? Number(wireLanePitch)
    : 18;
  const halfPitch = pitch / 2;
  const distances = uniqueRoundedNumbers([halfPitch, pitch, pitch * 2, pitch * 3]);
  return [
    ...distances.flatMap((distance) => [
      { source: -distance, target: -distance },
      { source: distance, target: distance },
      { source: -distance, target: distance },
      { source: distance, target: -distance },
      { source: -distance, target: 0 },
      { source: distance, target: 0 },
      { source: 0, target: -distance },
      { source: 0, target: distance }
    ])
  ];
}

export function findObstacleAvoidingRoute(context) {
  const {
    source,
    target,
    sourcePoint,
    targetPoint,
    nodes,
    preferredLaneY,
    margin,
    lanePitch,
    nodeIndex,
    globalLaneGeometry,
    reservedSegments = [],
    net,
    netGroupKey,
    routingGeometry
  } = context;
  const clearance = Number(routingGeometry?.outerLaneClearance) || 24;
  const routeTargetPoint = getTargetApproachPoint(target, targetPoint);
  const baseSourceLaneX = getEscapeLaneX(source, sourcePoint, "source", clearance);
  const baseTargetLaneX = getEscapeLaneX(target, targetPoint, "target", clearance);
  const yCandidates = createGlobalLaneYCandidates(
    nodes,
    preferredLaneY,
    margin,
    lanePitch,
    clearance,
    globalLaneGeometry
  );
  for (const laneY of yCandidates) {
    const sourceLaneX = findClearVerticalLaneX(
      baseSourceLaneX,
      sourcePoint.y,
      laneY,
      source,
      target,
      nodeIndex,
      reservedSegments,
      net,
      netGroupKey
    );
    const targetLaneX = findClearVerticalLaneX(
      baseTargetLaneX,
      routeTargetPoint.y,
      laneY,
      source,
      target,
      nodeIndex,
      reservedSegments,
      net,
      netGroupKey
    );
    const candidate = createGlobalLaneRoute(
      sourcePoint,
      targetPoint,
      routeTargetPoint,
      sourceLaneX,
      targetLaneX,
      laneY
    );
    if (routeCandidateIsUsable(candidate.points, {
      source,
      target,
      sourcePoint,
      targetPoint,
      nodeIndex
    })) return candidate;
    // A reservation-aware x lane is only a preference until the complete route
    // passes the shared geometry contract. Keep the original node-safe choice
    // available so a dense graph cannot fall through to a node-crossing lane.
    const sourceFallbackLaneX = findClearVerticalLaneX(
      baseSourceLaneX,
      sourcePoint.y,
      laneY,
      source,
      target,
      nodeIndex
    );
    const targetFallbackLaneX = findClearVerticalLaneX(
      baseTargetLaneX,
      routeTargetPoint.y,
      laneY,
      source,
      target,
      nodeIndex
    );
    if (sourceLaneX === sourceFallbackLaneX && targetLaneX === targetFallbackLaneX) continue;
    const fallbackCandidate = createGlobalLaneRoute(
      sourcePoint,
      targetPoint,
      routeTargetPoint,
      sourceFallbackLaneX,
      targetFallbackLaneX,
      laneY
    );
    if (routeCandidateIsUsable(fallbackCandidate.points, {
      source,
      target,
      sourcePoint,
      targetPoint,
      nodeIndex
    })) return fallbackCandidate;
  }

  // The bounded offset search above is deliberately local. On a dense
  // focused cone it can exhaust all offsets even though an unbounded outer
  // corridor is available. Never return the old base-lane route here: that
  // route may cut through an intermediate cell. Try constant-size outer
  // combinations and validate the complete path before accepting one.
  let firstNodeSafeCandidate = null;
  for (const laneY of getOuterLaneYs(nodes, margin, clearance, globalLaneGeometry)) {
    for (const sourceLaneX of getOuterLaneXs(
      baseSourceLaneX,
      source,
      nodes,
      clearance,
      margin
    )) {
      for (const targetLaneX of getOuterLaneXs(
        baseTargetLaneX,
        target,
        nodes,
        clearance,
        margin
      )) {
        const candidate = createGlobalLaneRoute(
          sourcePoint,
          targetPoint,
          routeTargetPoint,
          sourceLaneX,
          targetLaneX,
          laneY
        );
        if (!routeCandidateIsUsable(candidate.points, {
          source,
          target,
          sourcePoint,
          targetPoint,
          nodeIndex
        })) continue;
        firstNodeSafeCandidate ??= candidate;
        if (routeOverlapsReserved(candidate.points, net, reservedSegments, netGroupKey)) continue;
        return candidate;
      }
    }
  }

  // A dense reservation map can occupy every outer corridor while a route
  // that is clear of node bodies still exists. Preserve the physical safety
  // guarantee and accept that candidate rather than falling back to a direct
  // segment through a visible cell.
  if (firstNodeSafeCandidate) return firstNodeSafeCandidate;

  // A graph with no node-safe outer candidate is geometrically unsatisfiable
  // under the current placement. Keep the failure bounded, but preserve
  // orthogonality and endpoint sides so validation reports only the remaining
  // obstacle conflict instead of multiplying it into diagonal/side errors.
  return createGlobalLaneRoute(
    sourcePoint,
    targetPoint,
    routeTargetPoint,
    baseSourceLaneX,
    baseTargetLaneX,
    preferredLaneY
  );
}

function getOuterLaneYs(nodes, margin, clearance, preparedGeometry) {
  const geometry = preparedGeometry || prepareGlobalLaneGeometry(nodes, clearance);
  const padding = Math.max(Number(margin) || 0, Number(clearance) || 0) + clearance;
  return uniqueRoundedNumbers([
    geometry.minTop - padding,
    geometry.maxBottom + padding
  ]);
}

function getOuterLaneXs(baseLaneX, node, nodes, clearance, margin) {
  let left = node.x;
  let right = node.x + node.width;
  for (const candidate of nodes || []) {
    left = Math.min(left, candidate.x);
    right = Math.max(right, candidate.x + candidate.width);
  }
  const padding = Math.max(Number(margin) || 0, Number(clearance) || 0) + clearance;
  left -= padding;
  right += padding;
  const preferredSide = baseLaneX < node.x ? "left" : "right";
  const directionalOuter = preferredSide === "left" ? left : right;
  return uniqueRoundedNumbers([baseLaneX, directionalOuter, preferredSide === "left" ? right : left]);
}

function createGlobalLaneRoute(
  sourcePoint,
  targetPoint,
  routeTargetPoint,
  sourceLaneX,
  targetLaneX,
  laneY
) {
  return createRoute("obstacle-lane", [
    sourcePoint,
    { x: sourceLaneX, y: sourcePoint.y },
    { x: sourceLaneX, y: laneY },
    { x: targetLaneX, y: laneY },
    { x: targetLaneX, y: routeTargetPoint.y },
    routeTargetPoint,
    targetPoint
  ]);
}

export function computeLevelBounds(nodes) {
  const bounds = new Map();
  for (const node of nodes) {
    const level = node.level ?? 0;
    const current = bounds.get(level) || { left: node.x, right: node.x + node.width };
    current.left = Math.min(current.left, node.x);
    current.right = Math.max(current.right, node.x + node.width);
    bounds.set(level, current);
  }
  return bounds;
}

function createRoute(kind, points) {
  return { kind, points: compactOrthogonalPoints(points) };
}

function getEscapeLaneX(node, point, role, clearance) {
  const leftDistance = Math.abs(point.x - node.x);
  const rightDistance = Math.abs(point.x - (node.x + node.width));
  if (role === "source") {
    return rightDistance <= leftDistance ? node.x + node.width + clearance : node.x - clearance;
  }
  return leftDistance <= rightDistance ? node.x - clearance : node.x + node.width + clearance;
}

export function createGlobalLaneYCandidates(
  nodes,
  preferredLaneY,
  margin,
  lanePitch,
  clearance,
  preparedGeometry = null
) {
  const { minTop, maxBottom, gapLanes } = preparedGeometry ||
    prepareGlobalLaneGeometry(nodes, clearance);
  const candidates = [preferredLaneY];
  // Keep the outer search independent of graph size. More nodes do not make
  // additional retries meaningful: the prepared gap lanes already represent
  // the available corridors, while the fixed outer samples provide bounded
  // escape choices for dense layouts.
  const outerAttempts = ROUTE_SEARCH_LIMITS.minimumOuterLaneAttempts;
  for (let index = 0; index < outerAttempts; index += 1) {
    candidates.push(minTop - margin - index * lanePitch);
    candidates.push(maxBottom + margin + index * lanePitch);
  }
  candidates.push(...gapLanes);
  return uniqueRoundedNumbers(candidates).sort(
    (left, right) => Math.abs(left - preferredLaneY) - Math.abs(right - preferredLaneY) ||
      left - right).slice(0, MAX_GLOBAL_LANE_CANDIDATES);
}

export function prepareGlobalLaneGeometry(nodes, clearance) {
  if (!nodes || nodes.length === 0) {
    return { minTop: 0, maxBottom: 0, gapLanes: [] };
  }
  const boxes = nodes.map((node) => ({
    top: node.y - clearance,
    bottom: node.y + node.height + clearance
  })).sort((left, right) => left.top - right.top || left.bottom - right.bottom);
  const gapLanes = [];
  for (let index = 1; index < boxes.length; index += 1) {
    const previous = boxes[index - 1];
    const next = boxes[index];
    if (next.top - previous.bottom >= clearance * 2) {
      gapLanes.push((previous.bottom + next.top) / 2);
    }
  }
  return {
    minTop: boxes[0].top,
    maxBottom: boxes.reduce(
      (maximum, box) => Math.max(maximum, box.bottom),
      boxes[0].bottom
    ),
    gapLanes
  };
}

function findClearVerticalLaneX(
  preferredX,
  y1,
  y2,
  source,
  target,
  nodeIndex,
  reservedSegments = [],
  net,
  netGroupKey
) {
  // Include small offsets so a lane can fit in the narrow gap between an
  // endpoint and a nearby port node. The larger offsets remain the bounded
  // escape path for dense layouts.
  const offsets = [0, 4, -4, 8, -8, 12, -12, 16, -16, 20, -20, 24, -24, 48, -48, 72, -72, 96, -96, 144, -144, 192, -192];
  let firstClearX = null;
  const hasReservedSegments = reservedSegments && reservedSegments.length > 0;
  for (const offset of offsets) {
    const x = preferredX + offset;
    if (!routeSegmentIsClear(
      { x, y: y1 },
      { x, y: y2 },
      { nodeIndex, source, target }
    )) continue;
    // If every reserved-free alternative is occupied, preserve node clearance
    // as the next-best bounded fallback instead of returning a node-crossing lane.
    firstClearX ??= x;
    if (!hasReservedSegments) return x;
    if (!routeOverlapsReserved([
      { x, y: y1 },
      { x, y: y2 }
    ], net, reservedSegments, netGroupKey)) return x;
  }
  return firstClearX ?? preferredX;
}
