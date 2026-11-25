import {
  getNodeInstance,
  unescapeSlashes,
  normalizePinName,
  normalizeHierarchicalName,
  findLastUnescapedSlash
} from "./timing_names.js";
import { summarizePins } from "./timing_badges.js";
import { TIMING_SAMPLE_LIMIT } from "./timing_diagnostics.js";

export function buildCellIndex(nodes) {
  const items = [];
  const byInstance = new Map();
  const byNodeId = new Map();
  const instanceSet = new Set();
  let maxInstanceLength = 0;

  for (const node of nodes) {
    if (node.kind !== "cell") continue;
    const rawInstance = getNodeInstance(node);
    const instance = unescapeSlashes(normalizeHierarchicalName(rawInstance));
    if (!instance) continue;

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

    const item = { node, instance, pinSet };
    items.push(item);
    byNodeId.set(node.id, item);
    instanceSet.add(instance);
    maxInstanceLength = Math.max(maxInstanceLength, instance.length);
    if (!byInstance.has(instance)) {
      byInstance.set(instance, []);
    }
    byInstance.get(instance).push(item);
  }

  return { items, byInstance, byNodeId, instanceSet, maxInstanceLength };
}

export function buildPortIndex(nodes) {
  const byName = new Map();
  const rangedBusPorts = new Map();
  const addPortName = (rawName, node, targetMap = byName) => {
    const name = normalizeHierarchicalName(rawName);
    if (!name) return;
    if (!targetMap.has(name)) targetMap.set(name, []);
    const list = targetMap.get(name);
    if (!list.includes(node)) list.push(node);
  };
  for (const node of nodes) {
    if (node.kind !== "input" && node.kind !== "output") continue;
    for (const rawName of [node.ref?.name, node.ref?.displayName, node.label]) {
      if (rawName) addPortName(rawName, node, byName);
    }
    const range = node.ref?.range;
    if (
      range &&
      Number.isInteger(range.msb) &&
      Number.isInteger(range.lsb) &&
      node.ref?.name
    ) {
      if (range.msb === range.lsb && !String(node.ref.name).includes("[")) {
        addPortName(`${node.ref.name}[${range.msb}]`, node, byName);
      } else if (range.msb !== range.lsb && !node.ref?.parentName) {
        for (const rawName of [node.ref.name, node.ref.displayName, node.label]) {
          if (rawName) addPortName(rawName, node, rangedBusPorts);
        }
      }
    }
  }
  return { byName, rangedBusPorts };
}

export function buildNetSourceIndex(graph) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const assignLhsToRhs = new Map();
  const knownNets = new Map();
  const directDriversByNet = new Map();
  const ambiguousDrivers = new Map();
  function addDriver(net, driver) {
    if (!net) return;
    const previous = directDriversByNet.get(net);
    if (!previous) { directDriversByNet.set(net, driver); return; }
    if (previous.nodeId === driver.nodeId && previous.pin === driver.pin) return;
    if (!ambiguousDrivers.has(net)) ambiguousDrivers.set(net, new Set([previous.nodeId]));
    ambiguousDrivers.get(net).add(driver.nodeId);
  }


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
        addDriver(normNet, {
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
      addDriver(normNet, driverInfo);
      if (normLabel !== normNet) addDriver(normLabel, driverInfo);
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
    directDriversByNet, ambiguousDrivers, nodeById,
    resolveRootNet
  };
}

