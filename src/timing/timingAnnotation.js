export const TIMING_BADGE_POSITIONS = Object.freeze([
  "bottom-right",
  "top-right",
  "bottom-left",
  "top-left"
]);

export const TIMING_METRICS = Object.freeze(["at", "rt", "slack", "delay", "slew"]);
export const DEFAULT_TIMING_DISPLAY_POLICY = Object.freeze({
  metrics: Object.freeze(["slack"])
});

const BADGE_POSITION_SET = new Set(TIMING_BADGE_POSITIONS);
const TIMING_METRIC_SET = new Set(TIMING_METRICS);

export function annotateGraphTiming(graph, timing, options = {}) {
  if (!timing || !graph || !Array.isArray(graph.nodes)) {
    return graph;
  }

  const policy = normalizeTimingDisplayPolicy(options.displayPolicy);
  const badgeChoices = options.badgeChoices || {};
  const badgePositions = options.badgePositions || {};
  const unit = timing.unit || "ns";
  const stage = timing.stage || "post_map";

  const scopedRecords = selectModuleRecords(timing, graph.moduleName);
  if (scopedRecords.length === 0) {
    return graph;
  }

  const cells = buildCellIndex(graph.nodes);
  const portsByNormName = buildPortIndex(graph.nodes);
  const netTopology = buildNetSourceIndex(graph);

  const cellPinGroups = new Map();
  const portTimingByNodeId = new Map();
  const netTiming = {};
  let matchedRecordCount = 0;
  let unmatchedRecordCount = 0;

  for (const record of scopedRecords) {
    const candidates = getPointCandidates(record.point, graph.moduleName);
    const explicitKind = record.kind || null;

    if (explicitKind === "pin") {
      if (tryCollectCellPin(record, candidates, cells, cellPinGroups)) {
        matchedRecordCount += 1;
      } else {
        unmatchedRecordCount += 1;
      }
      continue;
    }

    if (explicitKind === "port") {
      if (tryAnnotatePort(record, candidates, portsByNormName, portTimingByNodeId, false)) {
        matchedRecordCount += 1;
      } else {
        unmatchedRecordCount += 1;
      }
      continue;
    }

    if (explicitKind === "net") {
      if (tryAnnotateNet(record, candidates, netTopology, netTiming, cellPinGroups, portTimingByNodeId)) {
        matchedRecordCount += 1;
      } else {
        unmatchedRecordCount += 1;
      }
      continue;
    }

    // Default disambiguation when kind is omitted:
    // 1. Cell Pin (validated against existing cells in graph, unless exact port name takes precedence when pin doesn't exist)
    if (tryCollectCellPin(record, candidates, cells, cellPinGroups, portsByNormName)) {
      matchedRecordCount += 1;
      continue;
    }

    // 2. Boundary Port (supports escaped port names containing '/')
    if (tryAnnotatePort(record, candidates, portsByNormName, portTimingByNodeId, false)) {
      matchedRecordCount += 1;
      continue;
    }

    // 3. Internal Net (resolves upstream through assign aliases to Source driver)
    if (tryAnnotateNet(record, candidates, netTopology, netTiming, cellPinGroups, portTimingByNodeId)) {
      matchedRecordCount += 1;
      continue;
    }

    unmatchedRecordCount += 1;
  }

  const cellTimingByNodeId = resolveCellTimingMatches(cellPinGroups, cells, unit, stage);

  const annotatedNodes = graph.nodes.map((node) => {
    if (node.kind === "cell") {
      const nodeTiming = cellTimingByNodeId.get(node.id);
      if (!nodeTiming) return node;
      const instance = getNodeInstance(node);
      return {
        ...node,
        timing: annotateTimingBadges(
          nodeTiming,
          badgeChoices[instance],
          badgePositions[instance],
          node,
          policy
        )
      };
    }

    if (node.kind === "input" || node.kind === "output") {
      const portRecord = portTimingByNodeId.get(node.id);
      if (!portRecord) return node;
      const instance = getNodeInstance(node);
      const portTiming = createPortTimingObject(node, portRecord, unit, stage);
      return {
        ...node,
        timing: annotateTimingBadges(
          portTiming,
          badgeChoices[instance],
          badgePositions[instance],
          node,
          policy
        )
      };
    }

    return node;
  });

  return {
    ...graph,
    netTiming,
    timingSummary: {
      stage,
      unit,
      policy,
      matchedRecordCount,
      unmatchedRecordCount
    },
    nodes: annotatedNodes
  };
}

