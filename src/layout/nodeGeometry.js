import { inferPinDirection, isInvertingOutputGate } from "../infer/defaultCellRules.js";

export const DEFAULT_PIN_NODE_HEIGHT = 36;
export const DEFAULT_CELL_PIN_PITCH = DEFAULT_PIN_NODE_HEIGHT;

export function measureNode(node, cellPinPitch = DEFAULT_CELL_PIN_PITCH) {
  const labelLength = Math.max(
    String(node.label || "").length,
    String(node.subtitle || "").length,
    String(node.title || "").length
  );
  const naturalWidth = labelLength * 7 + 42;
  const width = node.kind === "cell"
    ? clamp(naturalWidth, 128, 220)
    : Math.max(92, naturalWidth);
  const pinCount = getMaxPinCount(node);
  const height =
    node.kind === "cell"
      ? Math.max(58, cellPinPitch * (pinCount + 1))
      : node.kind === "assign"
        ? 58
        : DEFAULT_PIN_NODE_HEIGHT;
  return { width, height };
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
  for (const pin of node.ref?.pins || []) {
    const pinName = pin.pinDisplayName || pin.pin;
    const direction = getNodePinDirection(node, pinName, pin.pin);
    const port = {
      pin: pinName,
      direction,
      side: direction === "output" ? "right" : "left",
      x: direction === "output" ? size.width : 0,
      y: 0
    };
    (direction === "output" ? outputPins : inputPins).push(port);
  }

  placePorts(inputPins, size.height, cellPinPitch);
  placePorts(outputPins, size.height, cellPinPitch);
  return [...inputPins, ...outputPins];
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
    node.ports?.find((candidate) => candidate.pin === pin && candidate.direction === preferredDirection) ||
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

function getMaxPinCount(node) {
  if (node.kind === "assign" || node.kind !== "cell") {
    return 1;
  }

  let inputs = 0;
  let outputs = 0;
  for (const pin of node.ref?.pins || []) {
    if (getNodePinDirection(node, pin.pinDisplayName || pin.pin, pin.pin) === "output") {
      outputs += 1;
    } else {
      inputs += 1;
    }
  }
  return Math.max(inputs, outputs, 1);
}

function getNodePinDirection(node, displayName, rawName) {
  return (
    node.pinDirections?.[displayName]?.direction ||
    node.pinDirections?.[rawName]?.direction ||
    inferPinDirection(rawName).direction
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