export function getPointCandidates(rawPoint, moduleMatcher, stripPrefixes = [], allowModulePattern = true, allowPortPrefix = true) {
  const normPoint = normalizeHierarchicalName(rawPoint);
  if (!normPoint) return [];
  const candidates = [];
  const candidateMap = new Map();
  const addCandidate = (value, occurrenceKey = "") => {
    if (!value) return;
    if (!candidateMap.has(value)) {
      const entry = { text: value, occurrenceKey };
      candidateMap.set(value, entry);
      candidates.push(entry);
    } else if (occurrenceKey && !candidateMap.get(value).occurrenceKey) {
      candidateMap.get(value).occurrenceKey = occurrenceKey;
    }
  };

  for (const { prefix, occurrenceKey } of stripPrefixes) {
    addCandidate(normPoint.slice(prefix.length + 1), occurrenceKey);
  }

  const normModule = moduleMatcher?.normModule || "";
  if (normModule) {
    if (allowModulePattern) {
      if (normPoint.startsWith(`${normModule}/`)) {
        addCandidate(normPoint.slice(normModule.length + 1), "");
      }
      const wrapperMatch = moduleMatcher.wrapperPattern ? normPoint.match(moduleMatcher.wrapperPattern) : null;
      if (wrapperMatch?.[1]) {
        addCandidate(wrapperMatch[1], "");
      }
    }
    if (allowPortPrefix) {
      const portMatch = moduleMatcher.portPrefixPattern ? normPoint.match(moduleMatcher.portPrefixPattern) : null;
      if (portMatch?.[1]) {
        addCandidate(portMatch[1], "");
      }
    }
  }

  addCandidate(normPoint, "");
  return candidates;
}

// Rejected rows have no verified owner. Look up the longest instance-name
// suffix only to show same-name evidence, never to bind a timing value.
export function cellsNamedInPoint(point, cellIndex) {
  const name = normalizeHierarchicalName(point);
  const split = findLastUnescapedSlash(name);
  if (split < 1) return [];
  const path = unescapeSlashes(name.slice(0, split)).trim();
  const earliest = path.length - cellIndex.maxInstanceLength;
  let start = earliest > 0 ? path.indexOf("/", earliest - 1) + 1 : 0;
  if (earliest > 0 && start === 0) return [];
  while (start < path.length) {
    const cells = cellIndex.byInstance.get(path.slice(start));
    if (cells) return cells;
    const next = path.indexOf("/", start);
    if (next < 0) break;
    start = next + 1;
  }
  return [];
}

export function tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex = null) {
  const rawNormPoint = normalizeHierarchicalName(record.point);
  const rawSlashIndex = findLastUnescapedSlash(rawNormPoint);
  const rawFullPath = rawSlashIndex > 0 ? rawNormPoint.slice(0, rawSlashIndex).trim() : null;

  for (const attempt of candidates) {
    const { text: candidate, occurrenceKey } = attempt;
    const slashIndex = findLastUnescapedSlash(candidate);
    if (slashIndex <= 0 || slashIndex === candidate.length - 1) continue;

    const instPath = candidate.slice(0, slashIndex).trim();
    const rawPin = candidate.slice(slashIndex + 1).trim();
    const pinName = normalizePinName(rawPin);
    if (!instPath || !pinName) continue;

    const matchedCells = findLongestSuffixCells(instPath, cellIndex, attempt);
    if (matchedCells.length === 0) continue;

    // If the unsplit candidate is an exact port name in the module, and the matched cell
    // explicitly defines pins that do NOT include pinName, let Port resolution win.
    const unescapedCandidate = unescapeSlashes(candidate);
    if (
      (portIndex?.byName?.has(candidate) || portIndex?.byName?.has(unescapedCandidate)) &&
      matchedCells.every((item) => item.pinSet.size > 0 && !item.pinSet.has(pinName))
    ) {
      continue;
    }

    addPinToGroup(cellPinGroups, instPath, rawFullPath || instPath, pinName, record);
    return { occurrenceKey: occurrenceKey || "" };
  }
  return null;
}

function findChildBoundaryAncestor(prefixPath, cellInstanceSet) {
  if (!cellInstanceSet.size || !prefixPath) return null;
  const segments = prefixPath.split("/");
  for (let start = 0; start < segments.length; start += 1) {
    let current = "";
    for (let end = start; end < segments.length; end += 1) {
      current = current ? `${current}/${segments[end]}` : segments[end];
      if (cellInstanceSet.has(current)) return current;
    }
  }
  return null;
}