export function normalizeTimingDisplayPolicy(policy = DEFAULT_TIMING_DISPLAY_POLICY) {
  const metrics = [...new Set((Array.isArray(policy?.metrics) ? policy.metrics : [policy?.metrics])
    .filter((metric) => TIMING_METRIC_SET.has(metric)))];
  return { metrics: metrics.length ? metrics : [...DEFAULT_TIMING_DISPLAY_POLICY.metrics] };
}

export function normalizeBadgeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices;
  }
  return choices ? [choices] : [];
}

function selectModuleRecords(timing, moduleName) {
  const allRecords = Array.isArray(timing.records) ? timing.records : [];
  if (allRecords.length === 0) return [];

  const normModule = normalizeHierarchicalName(moduleName);
  const scopes = timing.scopes && typeof timing.scopes === "object" && !Array.isArray(timing.scopes)
    ? timing.scopes
    : null;

  if (scopes && normModule) {
    const matchedScopeKeys = Object.keys(scopes).filter((key) => {
      if (key === "__default__") return false;
      const normKey = normalizeHierarchicalName(key);
      return normKey === normModule ||
        normKey.endsWith(`/${normModule}`) ||
         matchesModuleWrapper(normKey, normModule);
    });

    if (matchedScopeKeys.length > 0) {
      const selected = [];
      if (Array.isArray(scopes.__default__)) {
        selected.push(...scopes.__default__);
      }
      for (const key of matchedScopeKeys) {
        selected.push(...scopes[key]);
      }
      return selected;
    }

    const namedScopeKeys = Object.keys(scopes).filter((key) => key !== "__default__");
    if (namedScopeKeys.length > 0 && Array.isArray(scopes.__default__)) {
      return filterRecordsByModulePath(scopes.__default__, normModule);
    }
    if (namedScopeKeys.length > 1) {
      return [];
    }
  }

  return filterRecordsByModulePath(allRecords, normModule);
}

function filterRecordsByModulePath(records, normModule) {
  if (!normModule) return records;
  const modulePattern = new RegExp(
    `(?:^|/|of_module_)${escapeRegExp(normModule)}(?:_ConeInst|_gen_\\d+)?/`,
    "i"
  );
  const matching = records.filter((record) =>
    modulePattern.test(normalizeHierarchicalName(record.point))
  );
  return matching.length > 0 ? matching : records;
}

function matchesModuleWrapper(scopeName, normModule) {
  const pattern = new RegExp(
    `(?:^|/|of_module_)${escapeRegExp(normModule)}(?:_ConeInst|_gen_\\d+)?$`,
    "i"
  );
  return pattern.test(scopeName);
}

function buildCellIndex(nodes) {
  return nodes
    .filter((node) => node.kind === "cell")
    .map((node) => {
      const rawInstance = getNodeInstance(node);
      const instance = normalizeHierarchicalName(rawInstance);
      const pinSet = new Set();
      for (const pin of node.ref?.pins || []) {
        if (pin.pin) pinSet.add(normalizePinName(pin.pin));
        if (pin.pinDisplayName) pinSet.add(normalizePinName(pin.pinDisplayName));
      }
      for (const port of node.ports || []) {
        if (port.pin) pinSet.add(normalizePinName(port.pin));
      }
      for (const key of Object.keys(node.pinDirections || {})) {
        pinSet.add(normalizePinName(key));
      }
      return { node, instance, pinSet };
    })
    .filter((item) => item.instance);
}

function buildPortIndex(nodes) {
  const map = new Map();
  for (const node of nodes) {
    if (node.kind !== "input" && node.kind !== "output") continue;
    const names = [node.ref?.name, node.ref?.displayName, node.label]
      .filter(Boolean)
      .map(normalizeHierarchicalName);
    for (const name of names) {
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      const list = map.get(name);
      if (!list.includes(node)) list.push(node);
    }
  }
  return map;
}

