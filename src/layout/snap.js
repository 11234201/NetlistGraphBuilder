export const DEFAULT_GRID_SIZE = 8;
export const DEFAULT_PIN_SNAP_THRESHOLD = 10;

export function snapNodePosition(graph, nodeId, candidate, options = {}) {
  const gridSize = Number(options.gridSize) || DEFAULT_GRID_SIZE;
  const threshold = Number(options.pinSnapThreshold) || DEFAULT_PIN_SNAP_THRESHOLD;
  const node = graph?.nodes.find((item) => item.id === nodeId);
  if (!node) {
    return {
      position: snapToGrid(candidate, gridSize),
      snap: null
    };
  }

  const gridPosition = snapToGrid(candidate, gridSize);
  const pinSnap = findPinYSnap(graph, node, gridPosition, threshold);
  if (!pinSnap) {
    return {
      position: gridPosition,
      snap: null
    };
  }

  return {
    position: {
      x: gridPosition.x,
      y: round(gridPosition.y + pinSnap.deltaY)
    },
    snap: pinSnap
  };
}

export function snapToGrid(position, gridSize = DEFAULT_GRID_SIZE) {
  return {
    x: round(Math.round(Number(position.x) / gridSize) * gridSize),
    y: round(Math.round(Number(position.y) / gridSize) * gridSize)
  };
}

function findPinYSnap(graph, movingNode, candidate, threshold) {
  const candidates = [];
  for (const edge of graph.edges || []) {
    if (edge.source === movingNode.id) {
      const target = graph.nodes.find((node) => node.id === edge.target);
      if (!target) {
        continue;
      }
      candidates.push(buildSnapCandidate(edge, movingNode, candidate, "source", target, "target"));
    } else if (edge.target === movingNode.id) {
      const source = graph.nodes.find((node) => node.id === edge.source);
      if (!source) {
        continue;
      }
      candidates.push(buildSnapCandidate(edge, movingNode, candidate, "target", source, "source"));
    }
  }

  return candidates
    .filter((candidateSnap) => Math.abs(candidateSnap.deltaY) <= threshold)
    .toSorted((left, right) => Math.abs(left.deltaY) - Math.abs(right.deltaY))[0] || null;
}

function buildSnapCandidate(edge, movingNode, candidate, movingRole, fixedNode, fixedRole) {
  const movingPin = movingRole === "source" ? edge.sourcePin : edge.targetPin;
  const fixedPin = fixedRole === "source" ? edge.sourcePin : edge.targetPin;
  const movingPoint = getConnectionPointAt(movingNode, candidate, movingPin, movingRole);
  const fixedPoint = getConnectionPointAt(fixedNode, fixedNode, fixedPin, fixedRole);

  return {
    edgeId: edge.id,
    net: edge.label || edge.net,
    movingNodeId: movingNode.id,
    fixedNodeId: fixedNode.id,
    movingPin,
    fixedPin,
    targetY: round(fixedPoint.y),
    deltaY: round(fixedPoint.y - movingPoint.y)
  };
}

function getConnectionPointAt(node, position, pin, role) {
  const preferredDirection = role === "source" ? "output" : "input";
  const port =
    node.ports?.find((candidate) => candidate.pin === pin && candidate.direction === preferredDirection) ||
    node.ports?.find((candidate) => candidate.direction === preferredDirection) ||
    node.ports?.[0];

  return {
    x: position.x + (port?.x ?? (role === "source" ? node.width : 0)),
    y: position.y + (port?.y ?? node.height / 2)
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