function findLongestSuffixCells(instPath, cellIndex, attempt = null) {
  const normInstPath = normalizeHierarchicalName(instPath);
  if (!normInstPath) return [];
  const unescapedInstPath = unescapeSlashes(normInstPath);

  const exactRaw = cellIndex.byInstance.get(normInstPath);
  if (exactRaw && exactRaw.length > 0) return exactRaw;

  if (unescapedInstPath !== normInstPath) {
    const exactUnescaped = cellIndex.byInstance.get(unescapedInstPath);
    if (exactUnescaped && exactUnescaped.length > 0) return exactUnescaped;
  }

  let slashIndex = unescapedInstPath.indexOf("/");
  while (slashIndex >= 0) {
    const prefixBeforeInstance = unescapedInstPath.slice(0, slashIndex);
    const suffixInstance = unescapedInstPath.slice(slashIndex + 1);
    if (suffixInstance) {
      const matches = cellIndex.byInstance.get(suffixInstance);
      if (matches?.length) {
        const boundary = findChildBoundaryAncestor(prefixBeforeInstance, cellIndex.instanceSet);
        if (!boundary) return matches;
        if (attempt && !attempt.childBoundary) attempt.childBoundary = boundary;
      }
    }
    slashIndex = unescapedInstPath.indexOf("/", slashIndex + 1);
  }

  return [];
}

function isPreferredTimingRecord(incoming, existing, existingPoint = null) {
  const inHasSlack = Number.isFinite(incoming?.slack);
  const exHasSlack = Number.isFinite(existing?.slack);
  if (inHasSlack && exHasSlack) {
    if (incoming.slack !== existing.slack) {
      return incoming.slack < existing.slack;
    }
  } else if (inHasSlack !== exHasSlack) {
    return inHasSlack;
  }

  const inPoint = unescapeSlashes(normalizeHierarchicalName(incoming?.point));
  const exPoint = unescapeSlashes(normalizeHierarchicalName(existingPoint ?? existing?.point));
  if (inPoint !== exPoint) {
    return inPoint.localeCompare(exPoint) < 0;
  }
  const edgeOrder = String(incoming?.edge || "").localeCompare(String(existing?.edge || ""));
  if (edgeOrder) return edgeOrder < 0;
  for (const metric of ["at", "rt", "delay", "slew"]) {
    const left = incoming?.[metric] ?? Infinity, right = existing?.[metric] ?? Infinity;
    if (left !== right) return left < right;
  }
  return Boolean(existing?.slackDerived) && !incoming?.slackDerived;
}

function addPinToGroup(cellPinGroups, matchPath, fullPath, pinName, record) {
  const normMatchPath = unescapeSlashes(normalizeHierarchicalName(matchPath));
  const normFullPath = unescapeSlashes(normalizeHierarchicalName(fullPath || matchPath));
  // Occurrences are checked before publishing any groups. Within a single
  // occurrence, both module-local and rooted points use the same pin group.
  const groupKey = "pin:" + normMatchPath;
  if (!cellPinGroups.has(groupKey)) {
    cellPinGroups.set(groupKey, {
      matchPath: normMatchPath,
      recordCount: 0,
      firstRecord: record,
      fullPath: normFullPath || normMatchPath,
      pins: Object.create(null),
      pinPoints: Object.create(null)
    });
  }
  const group = cellPinGroups.get(groupKey);
  group.recordCount++;
  const existing = group.pins[pinName];
  if (existing && !isPreferredTimingRecord(record, existing, group.pinPoints[pinName])) return;
  group.pinPoints[pinName] = record.point || "";
  group.pins[pinName] = {
    pin: pinName,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    sourceKind: "pin",
    sourceNet: null
  };
}

function matchRangedBusPorts(baseName, bitIndex, rangedBusPorts) {
  if (!rangedBusPorts || !Number.isInteger(bitIndex)) return null;
  const list = rangedBusPorts.get(baseName);
  if (!list || list.length === 0) return null;
  const matching = list.filter((node) => {
    const range = node.ref?.range;
    if (!range) return false;
    const low = Math.min(range.msb, range.lsb);
    const high = Math.max(range.msb, range.lsb);
    return bitIndex >= low && bitIndex <= high;
  });
  return matching.length > 0 ? matching : null;
}

