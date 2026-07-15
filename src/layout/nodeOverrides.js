export function applyNodePositionOverrides(nodes, nodePositions) {
  if (!nodePositions) return;
  for (const node of nodes) {
    const override = getOverride(nodePositions, node.id);
    if (!override) continue;
    const x = Number(override.x);
    const y = Number(override.y);
    if (Number.isFinite(x)) node.x = x;
    if (Number.isFinite(y)) node.y = y;
  }
}

export function applyNodeSizeOverride(size, nodeSizes, nodeId) {
  const override = getOverride(nodeSizes, nodeId);
  if (!override) return size;
  const width = Number(override.width);
  const height = Number(override.height);
  return {
    width: Number.isFinite(width) ? clamp(width, 24, 420) : size.width,
    height: Number.isFinite(height) ? clamp(height, 12, 260) : size.height
  };
}

export function normalizeNodeOverrides(value) {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) {
    return new Map(value.filter((item) => item?.id).map((item) => [item.id, item]));
  }
  return new Map(Object.entries(value || {}));
}

function getOverride(overrides, nodeId) {
  if (!overrides) return null;
  if (overrides instanceof Map) return overrides.get(nodeId);
  if (Array.isArray(overrides)) return overrides.find((item) => item?.id === nodeId);
  if (typeof overrides === "object") {
    return Object.hasOwn(overrides, nodeId) ? overrides[nodeId] : null;
  }
  return null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
