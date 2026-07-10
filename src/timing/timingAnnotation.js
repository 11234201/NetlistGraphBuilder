export const TIMING_BADGE_POSITIONS = Object.freeze([
  "bottom-right",
  "top-right",
  "bottom-left",
  "top-left"
]);

export const TIMING_METRICS = Object.freeze(["at", "rt", "slack"]);

const BADGE_POSITION_SET = new Set(TIMING_BADGE_POSITIONS);
const TIMING_METRIC_SET = new Set(TIMING_METRICS);

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing?.instances) {
    return graph;
  }
  const badgeChoices = options.badgeChoices || {};
  const badgePositions = options.badgePositions || {};
  const timingByNodeId = matchTimingRecords(graph, timing);

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "cell") {
        return node;
      }
      const instance = getNodeInstance(node);
      const nodeTiming = timingByNodeId.get(node.id);
      return nodeTiming
        ? {
            ...node,
            timing: annotateTimingBadges(
              nodeTiming,
              badgeChoices[instance],
              badgePositions[instance],
              node
            )
          }
        : node;
    })
  };
}

export function normalizeBadgeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices;
  }
  return choices ? [choices] : [];
}

function matchTimingRecords(graph, timing) {
  const matches = new Map();
  const ambiguousNodeIds = new Set();
  const cells = graph.nodes
    .filter((node) => node.kind === "cell")
    .map((node) => ({
      node,
      instance: normalizeHierarchicalName(getNodeInstance(node))
    }))
    .filter((item) => item.instance);
  const allRecords = Array.isArray(timing.records)
    ? timing.records
    : Object.values(timing.instances || {});
  const records = selectModuleRecords(allRecords, graph.moduleName);

  for (const record of records) {
    const fullPath = normalizeHierarchicalName(record.fullPath || record.instance);
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

function selectModuleRecords(records, moduleName) {
  const normalizedModule = normalizeHierarchicalName(moduleName);
  if (!normalizedModule) {
    return records;
  }

  const modulePattern = new RegExp(
    `(?:^|of_module_)${escapeRegExp(normalizedModule)}(?:_ConeInst|_gen_\\d+)?/`
  );
  const moduleRecords = records.filter((record) =>
    modulePattern.test(normalizeHierarchicalName(record.fullPath || record.instance))
  );

  // Unknown log wrappers still fall back to the established instance-suffix matching.
  return moduleRecords.length > 0 ? moduleRecords : records;
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
    badgePosition: BADGE_POSITION_SET.has(position) ? position : "bottom-right"
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

function resolveBadgeChoice(timing, choice) {
  const pin = timing.pins?.[choice?.pin];
  const metric = choice?.metric;
  if (!pin || !TIMING_METRIC_SET.has(metric) || !Number.isFinite(pin[metric])) {
    return null;
  }
  return {
    pin: pin.pin,
    metric,
    value: pin[metric],
    label: `${pin.pin} ${metric} ${formatTimingValue(pin[metric])}`
  };
}

function getNodeInstance(node) {
  return node.ref?.instance || node.label || "";
}

function normalizeHierarchicalName(value) {
  return String(value || "").trim().replace(/^\\/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