function resolveMatchingPortNodes(candidate, portIndex) {
  const { byName, rangedBusPorts } = portIndex;
  const portLookupCandidates = [candidate];
  if (/\\+\//.test(candidate)) {
    portLookupCandidates.push(unescapeSlashes(candidate));
  }

  for (const item of portLookupCandidates) {
    const direct = byName.get(item);
    if (direct && direct.length > 0) return direct;

    const bracketMatch = item.match(/^(.+)\[(-?\d+)\]$/);
    if (bracketMatch) {
      const ranged = matchRangedBusPorts(bracketMatch[1], Number(bracketMatch[2]), rangedBusPorts);
      if (ranged) return ranged;
    }

    const doubleMatch = item.match(/^(.+)__(\d+)$/);
    if (doubleMatch) {
      const [, base, index] = doubleMatch;
      const portCandidates = [`${base}[${index}]`, `${base}_[${index}]`];
      if (index === "0") portCandidates.push(base);
      for (const key of portCandidates) {
        const nodes = byName.get(key);
        if (nodes && nodes.length > 0) return nodes;
      }
      const ranged = matchRangedBusPorts(base, Number(index), rangedBusPorts);
      if (ranged) return ranged;
    }

    const singleMatch = item.match(/^(.+)_(\d+)$/);
    if (singleMatch) {
      const [, base, index] = singleMatch;
      const nodes = byName.get(`${base}[${index}]`);
      if (nodes && nodes.length > 0) return nodes;
      const ranged = matchRangedBusPorts(base, Number(index), rangedBusPorts);
      if (ranged) return ranged;
    }
  }

  return null;
}

export function tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId) {
  for (const { text: candidate, occurrenceKey } of candidates) {
    const portNodes = resolveMatchingPortNodes(candidate, portIndex);
    if (!portNodes || portNodes.length === 0) continue;
    for (const portNode of portNodes) {
      const existing = portTimingByNodeId.get(portNode.id);
      if (existing?.sourceKind === "port" && !isPreferredTimingRecord(record, existing)) continue;
      portTimingByNodeId.set(portNode.id, {
        ...record,
        sourceKind: "port",
        sourceNet: null
      });
    }
    return { occurrenceKey: occurrenceKey || "", targetKind: "port" };
  }
  return null;
}

