const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
const PIN_PATTERN = new RegExp(
  `pin\\s*(?:<\\s*([^>\\s]+)\\s*>|([^,\\s]+))\\s*,\\s*at\\s+(${NUMBER_PATTERN})\\s*,\\s*rt\\s+(${NUMBER_PATTERN})\\s*,\\s*slack\\s+(${NUMBER_PATTERN})`,
  "gi"
);
const INSTANCE_PATTERN = /\[D\]\[LocResyn\]\s+inst\s*<([^>]+)>/gi;
const BADGE_POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);

export function parseTimingLog(text) {
  const source = String(text || "");
  const instances = {};
  const records = [];
  const matches = [...source.matchAll(INSTANCE_PATTERN)];

  for (const [index, match] of matches.entries()) {
    const fullPath = match[1].trim();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const instance = getLeafInstance(fullPath);
    const pins = parsePins(block);
    const summary = summarizePins(pins);

    const record = {
      instance,
      fullPath,
      pins,
      worstPin: summary.worstPin,
      worstSlack: summary.worstSlack
    };
    records.push(record);
    instances[instance] = record;
  }

  return {
    kind: "locresyn-timing",
    instanceCount: records.length,
    instances,
    records
  };
}

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing?.instances) {
    return graph;
  }
  const badgeChoices = options.badgeChoices || {};
  const badgePositions = options.badgePositions || {};
  const timingByNodeId = matchTimingRecords(graph.nodes, timing);

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "cell") {
        return node;
      }
      const instance = node.ref?.instance || node.label;
      const nodeTiming = timingByNodeId.get(node.id);
      return nodeTiming
        ? { ...node, timing: annotateTimingBadges(nodeTiming, badgeChoices[instance], badgePositions[instance], node) }
        : node;
    })
  };
}

function matchTimingRecords(nodes, timing) {
  const matches = new Map();
  const ambiguousNodeIds = new Set();
  const cells = nodes
    .filter((node) => node.kind === "cell")
    .map((node) => ({
      node,
      instance: String(node.ref?.instance || node.label || "").replace(/^\\/, "")
    }))
    .filter((item) => item.instance);
  const records = Array.isArray(timing.records)
    ? timing.records
    : Object.values(timing.instances || {});

  for (const record of records) {
    const fullPath = String(record.fullPath || record.instance || "").replace(/^\\/, "");
    const candidates = cells.filter(({ instance }) =>
      fullPath === instance || fullPath.endsWith(`/${instance}`)
    );
    if (candidates.length === 0) {
      continue;
    }
    const longestLength = Math.max(...candidates.map(({ instance }) => instance.length));
    const longest = candidates.filter(({ instance }) => instance.length === longestLength);
    if (longest.length !== 1) {
      continue;
    }
    const nodeId = longest[0].node.id;
    if (matches.has(nodeId)) {
      matches.delete(nodeId);
      ambiguousNodeIds.add(nodeId);
      continue;
    }
    if (!ambiguousNodeIds.has(nodeId)) {
      matches.set(nodeId, record);
    }
  }
  return matches;
}

function annotateTimingBadges(timing, choices, position, node) {
  const requestedChoices = choices === undefined
    ? getDefaultBadgeChoices(timing, node)
    : normalizeBadgeChoices(choices);
  const badges = requestedChoices
    .map((choice) => resolveBadgeChoice(timing, choice))
    .filter(Boolean);
  return {
    ...timing,
    badges,
    badge: badges[0] || null,
    badgePosition: BADGE_POSITIONS.has(position) ? position : "bottom-right"
  };
}

function getDefaultBadgeChoices(timing, node) {
  const outputPin = findOutputTimingPin(timing, node);
  if (outputPin) {
    return [
      { pin: outputPin, metric: "at" },
      { pin: outputPin, metric: "slack" }
    ];
  }
  return timing.worstPin ? [{ pin: timing.worstPin, metric: "slack" }] : [];
}

function findOutputTimingPin(timing, node) {
  for (const pin of node.ref?.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const direction = node.pinDirections?.[displayName]?.direction || node.pinDirections?.[pin.pin]?.direction;
    if (direction !== "output") {
      continue;
    }
    if (timing.pins?.[displayName]) {
      return displayName;
    }
    if (timing.pins?.[pin.pin]) {
      return pin.pin;
    }
  }
  return null;
}

function normalizeBadgeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices;
  }
  return choices ? [choices] : [];
}

function resolveBadgeChoice(timing, choice) {
  const pin = timing.pins?.[choice?.pin];
  const metric = choice?.metric;
  if (!pin || !["at", "rt", "slack"].includes(metric) || !Number.isFinite(pin[metric])) {
    return null;
  }
  return {
    pin: pin.pin,
    metric,
    value: pin[metric],
    label: `${pin.pin} ${metric} ${formatTimingValue(pin[metric])}`
  };
}

function parsePins(block) {
  const pins = {};
  PIN_PATTERN.lastIndex = 0;
  for (const match of block.matchAll(PIN_PATTERN)) {
    const pin = match[1] || match[2];
    pins[pin] = {
      pin,
      at: Number(match[3]),
      rt: Number(match[4]),
      slack: Number(match[5])
    };
  }
  return pins;
}

function summarizePins(pins) {
  let worstPin = null;
  let worstSlack = null;
  for (const pin of Object.values(pins)) {
    if (worstSlack === null || pin.slack < worstSlack) {
      worstPin = pin.pin;
      worstSlack = pin.slack;
    }
  }
  return { worstPin, worstSlack };
}

function getLeafInstance(fullPath) {
  const parts = String(fullPath).split("/");
  return parts[parts.length - 1] || fullPath;
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
