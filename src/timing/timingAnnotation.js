export const TIMING_BADGE_POSITIONS = Object.freeze([
  "bottom-right",
  "top-right",
  "bottom-left",
  "top-left"
]);

export const TIMING_METRICS = Object.freeze(["at", "rt", "slack", "delay", "slew"]);
export const DEFAULT_TIMING_DISPLAY_POLICY = Object.freeze({
  metrics: Object.freeze(["slack"]),
  threshold: 0.0
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

  const targetModuleName = graph.timingModuleName || graph.moduleName;
  const occurrencePrefixes = resolveModuleOccurrencePrefixes(
    targetModuleName,
    options.moduleLibrary,
    options.occurrencePath
  );
  const scopedRecords = selectModuleRecords(timing, targetModuleName, occurrencePrefixes);
  if (scopedRecords.length === 0) {
    return graph;
  }

  const cells = buildCellIndex(graph.nodes);
  const cellInstanceSet = new Set(cells.map((item) => item.instance));
  const portsByNormName = buildPortIndex(graph.nodes);
  const netTopology = buildNetSourceIndex(graph);

  const cellPinGroups = new Map();
  const portTimingByNodeId = new Map();
  const netTiming = {};
  let matchedRecordCount = 0;
  let unmatchedRecordCount = 0;

  for (const record of scopedRecords) {
    const candidates = getPointCandidates(record.point, targetModuleName, occurrencePrefixes);
    const explicitKind = record.kind || null;

    if (explicitKind === "pin") {
      if (
        tryCollectCellPin(record, candidates, cells, cellPinGroups, portsByNormName, cellInstanceSet) ||
        tryAnnotatePort(record, candidates, portsByNormName, portTimingByNodeId, false)
      ) {
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
    if (tryCollectCellPin(record, candidates, cells, cellPinGroups, portsByNormName, cellInstanceSet)) {
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

  const cellTimingByNodeId = resolveCellTimingMatches(cellPinGroups, cells, unit, stage, cellInstanceSet);

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
  const rawMetrics = Array.isArray(policy?.metrics)
    ? policy.metrics
    : (policy?.metrics ? [policy.metrics] : []);
  const rawThreshold = policy?.threshold !== undefined ? Number(policy.threshold) : DEFAULT_TIMING_DISPLAY_POLICY.threshold;
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : 0.0;
  if (Array.isArray(policy?.metrics) && policy.metrics.length === 0) {
    return { metrics: Object.freeze([]), threshold };
  }
  if (rawMetrics.includes("none")) {
    return { metrics: Object.freeze([]), threshold };
  }
  const metrics = [...new Set(rawMetrics.filter((metric) => TIMING_METRIC_SET.has(metric)))];
  return {
    metrics: metrics.length ? metrics : [...DEFAULT_TIMING_DISPLAY_POLICY.metrics],
    threshold
  };
}

export function normalizeBadgeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices;
  }
  return choices ? [choices] : [];
}

function selectModuleRecords(timing, moduleName, occurrencePrefixes = []) {
  const allRecords = Array.isArray(timing.records) ? timing.records : [];
  if (allRecords.length === 0) return [];

  const normModule = normalizeHierarchicalName(moduleName);
  const scopes = timing.scopes && typeof timing.scopes === "object" && !Array.isArray(timing.scopes)
    ? timing.scopes
    : null;

  if (scopes && normModule) {
    const namedScopeKeys = Object.keys(scopes).filter((key) => key !== "__default__");
    const exactScopeKeys = namedScopeKeys.filter((key) => {
      const normKey = normalizeHierarchicalName(key);
      return normKey === normModule || normKey.endsWith(`/${normModule}`);
    });
    const matchedScopeKeys = exactScopeKeys.length > 0
      ? exactScopeKeys
      : namedScopeKeys.filter((key) => matchesModuleWrapper(normalizeHierarchicalName(key), normModule));

    if (matchedScopeKeys.length > 0) {
      const selected = [];
      if (Array.isArray(scopes.__default__)) {
        selected.push(...filterRecordsByModulePath(scopes.__default__, normModule, occurrencePrefixes));
      }
      for (const key of matchedScopeKeys) {
        selected.push(...scopes[key]);
      }
      return selected;
    }
  }

  return filterRecordsByModulePath(allRecords, normModule, occurrencePrefixes);
}

function filterRecordsByModulePath(records, normModule, occurrencePrefixes = []) {
  if (!normModule) return records;
  const alt = createModuleSegmentAlternation(normModule);
  const modulePathPattern = new RegExp(
    `(?:^|/)(?:LoResynHinst_of_module_|of_module_|Hinst)?${alt}(?:_loc|_ConeInst|_gen_\\d+)*/`,
    "i"
  );
  const modulePortPrefixPattern = new RegExp(
    `^(?:.*?/)?(?:LoResynHinst_of_module_|of_module_|Hinst)?${alt}(?:_loc|_ConeInst|_gen_\\d+)*__(.+)$`,
    "i"
  );
  return records.filter((record) => {
    const normPoint = normalizeHierarchicalName(record.point);
    if (modulePathPattern.test(normPoint) || modulePortPrefixPattern.test(normPoint)) {
      return true;
    }
    return occurrencePrefixes.some((prefix) =>
      normPoint.startsWith(`${prefix}/`) || normPoint.includes(`/${prefix}/`)
    );
  });
}

function getModuleStem(normModule) {
  return String(normModule || "")
    .replace(/^(?:LoResynHinst_of_module_|of_module_|Hinst)/i, "")
    .replace(/(?:_loc|_ConeInst|_gen_\d+)+$/i, "");
}

function createModuleSegmentAlternation(normModule) {
  const stem = getModuleStem(normModule);
  const parts = [normModule];
  if (stem && stem !== normModule) {
    parts.push(stem);
  }
  return `(?:${parts.map(escapeRegExp).join("|")})`;
}

function matchesModuleWrapper(scopeName, normModule) {
  if (!normModule) return false;
  const alt = createModuleSegmentAlternation(normModule);
  const pattern = new RegExp(
    `(?:^|/)(?:LoResynHinst_of_module_|of_module_|Hinst)?${alt}(?:_loc|_ConeInst|_gen_\\d+)*$`,
    "i"
  );
  return pattern.test(scopeName);
}

function resolveModuleOccurrencePrefixes(targetModuleName, moduleLibrary, occurrencePath) {
  const prefixes = [];
  const seen = new Set();
  const addPrefix = (value) => {
    const norm = normalizeHierarchicalName(value);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    prefixes.push(norm);
  };

  if (Array.isArray(occurrencePath) && occurrencePath.length > 0) {
    const cleanSegments = occurrencePath
      .map((segment) => {
        const text = String(segment || "").trim();
        const colonIndex = text.lastIndexOf(":");
        return normalizeHierarchicalName(colonIndex > 0 ? text.slice(0, colonIndex) : text);
      })
      .filter(Boolean);
    for (let start = 0; start < cleanSegments.length; start += 1) {
      addPrefix(cleanSegments.slice(start).join("/"));
    }
    return prefixes;
  }

  const normTarget = normalizeHierarchicalName(targetModuleName);
  if (!normTarget || !Array.isArray(moduleLibrary) || moduleLibrary.length === 0) {
    return prefixes;
  }

  const { startModules, resolveChild } = indexModuleHierarchy(moduleLibrary);
  const targetStem = getModuleStem(normTarget);
  const exactMatches = [];
  const stemMatches = [];
  const MAX_DEPTH = 16;
  const MAX_VISITS = 4000;
  let visits = 0;

  const matchesName = (candidateName, exact) => {
    const normCandidate = normalizeHierarchicalName(candidateName);
    if (!normCandidate) return false;
    return exact ? normCandidate === normTarget : Boolean(targetStem && getModuleStem(normCandidate) === targetStem);
  };
  const matchesTarget = (typeName, childMod, exact) =>
    matchesName(typeName, exact) || (childMod ? matchesName(childMod.originalName || childMod.name, exact) : false);

  const visit = (mod, pathSegments, ancestry) => {
    if (!mod || visits >= MAX_VISITS || pathSegments.length >= MAX_DEPTH) return;
    visits += 1;
    for (const cell of mod.cells || []) {
      const inst = normalizeHierarchicalName(cell.instance || cell.instanceDisplayName);
      if (!inst) continue;
      const nextPath = [...pathSegments, inst];
      const childMod = resolveChild(cell.type, mod);
      if (matchesTarget(cell.type, childMod, true)) {
        exactMatches.push(nextPath);
      } else if (matchesTarget(cell.type, childMod, false)) {
        stemMatches.push(nextPath);
      }
      if (childMod && !ancestry.has(childMod.name)) {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(childMod.name);
        visit(childMod, nextPath, nextAncestry);
      }
    }
  };

  for (const root of startModules) {
    visit(root, [], new Set([root.name]));
  }

  const chosen = exactMatches.length > 0 ? exactMatches : stemMatches;
  const collected = new Set();
  for (const segments of chosen) {
    for (let start = 0; start < segments.length; start += 1) {
      const joined = segments.slice(start).join("/");
      if (joined) collected.add(joined);
    }
  }
  for (const prefix of [...collected].sort((left, right) => right.length - left.length || left.localeCompare(right))) {
    addPrefix(prefix);
  }
  return prefixes;
}

function indexModuleHierarchy(moduleLibrary) {
  const moduleByName = new Map();
  const sameSourceMap = new Map();
  const stemModules = new Map();
  for (const mod of moduleLibrary) {
    if (!mod?.name) continue;
    moduleByName.set(mod.name, mod);
    if (mod.originalName && !moduleByName.has(mod.originalName)) {
      moduleByName.set(mod.originalName, mod);
    }
    if (mod.sourceFile) {
      const rawName = mod.originalName || mod.name;
      sameSourceMap.set(`${mod.sourceFile}::${rawName}`, mod);
      sameSourceMap.set(`${mod.sourceFile}::${mod.name}`, mod);
    }
    const modStem = getModuleStem(normalizeHierarchicalName(mod.originalName || mod.name));
    if (modStem) {
      if (!stemModules.has(modStem)) stemModules.set(modStem, []);
      stemModules.get(modStem).push(mod);
    }
  }

  const resolveChild = (typeName, ownerMod) => {
    if (!typeName) return null;
    if (ownerMod?.sourceFile) {
      const local = sameSourceMap.get(`${ownerMod.sourceFile}::${typeName}`);
      if (local) return local;
    }
    const direct = moduleByName.get(typeName);
    if (direct) return direct;
    const typeStem = getModuleStem(normalizeHierarchicalName(typeName));
    const stemMatches = typeStem ? stemModules.get(typeStem) : null;
    return stemMatches?.length === 1 ? stemMatches[0] : null;
  };

  const instantiated = new Set();
  for (const mod of moduleLibrary) {
    for (const cell of mod?.cells || []) {
      const child = resolveChild(cell.type, mod);
      if (child) instantiated.add(child.name);
    }
  }
  const roots = moduleLibrary.filter((mod) => mod?.name && !instantiated.has(mod.name));
  const startModules = roots.length > 0 ? roots : moduleLibrary.filter((mod) => Boolean(mod?.name));
  return { startModules, resolveChild };
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

function getPointCandidates(rawPoint, moduleName, occurrencePrefixes = []) {
  const normPoint = normalizeHierarchicalName(rawPoint);
  if (!normPoint) return [];
  const candidates = [];
  const addCandidate = (value) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  for (const prefix of occurrencePrefixes) {
    if (normPoint.startsWith(`${prefix}/`)) {
      addCandidate(normPoint.slice(prefix.length + 1));
    } else {
      const marker = `/${prefix}/`;
      const markerIndex = normPoint.indexOf(marker);
      if (markerIndex >= 0) {
        addCandidate(normPoint.slice(markerIndex + marker.length));
      }
    }
  }

  const normModule = normalizeHierarchicalName(moduleName);
  if (normModule) {
    if (normPoint.startsWith(`${normModule}/`)) {
      addCandidate(normPoint.slice(normModule.length + 1));
    }
    const alt = createModuleSegmentAlternation(normModule);
    const wrapperPattern = new RegExp(
      `^(?:.*?/)??(?:LoResynHinst_of_module_|of_module_|Hinst)?${alt}(?:_loc|_ConeInst|_gen_\\d+)*/(.+)$`,
      "i"
    );
    const wrapperMatch = normPoint.match(wrapperPattern);
    if (wrapperMatch?.[1]) {
      addCandidate(wrapperMatch[1]);
    }
    const portPrefixPattern = new RegExp(
      `^(?:.*?/)??(?:LoResynHinst_of_module_|of_module_|Hinst)?${alt}(?:_loc|_ConeInst|_gen_\\d+)*__(.+)$`,
      "i"
    );
    const portMatch = normPoint.match(portPrefixPattern);
    if (portMatch?.[1]) {
      addCandidate(portMatch[1]);
    }
  }

  addCandidate(normPoint);
  return candidates;
}

function tryCollectCellPin(record, candidates, cells, cellPinGroups, portsByNormName = null, cellInstanceSet = null) {
  const rawNormPoint = normalizeHierarchicalName(record.point);
  const rawSlashIndex = rawNormPoint.lastIndexOf("/");
  const rawFullPath = rawSlashIndex > 0 ? rawNormPoint.slice(0, rawSlashIndex).trim() : null;

  for (const candidate of candidates) {
    const slashIndex = candidate.lastIndexOf("/");
    if (slashIndex <= 0 || slashIndex === candidate.length - 1) continue;

    const instPath = candidate.slice(0, slashIndex).trim();
    const rawPin = candidate.slice(slashIndex + 1).trim();
    const pinName = normalizePinName(rawPin);
    if (!instPath || !pinName) continue;

    const matchedCells = findLongestSuffixCells(instPath, cells, cellInstanceSet);
    if (matchedCells.length === 0) continue;

    // If the unsplit candidate is an exact port name in the module, and the matched cell
    // explicitly defines pins that do NOT include pinName, let Port resolution win.
    if (
      portsByNormName?.has(candidate) &&
      matchedCells.every((item) => item.pinSet.size > 0 && !item.pinSet.has(pinName))
    ) {
      continue;
    }

    addPinToGroup(cellPinGroups, instPath, rawFullPath || instPath, pinName, record, "pin", null);
    return true;
  }
  return false;
}

function findLongestSuffixCells(instPath, cells, cellInstanceSet = null) {
  const normInstPath = normalizeHierarchicalName(instPath);
  const exact = cells.filter(({ instance }) => normInstPath === instance);
  if (exact.length > 0) return exact;

  const hasChildBoundaryAncestor = (prefixPath) => {
    if (!cellInstanceSet || !prefixPath) return false;
    const segments = prefixPath.split("/");
    for (let start = 0; start < segments.length; start += 1) {
      let current = "";
      for (let end = start; end < segments.length; end += 1) {
        current = current ? `${current}/${segments[end]}` : segments[end];
        if (cellInstanceSet.has(current)) return true;
      }
    }
    return false;
  };

  const candidates = cells.filter(({ instance }) => {
    if (!normInstPath.endsWith(`/${instance}`)) return false;
    const prefixBeforeInstance = normInstPath.slice(0, normInstPath.length - instance.length - 1);
    return !hasChildBoundaryAncestor(prefixBeforeInstance);
  });
  if (candidates.length === 0) return [];
  const longestLength = Math.max(...candidates.map(({ instance }) => instance.length));
  return candidates.filter(({ instance }) => instance.length === longestLength);
}

function addPinToGroup(cellPinGroups, matchPath, fullPath, pinName, record, sourceKind = "pin", sourceNet = null) {
  const groupKey = normalizeHierarchicalName(matchPath);
  if (!cellPinGroups.has(groupKey)) {
    cellPinGroups.set(groupKey, {
      matchPath,
      fullPath: fullPath || matchPath,
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

function resolveMatchingPortNodes(candidate, portsByNormName) {
  const direct = portsByNormName.get(candidate);
  if (direct && direct.length > 0) return direct;

  const doubleMatch = candidate.match(/^(.+)__(\d+)$/);
  if (doubleMatch) {
    const [, base, index] = doubleMatch;
    const portCandidates = [`${base}[${index}]`, `${base}_[${index}]`];
    if (index === "0") portCandidates.push(base);
    for (const key of portCandidates) {
      const nodes = portsByNormName.get(key);
      if (nodes && nodes.length > 0) return nodes;
    }
  }

  const singleMatch = candidate.match(/^(.+)_(\d+)$/);
  if (singleMatch) {
    const [, base, index] = singleMatch;
    const nodes = portsByNormName.get(`${base}[${index}]`);
    if (nodes && nodes.length > 0) return nodes;
  }

  return null;
}

function tryAnnotatePort(record, candidates, portsByNormName, portTimingByNodeId, fromNet = false, sourceNet = null) {
  for (const candidate of candidates) {
    const portNodes = resolveMatchingPortNodes(candidate, portsByNormName);
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

function resolveCellTimingMatches(cellPinGroups, cells, unit, stage, cellInstanceSet = null) {
  const groupsByNodeId = new Map();
  const directGroupsByNodeId = new Map();

  for (const group of cellPinGroups.values()) {
    if (group.directNodeId) {
      directGroupsByNodeId.set(group.directNodeId, group);
      continue;
    }
    const longest = findLongestSuffixCells(group.matchPath, cells, cellInstanceSet);
    if (longest.length !== 1) {
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
        ({ instance, group }) => normalizeHierarchicalName(group.matchPath) === instance
      );
      if (exactEntries.length === 1) {
        selectedEntry = exactEntries[0];
      } else {
        ambiguousNodeIds.add(nodeId);
        continue;
      }
    }
    matchedGroupByNodeId.set(nodeId, {
      cell: selectedEntry.cell,
      fullPath: selectedEntry.group.fullPath,
      pins: { ...selectedEntry.group.pins }
    });
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
  const threshold = Number.isFinite(policy?.threshold) ? policy.threshold : 0.0;
  const worstSlack = Number.isFinite(timing.worstSlack) ? timing.worstSlack : timing.slack;
  const isCritical = Number.isFinite(worstSlack) && worstSlack < threshold;
  const pins = timing.pins ? { ...timing.pins } : {};
  for (const [pinName, pinData] of Object.entries(pins)) {
    pins[pinName] = {
      ...pinData,
      isCritical: Number.isFinite(pinData.slack) && pinData.slack < threshold
    };
  }
  return {
    ...timing,
    pins,
    slackThreshold: threshold,
    isCritical,
    badges,
    badge: badges[0] || null,
    badgePosition: BADGE_POSITION_SET.has(position) ? position : "bottom-right"
  };
}

function getDefaultBadgeChoices(timing, node, policy) {
  const policyMetrics = policy?.metrics !== undefined ? policy.metrics : DEFAULT_TIMING_DISPLAY_POLICY.metrics;
  if (!policyMetrics || policyMetrics.length === 0) {
    return [];
  }
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
