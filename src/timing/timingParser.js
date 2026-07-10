const NUMBER_PATTERN = "[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?";
const PIN_PATTERN = new RegExp(
  `pin\\s*(?:<\\s*([^>\\s]+)\\s*>|([^,\\s]+))\\s*,\\s*at\\s+(${NUMBER_PATTERN})\\s*,\\s*rt\\s+(${NUMBER_PATTERN})\\s*,\\s*slack\\s+(${NUMBER_PATTERN})`,
  "gi"
);
const INSTANCE_PATTERN = /\[D\]\[LocResyn\]\s+inst\s*<([^>]+)>/gi;

export function parseTimingLog(text) {
  const source = String(text || "");
  const instances = {};
  const matches = [...source.matchAll(INSTANCE_PATTERN)];

  for (const [index, match] of matches.entries()) {
    const fullPath = match[1].trim();
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const instance = getLeafInstance(fullPath);
    const pins = parsePins(block);
    const summary = summarizePins(pins);

    instances[instance] = {
      instance,
      fullPath,
      pins,
      worstPin: summary.worstPin,
      worstSlack: summary.worstSlack
    };
  }

  return {
    kind: "locresyn-timing",
    instanceCount: Object.keys(instances).length,
    instances
  };
}

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing?.instances) {
    return graph;
  }
  const badgeChoices = options.badgeChoices || {};

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "cell") {
        return node;
      }
      const instance = node.ref?.instance || node.label;
      const nodeTiming = timing.instances[instance];
      return nodeTiming ? { ...node, timing: annotateTimingBadges(nodeTiming, badgeChoices[instance], node) } : node;
    })
  };
}

function annotateTimingBadges(timing, choices, node) {
  const requestedChoices = choices === undefined
    ? getDefaultBadgeChoices(timing, node)
    : normalizeBadgeChoices(choices);
  const badges = requestedChoices
    .map((choice) => resolveBadgeChoice(timing, choice))
    .filter(Boolean);
  return {
    ...timing,
    badges,
    badge: badges[0] || null
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