function buildNetSourceIndex(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const assignLhsToRhs = new Map();
  const knownNets = new Map();
  const directDriversByNet = new Map();

  for (const node of graph.nodes) {
    if (node.kind === "assign" && node.ref?.lhs && node.ref?.rhs) {
      const lhsNorm = normalizeHierarchicalName(node.ref.lhs);
      const rhsNorm = normalizeHierarchicalName(node.ref.rhs);
      if (lhsNorm && rhsNorm) {
        assignLhsToRhs.set(lhsNorm, rhsNorm);
        knownNets.set(lhsNorm, node.ref.lhs);
        knownNets.set(rhsNorm, node.ref.rhs);
      }
    }
    if (node.kind === "input") {
      const netName = node.ref?.name || node.label;
      const normNet = normalizeHierarchicalName(netName);
      if (normNet) {
        knownNets.set(normNet, netName);
        directDriversByNet.set(normNet, {
          nodeId: node.id,
          nodeKind: "input",
          pin: node.ref?.displayName || node.label
        });
      }
    }
  }

  for (const edge of graph.edges || []) {
    if (!edge.net) continue;
    const normNet = normalizeHierarchicalName(edge.net);
    const normLabel = edge.label ? normalizeHierarchicalName(edge.label) : null;
    if (normNet) knownNets.set(normNet, edge.net);
    if (normLabel) knownNets.set(normLabel, edge.net);

    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode || sourceNode.kind === "assign") continue;
    if (sourceNode.kind === "cell" || sourceNode.kind === "input") {
      const driverInfo = {
        nodeId: sourceNode.id,
        nodeKind: sourceNode.kind,
        pin: edge.sourcePin || sourceNode.label
      };
      if (normNet && !directDriversByNet.has(normNet)) {
        directDriversByNet.set(normNet, driverInfo);
      }
      if (normLabel && !directDriversByNet.has(normLabel)) {
        directDriversByNet.set(normLabel, driverInfo);
      }
    }
  }

  function resolveRootNet(normNet) {
    let current = normNet;
    const visited = new Set();
    while (assignLhsToRhs.has(current) && !visited.has(current)) {
      visited.add(current);
      current = assignLhsToRhs.get(current);
    }
    return current;
  }

  return {
    knownNets,
    directDriversByNet,
    resolveRootNet
  };
}

function getPointCandidates(rawPoint, moduleName) {
  const normPoint = normalizeHierarchicalName(rawPoint);
  if (!normPoint) return [];
  const candidates = [normPoint];
  const normModule = normalizeHierarchicalName(moduleName);
  if (normModule) {
    if (normPoint.startsWith(`${normModule}/`)) {
      candidates.push(normPoint.slice(normModule.length + 1));
    }
    const wrapperPattern = new RegExp(
      `^(?:.*?/)?(?:LoResynHinst_of_module_)?${escapeRegExp(normModule)}(?:_ConeInst|_gen_\\d+)?/(.+)$`,
      "i"
    );
    const match = normPoint.match(wrapperPattern);
    if (match?.[1] && !candidates.includes(match[1])) {
      candidates.push(match[1]);
    }
  }
  return candidates;
}

function tryCollectCellPin(record, candidates, cells, cellPinGroups, portsByNormName = null) {
  for (const candidate of candidates) {
    const slashIndex = candidate.lastIndexOf("/");
    if (slashIndex <= 0 || slashIndex === candidate.length - 1) continue;

    const instPath = candidate.slice(0, slashIndex).trim();
    const rawPin = candidate.slice(slashIndex + 1).trim();
    const pinName = normalizePinName(rawPin);
    if (!instPath || !pinName) continue;

    const matchedCells = findLongestSuffixCells(instPath, cells);
    if (matchedCells.length === 0) continue;

    // If the unsplit candidate is an exact port name in the module, and the matched cell
    // explicitly defines pins that do NOT include pinName, let Port resolution win.
    if (
      portsByNormName?.has(candidate) &&
      matchedCells.every((item) => item.pinSet.size > 0 && !item.pinSet.has(pinName))
    ) {
      continue;
    }

    addPinToGroup(cellPinGroups, instPath, pinName, record, "pin", null);
    return true;
  }
  return false;
}

function findLongestSuffixCells(instPath, cells) {
  const normInstPath = normalizeHierarchicalName(instPath);
  const candidates = cells.filter(({ instance }) =>
    normInstPath === instance || normInstPath.endsWith(`/${instance}`)
  );
  if (candidates.length === 0) return [];
  const longestLength = Math.max(...candidates.map(({ instance }) => instance.length));
  return candidates.filter(({ instance }) => instance.length === longestLength);
}

function addPinToGroup(cellPinGroups, instPath, pinName, record, sourceKind = "pin", sourceNet = null) {
  const groupKey = normalizeHierarchicalName(instPath);
  if (!cellPinGroups.has(groupKey)) {
    cellPinGroups.set(groupKey, {
      fullPath: instPath,
      pins: {}
    });
  }
  const group = cellPinGroups.get(groupKey);
  const existing = group.pins[pinName];
  // Explicit pin timing takes precedence over net-derived timing
  if (existing && existing.sourceKind === "pin" && sourceKind === "net") {
    return;
  }
  group.pins[pinName] = {
    pin: pinName,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    sourceKind,
    sourceNet
  };
}

