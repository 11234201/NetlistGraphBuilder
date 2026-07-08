import { inferPinDirection, isInvertingOutputGate } from "../infer/defaultCellRules.js";

export function layoutGraph(graph, options = {}) {
  const xSpacing = options.xSpacing || 230;
  const ySpacing = options.ySpacing || 88;
  const margin = options.margin || 48;
  const levels = assignLevels(graph);
  const buckets = new Map();

  for (const node of graph.nodes) {
    const level = levels.get(node.id) || 0;
    if (!buckets.has(level)) {
      buckets.set(level, []);
    }
    buckets.get(level).push(node);
  }

  const positionedNodes = [];
  const levelKeys = [...buckets.keys()].sort((a, b) => a - b);

  for (const level of levelKeys) {
    const nodes = buckets.get(level).sort(compareNodes);
    for (const [index, node] of nodes.entries()) {
      const size = measureNode(node);
      positionedNodes.push({
        ...node,
        x: margin + level * xSpacing,
        y: margin + index * ySpacing,
        width: size.width,
        height: size.height,
        ports: buildNodePorts(node, size)
      });
    }
  }

  const nodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = graph.edges.map((edge) => {
    const source = nodeById.get(edge.source);
    const target = nodeById.get(edge.target);
    const sourcePoint = getConnectionPoint(source, edge.sourcePin, "source");
    const targetPoint = getConnectionPoint(target, edge.targetPin, "target");
    const midX = sourcePoint.x + Math.max(32, (targetPoint.x - sourcePoint.x) / 2);

    return {
      ...edge,
      points: [
        sourcePoint,
        { x: midX, y: sourcePoint.y },
        { x: midX, y: targetPoint.y },
        targetPoint
      ],
      labelPoint: {
        x: midX + 4,
        y: (sourcePoint.y + targetPoint.y) / 2 - 4
      }
    };
  });

  const bounds = computeBounds(positionedNodes);

  return {
    ...graph,
    nodes: positionedNodes,
    edges: positionedEdges,
    width: bounds.width + margin,
    height: bounds.height + margin
  };
}

function assignLevels(graph) {
  const levels = new Map();
  const maxIterations = Math.max(4, graph.nodes.length * 2);

  for (const node of graph.nodes) {
    if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
      levels.set(node.id, 0);
    } else {
      levels.set(node.id, 1);
    }
  }

  for (let index = 0; index < maxIterations; index += 1) {
    let changed = false;
    for (const edge of graph.edges) {
      const sourceLevel = levels.get(edge.source) || 0;
      const targetLevel = levels.get(edge.target) || 0;
      if (targetLevel <= sourceLevel) {
        levels.set(edge.target, sourceLevel + 1);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const outputLevel = Math.max(...levels.values(), 1);
  for (const node of graph.nodes) {
    if (node.kind === "output") {
      levels.set(node.id, Math.max(levels.get(node.id) || 1, outputLevel));
    }
  }

  return levels;
}

function compareNodes(left, right) {
  const leftOrder = left.order ?? 1000;
  const rightOrder = right.order ?? 1000;
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }
  return `${left.kind}:${left.label}`.localeCompare(`${right.kind}:${right.label}`);
}

function measureNode(node) {
  const labelLength = Math.max(
    String(node.label || "").length,
    String(node.subtitle || "").length,
    String(node.title || "").length
  );
  const width = clamp(labelLength * 7 + 42, node.kind === "cell" ? 128 : 92, 220);
  const pinCount = getMaxPinCount(node);
  const height =
    node.kind === "cell" || node.kind === "assign"
      ? Math.max(58, 18 + pinCount * 18)
      : 36;
  return { width, height };
}

function buildNodePorts(node, size) {
  if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
    return [
      {
        pin: node.label,
        direction: "output",
        side: "right",
        x: size.width,
        y: size.height / 2
      }
    ];
  }

  if (node.kind === "output") {
    return [
      {
        pin: node.label,
        direction: "input",
        side: "left",
        x: 0,
        y: size.height / 2
      }
    ];
  }

  if (node.kind === "assign") {
    return [
      { pin: "I", direction: "input", side: "left", x: 0, y: size.height / 2 },
      { pin: "Z", direction: "output", side: "right", x: size.width, y: size.height / 2 }
    ];
  }

  const inputPins = [];
  const outputPins = [];
  for (const pin of node.ref?.pins || []) {
    const direction = inferPinDirection(pin.pin).direction;
    const port = {
      pin: pin.pinDisplayName || pin.pin,
      direction,
      side: direction === "output" ? "right" : "left",
      x: direction === "output" ? size.width : 0,
      y: 0
    };
    if (direction === "output") {
      outputPins.push(port);
    } else {
      inputPins.push(port);
    }
  }

  placePorts(inputPins, size.height);
  placePorts(outputPins, size.height);
  return [...inputPins, ...outputPins];
}

function placePorts(ports, height) {
  if (ports.length === 0) {
    return;
  }

  const gap = height / (ports.length + 1);
  ports.forEach((port, index) => {
    port.y = gap * (index + 1);
  });
}

function getConnectionPoint(node, pin, role) {
  const preferredDirection = role === "source" ? "output" : "input";
  const port =
    node.ports?.find((candidate) => candidate.pin === pin && candidate.direction === preferredDirection) ||
    node.ports?.find((candidate) => candidate.direction === preferredDirection) ||
    node.ports?.[0];

  const x = node.x + (port?.x ?? (role === "source" ? node.width : 0));
  const y = node.y + (port?.y ?? node.height / 2);
  const bubbleOffset =
    role === "source" &&
    preferredDirection === "output" &&
    node.kind === "cell" &&
    isInvertingOutputGate(node.gateKind)
      ? 10
      : 0;

  return { x: x + bubbleOffset, y };
}

function getMaxPinCount(node) {
  if (node.kind === "assign") {
    return 1;
  }
  if (node.kind !== "cell") {
    return 1;
  }

  let inputs = 0;
  let outputs = 0;
  for (const pin of node.ref?.pins || []) {
    if (inferPinDirection(pin.pin).direction === "output") {
      outputs += 1;
    } else {
      inputs += 1;
    }
  }
  return Math.max(inputs, outputs, 1);
}

function computeBounds(nodes) {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }
  return { width, height };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
