import {
  compactOrthogonalPoints,
  getTargetApproachPoint
} from "./orthogonalRouting.js";
import {
  collectLocalLaneYs,
  queryReservedSegments
} from "./routeLaneCandidates.js";

export function* iterateLocalRouteCandidates(context) {
  const {
    source,
    target,
    start,
    end,
    nodes,
    nodeIndex,
    margin,
    reservedSegments,
    net
  } = context;
  const routeEnd = getTargetApproachPoint(target, end);

  if (Math.abs(start.x - end.x) < 0.5 || (
    start.x <= end.x && Math.abs(start.y - end.y) < 0.5
  )) {
    yield candidate("direct", [start, end]);
  }

  if (start.x < routeEnd.x) {
    const horizontalGap = routeEnd.x - start.x;
    const endpointClearance = Math.min(24, Math.max(2, horizontalGap / 4));
    const minChannelX = start.x + endpointClearance;
    const maxChannelX = routeEnd.x - endpointClearance;
    if (minChannelX <= maxChannelX) {
      const middleX = (minChannelX + maxChannelX) / 2;
      for (const channelX of alternatingCandidates(middleX, margin, 16)) {
        if (channelX < minChannelX || channelX > maxChannelX) continue;
        yield candidate("channel", [
          start,
          { x: channelX, y: start.y },
          { x: channelX, y: routeEnd.y },
          routeEnd,
          end
        ]);
      }
    }
  }

  yield* iterateLocalDetours(
    start,
    routeEnd,
    end,
    nodes,
    nodeIndex,
    reservedSegments,
    net
  );
  yield* iterateOuterLanes(start, routeEnd, end, source, target, nodes, margin);
}

function* iterateLocalDetours(
  start,
  end,
  finalEnd,
  nodes,
  nodeIndex,
  reservedSegments,
  net
) {
  const padding = 8;
  const forward = start.x < end.x;
  const horizontalGap = Math.abs(end.x - start.x);
  const endpointClearance = forward ? Math.min(24, Math.max(2, horizontalGap / 4)) : 12;
  const sourceLaneX = start.x + endpointClearance;
  const targetLaneX = end.x - endpointClearance;
  const minRouteX = Math.min(sourceLaneX, targetLaneX);
  const maxRouteX = Math.max(sourceLaneX, targetLaneX);
  const minNodeY = Math.min(...nodes.map((node) => node.y));
  const maxNodeY = Math.max(...nodes.map((node) => node.y + node.height));
  const relevantNodes = nodeIndex.query({
    left: minRouteX - padding,
    right: maxRouteX + padding,
    top: minNodeY - padding,
    bottom: maxNodeY + padding
  });
  const relevantSegments = queryReservedSegments(reservedSegments, {
    left: minRouteX - padding,
    right: maxRouteX + padding,
    top: minNodeY - padding,
    bottom: maxNodeY + padding
  }, net);
  const laneYs = collectLocalLaneYs({
    sourceY: start.y,
    targetY: end.y,
    nodes: relevantNodes,
    segments: relevantSegments,
    padding
  });

  for (const laneY of laneYs) {
    yield candidate("local-detour", [
      start,
      { x: sourceLaneX, y: start.y },
      { x: sourceLaneX, y: laneY },
      { x: targetLaneX, y: laneY },
      { x: targetLaneX, y: end.y },
      end,
      finalEnd
    ]);
  }
}

function* iterateOuterLanes(start, end, finalEnd, source, target, nodes, margin) {
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  const attempts = Math.min(256, Math.max(32, nodes.length + 8));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sourceLaneX = source.x + source.width + margin + attempt * margin;
    const targetLaneX = target.x - margin - attempt * margin;
    const laneYs = [minY - margin - attempt * margin, maxY + margin + attempt * margin]
      .toSorted((left, right) =>
        Math.abs(left - start.y) + Math.abs(left - end.y) -
        Math.abs(right - start.y) - Math.abs(right - end.y));
    for (const laneY of laneYs) {
      yield candidate("outer-lane", [
        start,
        { x: sourceLaneX, y: start.y },
        { x: sourceLaneX, y: laneY },
        { x: targetLaneX, y: laneY },
        { x: targetLaneX, y: end.y },
        end,
        finalEnd
      ]);
    }
  }
}

function candidate(kind, points) {
  return { kind, points: compactOrthogonalPoints(points) };
}

function alternatingCandidates(center, pitch, count) {
  const values = [center];
  for (let index = 1; index <= count; index += 1) {
    values.push(center + index * pitch, center - index * pitch);
  }
  return values;
}