function tryAnnotatePort(record, candidates, portsByNormName, portTimingByNodeId, fromNet = false, sourceNet = null) {
  for (const candidate of candidates) {
    const portNodes = portsByNormName.get(candidate);
    if (!portNodes || portNodes.length === 0) continue;
    for (const portNode of portNodes) {
      const existing = portTimingByNodeId.get(portNode.id);
      if (existing && existing.sourceKind === "port" && fromNet) continue;
      portTimingByNodeId.set(portNode.id, {
        ...record,
        sourceKind: fromNet ? "net" : "port",
        sourceNet: sourceNet || null
      });
    }
    return true;
  }
  return false;
}

function tryAnnotateNet(record, candidates, netTopology, netTiming, cellPinGroups, portTimingByNodeId) {
  for (const candidate of candidates) {
    if (!netTopology.knownNets.has(candidate)) continue;
    const canonicalNet = netTopology.knownNets.get(candidate);
    const rootNormNet = netTopology.resolveRootNet(candidate);
    const rootCanonicalNet = netTopology.knownNets.get(rootNormNet) || canonicalNet;
    const driver = netTopology.directDriversByNet.get(rootNormNet) || netTopology.directDriversByNet.get(candidate) || null;

    const netEntry = {
      net: canonicalNet,
      rootNet: rootCanonicalNet,
      at: record.at,
      rt: record.rt,
      slack: record.slack,
      slackDerived: Boolean(record.slackDerived),
      delay: record.delay ?? null,
      slew: record.slew ?? null,
      edge: record.edge ?? null,
      driverNodeId: driver?.nodeId || null,
      driverPin: driver?.pin || null
    };
    netTiming[canonicalNet] = netEntry;
    netTiming[candidate] = netEntry;
    if (rootCanonicalNet) netTiming[rootCanonicalNet] = netEntry;
    if (rootNormNet) netTiming[rootNormNet] = netEntry;

    if (driver) {
      if (driver.nodeKind === "input") {
        const existing = portTimingByNodeId.get(driver.nodeId);
        if (!existing || existing.sourceKind !== "port") {
          portTimingByNodeId.set(driver.nodeId, {
            ...record,
            sourceKind: "net",
            sourceNet: canonicalNet
          });
        }
      } else if (driver.nodeKind === "cell" && driver.pin) {
        const cellNodeId = driver.nodeId;
        addDriverCellPinTiming(cellPinGroups, cellNodeId, driver.pin, record, canonicalNet);
      }
    }
    return true;
  }
  return false;
}

function addDriverCellPinTiming(cellPinGroups, cellNodeId, pinName, record, sourceNet) {
  const key = `__node_id__:${cellNodeId}`;
  if (!cellPinGroups.has(key)) {
    cellPinGroups.set(key, {
      directNodeId: cellNodeId,
      fullPath: sourceNet,
      pins: {}
    });
  }
  const group = cellPinGroups.get(key);
  if (group.pins[pinName]?.sourceKind === "pin") return;
  group.pins[pinName] = {
    pin: pinName,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    sourceKind: "net",
    sourceNet
  };
}

function resolveCellTimingMatches(cellPinGroups, cells, unit, stage) {
  const matchedGroupByNodeId = new Map();
  const ambiguousNodeIds = new Set();
  const directGroupsByNodeId = new Map();

  for (const group of cellPinGroups.values()) {
    if (group.directNodeId) {
      directGroupsByNodeId.set(group.directNodeId, group);
      continue;
    }
    const longest = findLongestSuffixCells(group.fullPath, cells);
    if (longest.length !== 1) {
      continue;
    }
    const nodeId = longest[0].node.id;
    if (matchedGroupByNodeId.has(nodeId)) {
      matchedGroupByNodeId.delete(nodeId);
      ambiguousNodeIds.add(nodeId);
      continue;
    }
    if (!ambiguousNodeIds.has(nodeId)) {
      matchedGroupByNodeId.set(nodeId, {
        cell: longest[0].node,
        fullPath: group.fullPath,
        pins: { ...group.pins }
      });
    }
  }

  for (const [nodeId, directGroup] of directGroupsByNodeId.entries()) {
    if (ambiguousNodeIds.has(nodeId)) continue;
    const cellEntry = cells.find((item) => item.node.id === nodeId);
    if (!cellEntry) continue;
    if (!matchedGroupByNodeId.has(nodeId)) {
      matchedGroupByNodeId.set(nodeId, {
        cell: cellEntry.node,
        fullPath: getNodeInstance(cellEntry.node),
        pins: { ...directGroup.pins }
      });
    } else {
      const existing = matchedGroupByNodeId.get(nodeId);
      for (const [pinName, pinData] of Object.entries(directGroup.pins)) {
        if (!existing.pins[pinName]) {
          existing.pins[pinName] = pinData;
        }
      }
    }
  }

  const result = new Map();
  for (const [nodeId, entry] of matchedGroupByNodeId.entries()) {
    const summary = summarizePins(entry.pins);
    result.set(nodeId, {
      instance: getNodeInstance(entry.cell),
      fullPath: entry.fullPath,
      unit,
      stage,
      pins: entry.pins,
      ...summary
    });
  }
  return result;
}

