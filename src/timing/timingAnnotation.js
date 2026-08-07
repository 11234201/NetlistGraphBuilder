export const TIMING_BADGE_POSITIONS = Object.freeze([
  "bottom-right",
  "top-right",
  "bottom-left",
  "top-left"
]);

export const TIMING_METRICS = Object.freeze(["at", "rt", "slack"]);
export const TIMING_SNAPSHOTS = Object.freeze(["auto", "global", "local"]);
export const DEFAULT_TIMING_DISPLAY_POLICY = Object.freeze({
  snapshot: "auto",
  metrics: Object.freeze(["slack"])
});

const BADGE_POSITION_SET = new Set(TIMING_BADGE_POSITIONS);
const TIMING_METRIC_SET = new Set(TIMING_METRICS);
const TIMING_SNAPSHOT_SET = new Set(TIMING_SNAPSHOTS);

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing) {
    return graph;
  }
  if (Array.isArray(timing.scopes) && timing.format === "boundary-table") {
    return annotateDatasetTiming(graph, timing, options);
  }
  if (!timing.instances) return graph;
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

export function normalizeTimingDisplayPolicy(policy = DEFAULT_TIMING_DISPLAY_POLICY) {
  const snapshot = TIMING_SNAPSHOT_SET.has(policy?.snapshot)
    ? policy.snapshot
    : DEFAULT_TIMING_DISPLAY_POLICY.snapshot;
  const metrics = [...new Set((Array.isArray(policy?.metrics) ? policy.metrics : [policy?.metrics])
    .filter((metric) => TIMING_METRIC_SET.has(metric)))];
  return { snapshot, metrics: metrics.length ? metrics : [...DEFAULT_TIMING_DISPLAY_POLICY.metrics] };
}

export function resolveTimingSnapshot(scope, requested = "auto") {
  const policy = TIMING_SNAPSHOT_SET.has(requested) ? requested : "auto";
  if (policy !== "auto") return policy;
  const apply = String(scope?.apply ?? "").trim().toLowerCase();
  if (!apply || ["none", "no", "false", "0", "global"].includes(apply)) return "global";
  if (["yes", "true", "1", "apply", "applied", "local"].includes(apply)) return "local";
  return "global";
}

function annotateDatasetTiming(graph, timing, options) {
  const policy = normalizeTimingDisplayPolicy(options.displayPolicy);
  const scope = selectDatasetScope(timing.scopes, graph.moduleName);
  if (!scope) return graph;
  const snapshotName = resolveTimingSnapshot(scope, policy.snapshot);
  const snapshot = scope.snapshots?.[snapshotName] || [];
  const recordsByObject = new Map(snapshot.map((record) => [normalizeObjectName(record.objectName), record]));

  if (scope.scopeKind === "module" || scope.scopeKind === "unknown") {
    return {
      ...graph,
      timingScope: { subject: scope.subject, apply: scope.apply, snapshot: snapshotName, policy },
      nodes: graph.nodes.map((node) => {
        if (node.kind !== "input" && node.kind !== "output") return node;
        const names = [node.ref?.name, node.ref?.displayName, node.label].map(normalizeObjectName);
        const record = names.map((name) => recordsByObject.get(name)).find(Boolean);
        return record ? { ...node, timing: { ...record, snapshot: snapshotName } } : node;
      })
    };
  }

  const record = makeInstanceTimingRecord(scope, snapshot);
  const matches = matchTimingRecords(graph, { records: [record], instances: {} });
  return {
    ...graph,
    timingScope: { subject: scope.subject, apply: scope.apply, snapshot: snapshotName, policy },
    nodes: graph.nodes.map((node) => {
      if (node.kind !== "cell" || !matches.has(node.id)) return node;
      return { ...node, timing: annotateTimingBadgesWithPolicy(record, policy, node) };
    })
  };
}

function selectDatasetScope(scopes, moduleName) {
  const module = normalizeHierarchicalName(moduleName);
  const exact = scopes.filter((scope) => {
    const subject = normalizeHierarchicalName(scope.subject);
    return subject === module || subject.endsWith(`/${module}`);
  });
  if (exact.length === 1) return exact[0];
  return scopes.length === 1 ? scopes[0] : null;
}

function makeInstanceTimingRecord(scope, snapshot) {
  const pins = Object.fromEntries(snapshot.map((item) => [item.objectName, {
    pin: item.objectName,
    direction: item.direction,
    at: item.at,
    rt: item.rt,
    slack: item.slack
  }]));
  const worst = Object.values(pins).reduce((value, item) =>
    value === null || item.slack < value.slack ? item : value, null);
  return {
    instance: getLeafHierarchicalName(scope.subject),
    fullPath: scope.subject,
    pins,
    worstPin: worst?.pin || null,
    worstSlack: worst?.slack ?? null
  };
}

function annotateTimingBadgesWithPolicy(timing, policy, node) {
  const pinOrder = (node.ref?.pins || []).map((pin) => pin.pinDisplayName || pin.pin);
  const orderedPins = [...pinOrder, ...Object.keys(timing.pins || {}).filter((pin) => !pinOrder.includes(pin))];
  const choices = orderedPins.flatMap((pin) => policy.metrics.map((metric) => ({ pin, metric })));
  return annotateTimingBadges(timing, choices, "bottom-right", node);
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
  const choices = findInputTimingPins(timing, node).map((pin) => ({
    pin,
    metric: "at"
  }));
  const outputPin = findOutputTimingPin(timing, node);
  if (outputPin) {
    choices.push(
      { pin: outputPin, metric: "at" },
      { pin: outputPin, metric: "slack" }
    );
  }
  if (choices.length > 0) {
    return choices;
  }
  return timing.worstPin ? [{ pin: timing.worstPin, metric: "slack" }] : [];
}

function findInputTimingPins(timing, node) {
  const pins = [];
  for (const pin of node.ref?.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const direction = node.pinDirections?.[displayName]?.direction || node.pinDirections?.[pin.pin]?.direction;
    if (direction !== "input") {
      continue;
    }
    const timingPin = findTimingPin(timing, pin);
    if (timingPin) {
      pins.push(timingPin);
    }
  }
  return pins;
}

function findOutputTimingPin(timing, node) {
  for (const pin of node.ref?.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const direction = node.pinDirections?.[displayName]?.direction || node.pinDirections?.[pin.pin]?.direction;
    if (direction !== "output") {
      continue;
    }
    const timingPin = findTimingPin(timing, pin);
    if (timingPin) {
      return timingPin;
    }
  }
  return null;
}

function findTimingPin(timing, pin) {
  const displayName = pin.pinDisplayName || pin.pin;
  if (timing.pins?.[displayName]) {
    return displayName;
  }
  return timing.pins?.[pin.pin] ? pin.pin : null;
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

function normalizeObjectName(value) {
  return normalizeHierarchicalName(value).replace(/^.*[/.]/, "");
}

function getLeafHierarchicalName(value) {
  return normalizeHierarchicalName(value).split("/").pop() || "";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
