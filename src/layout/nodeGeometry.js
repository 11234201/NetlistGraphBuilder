import { inferPinDirection, isInvertingOutputGate } from "../infer/defaultCellRules.js";

export const DEFAULT_PIN_NODE_HEIGHT = 36;
export const DEFAULT_INPUT_NODE_HEIGHT = 28;
export const DEFAULT_CELL_PIN_PITCH = 36;

export function measureNode(node, cellPinPitch = DEFAULT_CELL_PIN_PITCH) {
  const labelLength = Math.max(
    getLeafDisplayName(node.label).length,
    String(node.subtitle || "").length,
    String(node.title || "").length
  );
  const naturalWidth = labelLength * 7 + 42;
  const width = node.kind === "hub"
    ? 20
    : node.kind === "cell"
      ? clamp(naturalWidth, 128, 220)
      : Math.max(92, naturalWidth);
  const pinCount = getMaxPinCount(node);
  const height =
    node.kind === "hub"
      ? 20
      : node.kind === "cell"
      ? Math.max(58, cellPinPitch * (pinCount + 1))
      : node.kind === "assign"
        ? 58
        : node.kind === "input" || node.kind === "implicit" || node.kind === "constant"
          ? DEFAULT_INPUT_NODE_HEIGHT
          : DEFAULT_PIN_NODE_HEIGHT;
  return { width, height };
}

export function getLeafDisplayName(value) {
  const text = String(value || "").trim();
  const separator = text.lastIndexOf("/");
  return separator >= 0 && separator < text.length - 1
    ? text.slice(separator + 1)
    : text;
}

export function buildNodePorts(node, size, cellPinPitch = DEFAULT_CELL_PIN_PITCH) {
  if (node.kind === "input" || node.kind === "implicit" || node.kind === "constant") {
    return [{
      pin: node.label,
      direction: "output",
      side: "right",
      x: size.width,
      y: size.height / 2
    }];
  }
  if (node.kind === "output") {
    return [{
      pin: node.label,
      direction: "input",
      side: "left",
      x: 0,
      y: size.height / 2
    }];
  }
  if (node.kind === "assign") {
    return [
      { pin: "I", direction: "input", side: "left", x: 0, y: size.height / 2 },
      { pin: "Z", direction: "output", side: "right", x: size.width, y: size.height / 2 }
    ];
  }

  const inputPins = [];
  const outputPins = [];
  const topPins = [];
  const bottomPins = [];
  for (const pin of node.ref?.pins || []) {
    const pinName = pin.pinDisplayName || pin.pin;
    const pinRule = getNodePinRule(node, pinName, pin.pin);
    const direction = pinRule.direction;
    const side = pinRule.side || (direction === "output" ? "right" : "left");
    const port = {
      pin: pinName,
      rawPin: pin.pin,
      direction,
      role: pinRule.role,
      side,
      x: side === "right" ? size.width : 0,
      y: 0
    };
    if (side === "top") topPins.push(port);
    else if (side === "bottom") bottomPins.push(port);
    else if (direction === "output") outputPins.push(port);
    else inputPins.push(port);
  }

  placePorts(inputPins, size.height, cellPinPitch);
  placePorts(outputPins, size.height, cellPinPitch);
  placeHorizontalPorts(topPins, size.width, 0);
  placeHorizontalPorts(bottomPins, size.width, size.height);
  return [...inputPins, ...topPins, ...bottomPins, ...outputPins];
}

export function getConnectionPoint(node, pin, role) {
  const port = getPort(node, pin, role);
  const x = node.x + (port?.x ?? (role === "source" ? node.width : 0));
  const y = node.y + (port?.y ?? node.height / 2);
  const bubbleOffset =
    role === "source" &&
    node.kind === "cell" &&
    isInvertingOutputGate(node.gateKind)
      ? 10
      : 0;
  return { x: x + bubbleOffset, y };
}

export function getPort(node, pin, role) {
  const preferredDirection = role === "source" ? "output" : "input";
  return (
    node.ports?.find((candidate) =>
      (candidate.pin === pin || candidate.rawPin === pin) && candidate.direction === preferredDirection) ||
    node.ports?.find((candidate) => candidate.direction === preferredDirection) ||
    node.ports?.[0]
  );
}

export function computeBounds(nodes) {
  let width = 0;
  let height = 0;
  for (const node of nodes) {
    width = Math.max(width, node.x + node.width);
    height = Math.max(height, node.y + node.height);
  }
  return { width, height };
}

function placePorts(ports, height, preferredPitch) {
  if (ports.length === 0) {
    return;
  }
  if (ports.length === 1) {
    ports[0].y = height / 2;
    return;
  }

  const pitch = Number(preferredPitch) || height / (ports.length + 1);
  const span = pitch * (ports.length - 1);
  if (span <= height - pitch) {
    const firstY = (height - span) / 2;
    ports.forEach((port, index) => {
      port.y = firstY + pitch * index;
    });
    return;
  }

  const gap = height / (ports.length + 1);
  ports.forEach((port, index) => {
    port.y = gap * (index + 1);
  });
}

function placeHorizontalPorts(ports, width, y) {
  if (ports.length === 0) return;
  const gap = width / (ports.length + 1);
  ports.forEach((port, index) => {
    port.x = gap * (index + 1);
    port.y = y;
  });
}

function getMaxPinCount(node) {
  if (node.kind === "assign" || node.kind !== "cell") {
    return 1;
  }

  let leftPins = 0;
  let rightPins = 0;
  for (const pin of node.ref?.pins || []) {
    const rule = getNodePinRule(node, pin.pinDisplayName || pin.pin, pin.pin);
    const side = rule.side || (rule.direction === "output" ? "right" : "left");
    if (side === "left") leftPins += 1;
    if (side === "right") rightPins += 1;
  }
  return Math.max(leftPins, rightPins, 1);
}

function getNodePinRule(node, displayName, rawName) {
  return node.pinDirections?.[displayName] ||
    node.pinDirections?.[rawName] ||
    inferPinDirection(rawName, node.ref?.type);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