export function tryAnnotateNet(record, candidates, netTopology, netTiming, cellPinGroups, portTimingByNodeId, diagnostics) {
  for (const { text: candidate, occurrenceKey } of candidates) {
    const lookupKey = netTopology.knownNets.has(candidate)
      ? candidate
      : (/\\+\//.test(candidate) && netTopology.knownNets.has(unescapeSlashes(candidate))
        ? unescapeSlashes(candidate)
        : null);
    if (!lookupKey) continue;
    const canonicalNet = netTopology.knownNets.get(lookupKey);
    const rootNormNet = netTopology.resolveRootNet(lookupKey);
    const rootCanonicalNet = netTopology.knownNets.get(rootNormNet) || canonicalNet;
    const conflicts = netTopology.ambiguousDrivers.get(rootNormNet) || netTopology.ambiguousDrivers.get(lookupKey);
    if (conflicts) {
      const affected = Array.from(conflicts).sort().slice(0, TIMING_SAMPLE_LIMIT)
        .map((id) => ({ node: netTopology.nodeById.get(id) }));
      diagnostics.unresolvedGroup("multiple-net-drivers",
        { firstRecord: record, recordCount: 1, fullPath: canonicalNet }, affected);
      return { occurrenceKey: occurrenceKey || "", targetKind: "net" };
    }
    const driver = netTopology.directDriversByNet.get(rootNormNet) || netTopology.directDriversByNet.get(lookupKey) || null;

    const netEntry = {
      net: canonicalNet,
      point: record.point,
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
    for (const key of [canonicalNet, lookupKey, rootCanonicalNet, rootNormNet]) {
      if (key && (!netTiming[key] || isPreferredTimingRecord(record, netTiming[key]))) netTiming[key] = netEntry;
    }

    if (driver) {
      if (driver.nodeKind === "input") {
        const existing = portTimingByNodeId.get(driver.nodeId);
        if (!existing || (existing.sourceKind !== "port" && isPreferredTimingRecord(record, existing))) {
          portTimingByNodeId.set(driver.nodeId, { ...record, sourceKind: "net", sourceNet: canonicalNet });
        }
      } else if (driver.nodeKind === "cell" && driver.pin) {
        const cellNodeId = driver.nodeId;
        addDriverCellPinTiming(cellPinGroups, cellNodeId, driver.pin, record, canonicalNet);
      }
    }
    return { occurrenceKey: occurrenceKey || "", targetKind: "net" };
  }
  return null;
}

function addDriverCellPinTiming(cellPinGroups, cellNodeId, rawPinName, record, sourceNet) {
  const pinName = normalizePinName(rawPinName);
  const key = `__node_id__:${cellNodeId}`;
  if (!cellPinGroups.has(key)) {
    cellPinGroups.set(key, {
      directNodeId: cellNodeId,
      firstRecord: record,
      recordCount: 0,
      fullPath: sourceNet,
      pins: Object.create(null),
      pinPoints: Object.create(null)
    });
  }
  const group = cellPinGroups.get(key);
  group.recordCount++;
  const existing = group.pins[pinName];
  if (existing?.sourceKind === "pin") return;
  if (existing && !isPreferredTimingRecord(record, existing, group.pinPoints[pinName])) {
    return;
  }
  group.pinPoints[pinName] = record.point || "";
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

export function resolveCellTimingMatches(cellPinGroups, cellIndex, unit, stage, diagnostics) {
  const groupsByNodeId = new Map();
  const directGroupsByNodeId = new Map();

  for (const group of cellPinGroups.values()) {
    if (group.directNodeId) {
      directGroupsByNodeId.set(group.directNodeId, group);
      continue;
    }
    const longest = findLongestSuffixCells(group.matchPath, cellIndex);
    if (longest.length !== 1) {
      diagnostics.unresolvedGroup("non-unique-cell-target", group, longest);
      if (longest.length > 1) {
        diagnostics.ambiguous(group.fullPath, longest.slice(0, TIMING_SAMPLE_LIMIT).map(({ node }) => node.id));
      }
      continue;
    }
    const matchedCell = longest[0];
    const nodeId = matchedCell.node.id;
    if (!groupsByNodeId.has(nodeId)) {
      groupsByNodeId.set(nodeId, []);
    }
    groupsByNodeId.get(nodeId).push({
      cell: matchedCell.node,
      instance: matchedCell.instance,
      group
    });
  }

  const matchedGroupByNodeId = new Map();
  const ambiguousNodeIds = new Set();

  for (const [nodeId, entries] of groupsByNodeId.entries()) {
    let selectedEntry = null;
    if (entries.length === 1) {
      selectedEntry = entries[0];
    } else {
      const exactEntries = entries.filter(
        ({ instance, group }) => group.matchPath === instance
      );
      if (exactEntries.length === 1) {
        selectedEntry = exactEntries[0];
        for (const entry of entries) {
          if (entry !== selectedEntry) diagnostics.unresolvedGroup("shadowed-by-exact-path", entry.group, [{ node: entry.cell }]);
        }
      } else {
        ambiguousNodeIds.add(nodeId);
        diagnostics.ambiguous(entries[0].instance, entries.slice(0, TIMING_SAMPLE_LIMIT).map(({ group }) => group.fullPath));
        for (const entry of entries) diagnostics.unresolvedGroup("ambiguous-cell-path", entry.group, [{ node: entry.cell }]);
        continue;
      }
    }
    matchedGroupByNodeId.set(nodeId, {
      cell: selectedEntry.cell,
      fullPath: selectedEntry.group.fullPath,
      pins: Object.assign(Object.create(null), selectedEntry.group.pins)
    });
  }

  for (const [nodeId, directGroup] of directGroupsByNodeId.entries()) {
    const cellEntry = cellIndex.byNodeId.get(nodeId);
    if (ambiguousNodeIds.has(nodeId)) {
      diagnostics.unresolvedGroup("ambiguous-cell-path", directGroup, cellEntry ? [cellEntry] : []);
      continue;
    }
    if (!cellEntry) continue;
    if (!matchedGroupByNodeId.has(nodeId)) {
      matchedGroupByNodeId.set(nodeId, {
        cell: cellEntry.node,
        fullPath: getNodeInstance(cellEntry.node),
        pins: Object.assign(Object.create(null), directGroup.pins)
      });
    } else {
      const existing = matchedGroupByNodeId.get(nodeId);
      for (const [pinName, pinData] of Object.entries(directGroup.pins)) {
        if (!Object.hasOwn(existing.pins, pinName)) {
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
      pins: { ...entry.pins },
      ...summary
    });
  }
  return result;
}