function createPortTimingObject(node, record, unit, stage) {
  const pinName = getLeafDisplayNameOrPort(node);
  const pinEntry = {
    pin: pinName,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    sourceKind: record.sourceKind || "port",
    sourceNet: record.sourceNet || null
  };
  const metrics = {};
  for (const metric of TIMING_METRICS) {
    if (Number.isFinite(record[metric])) {
      metrics[metric] = record[metric];
    }
  }
  return {
    instance: getNodeInstance(node),
    fullPath: record.point || pinName,
    unit,
    stage,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    metrics,
    pins: {
      [pinName]: pinEntry
    },
    worstPin: Number.isFinite(record.slack) ? pinName : null,
    worstSlack: Number.isFinite(record.slack) ? record.slack : null,
    sourceKind: record.sourceKind || "port",
    sourceNet: record.sourceNet || null
  };
}

function summarizePins(pins) {
  let worstPin = null;
  let worstSlack = null;
  for (const pin of Object.values(pins)) {
    if (!Number.isFinite(pin.slack)) continue;
    if (worstSlack === null || pin.slack < worstSlack) {
      worstPin = pin.pin;
      worstSlack = pin.slack;
    }
  }
  return { worstPin, worstSlack };
}

function annotateTimingBadges(timing, choices, position, node, policy) {
  const requestedChoices = choices === undefined
    ? getDefaultBadgeChoices(timing, node, policy)
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

function getDefaultBadgeChoices(timing, node, policy) {
  const policyMetrics = policy?.metrics || DEFAULT_TIMING_DISPLAY_POLICY.metrics;
  const isCustomPolicy =
    policyMetrics.length !== 1 || policyMetrics[0] !== "slack";

  if (node?.kind === "input" || node?.kind === "output") {
    const pinNames = Object.keys(timing.pins || {});
    const choices = [];
    for (const pin of pinNames) {
      for (const metric of policyMetrics) {
        choices.push({ pin, metric });
      }
      for (const extra of ["delay", "slew"]) {
        if (Number.isFinite(timing.pins[pin]?.[extra]) && !policyMetrics.includes(extra)) {
          choices.push({ pin, metric: extra });
        }
      }
    }
    return choices;
  }

  if (isCustomPolicy) {
    const orderedPins = getOrderedTimingPins(timing, node);
    return orderedPins.flatMap((pin) =>
      policyMetrics.map((metric) => ({ pin, metric }))
    );
  }

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
  if (timing.worstPin) {
    return [{ pin: timing.worstPin, metric: "slack" }];
  }
  const firstPin = Object.keys(timing.pins || {})[0];
  if (firstPin) {
    const firstMetric = TIMING_METRICS.find((m) => Number.isFinite(timing.pins[firstPin]?.[m])) || "slack";
    return [{ pin: firstPin, metric: firstMetric }];
  }
  return [];
}

function getOrderedTimingPins(timing, node) {
  const pinOrder = (node?.ref?.pins || []).map((pin) => pin.pinDisplayName || pin.pin);
  const timingPins = Object.keys(timing.pins || {});
  return [
    ...pinOrder.filter((pin) => timing.pins?.[pin]),
    ...timingPins.filter((pin) => !pinOrder.includes(pin))
  ];
}

function findInputTimingPins(timing, node) {
  const pins = [];
  for (const pin of node?.ref?.pins || []) {
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
  for (const pin of node?.ref?.pins || []) {
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
  return node?.ref?.instance || node?.ref?.name || node?.label || "";
}

function getLeafDisplayNameOrPort(node) {
  const raw = node?.ref?.displayName || node?.ref?.name || node?.label || "";
  return String(raw).trim();
}

function normalizePinName(value) {
  return String(value || "").trim().replace(/^\\/, "");
}

function normalizeHierarchicalName(value) {
  return String(value || "")
    .trim()
    .replace(/\\(\S+)\s+\//g, "$1/")
    .replace(/^\\/, "")
    .replace(/\/\\/g, "/")
    .replace(/\s+\[/g, "[")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
