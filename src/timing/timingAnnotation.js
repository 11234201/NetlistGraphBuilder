import { createMatchDiagnostics, TIMING_SAMPLE_LIMIT, timingNameSample } from "./timing_diagnostics.js";

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
  const moduleMatcher = createModulePointMatcher(targetModuleName);
  const hierarchyContext = createHierarchyTimingContext(graph, targetModuleName, options);
  if (!timing.records?.length) return graph;
  const cellIndex = buildCellIndex(graph.nodes);
  const diagnostics = createMatchDiagnostics(timing, hierarchyContext, (point) => cellsNamedInPoint(point, cellIndex));
  const withEvidence = (node) => diagnostics.byCell.has(node.id)
    ? { ...node, timingMatchEvidence: diagnostics.byCell.get(node.id) } : node;
  const scopedItems = selectModuleRecords(timing, hierarchyContext, diagnostics);
  const summary = { stage, unit, policy, scopedRecordCount: scopedItems.length, diagnostics: diagnostics.details };
  if (scopedItems.length === 0) {
    diagnostics.summarizeCells(graph.nodes);
    return { ...graph, nodes: graph.nodes.map(withEvidence),
      timingSummary: { ...summary, candidateMatchedRecordCount: 0, matchedRecordCount: 0, unmatchedRecordCount: 0 } };
  }

  const portIndex = buildPortIndex(graph.nodes);
  const netTopology = buildNetSourceIndex(graph);

  const cellPinGroups = new Map();
  const portTimingByNodeId = new Map();
  const netTiming = {};
  const matchedOccurrenceKeys = new Set();
  let candidateMatchedRecordCount = 0;

  const recordMatch = (match, record) => {
    candidateMatchedRecordCount += 1;
    if (match.targetKind && typeof record.point === "string" && record.point.includes("/")) diagnostics.otherTarget(record, match.targetKind);
    if (match?.occurrenceKey) {
      matchedOccurrenceKeys.add(match.occurrenceKey);
    }
  };
  for (const item of scopedItems) {
    const { record, stripPrefixes, allowModulePattern, allowPortPrefix } = item;
    const candidates = getPointCandidates(
      record.point,
      moduleMatcher,
      stripPrefixes,
      allowModulePattern,
      allowPortPrefix
    );
    const explicitKind = record.kind || null;

    if (explicitKind === "pin") {
      const match =
        tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex) ||
        tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId);
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    if (explicitKind === "port") {
      const match =
        tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId) ||
        tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex);
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    if (explicitKind === "net") {
      const match = tryAnnotateNet(
        record,
        candidates,
        netTopology,
        netTiming,
        cellPinGroups,
        portTimingByNodeId
      );
      if (match) recordMatch(match, record);
      else diagnostics.unmatched(record, candidates);
      continue;
    }

    // Default disambiguation when kind is omitted:
    // 1. Cell Pin (validated against existing cells in graph, unless exact port name takes precedence when pin doesn't exist)
    const pinMatch = tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex);
    if (pinMatch) {
      recordMatch(pinMatch, record);
      continue;
    }

    // 2. Boundary Port (supports escaped port names containing '/')
    const portMatch = tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId);
    if (portMatch) {
      recordMatch(portMatch, record);
      continue;
    }

    // 3. Internal Net (resolves upstream through assign aliases to Source driver)
    const netMatch = tryAnnotateNet(
      record,
      candidates,
      netTopology,
      netTiming,
      cellPinGroups,
      portTimingByNodeId
    );
    if (netMatch) {
      recordMatch(netMatch, record);
      continue;
    }

    diagnostics.unmatched(record, candidates);
  }

  if (matchedOccurrenceKeys.size > 1) {
    diagnostics.summarizeCells(graph.nodes);
    const occurrenceExamples = [];
    for (const key of matchedOccurrenceKeys) {
      occurrenceExamples.push(timingNameSample(key));
      if (occurrenceExamples.length === TIMING_SAMPLE_LIMIT) break;
    }
    return {
      ...graph,
      netTiming: {},
      timingSummary: {
        ...summary,
        occurrenceExamples,
        candidateMatchedRecordCount,
        matchedRecordCount: 0,
        unmatchedRecordCount: scopedItems.length,
        ambiguousOccurrenceCount: matchedOccurrenceKeys.size
      },
      nodes: graph.nodes.map(withEvidence)
    };
  }

  const cellTimingByNodeId = resolveCellTimingMatches(cellPinGroups, cellIndex, unit, stage, diagnostics);
  const unresolvedPins = Object.values(diagnostics.details.unresolvedPins.reasons).reduce((total, count) => total + count, 0);
  const matchedRecordCount = candidateMatchedRecordCount - unresolvedPins;
  diagnostics.summarizeCells(graph.nodes, cellTimingByNodeId);

  const annotatedNodes = graph.nodes.map((node) => {
    if (node.kind === "cell") {
      const nodeTiming = cellTimingByNodeId.get(node.id);
      if (!nodeTiming) return withEvidence(node);
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
      ...summary,
      matchedRecordCount,
      candidateMatchedRecordCount,
      unmatchedRecordCount: scopedItems.length - matchedRecordCount
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

const MODULE_WRAPPER_PREFIX = "(?:LoResynHinst_of_module_|of_module_|Hinst)?";
const MODULE_WRAPPER_SUFFIX = "(?:_loc|_ConeInst|_gen_\\d+)*";
const PORT_PREFIX_TAIL = "((?:[^/\\\\]|\\\\+(?:[^\\\\]|$))+)";

function createModulePointMatcher(moduleName) {
  const normModule = normalizeHierarchicalName(moduleName);
  if (!normModule) {
    return { normModule: "", wrapperPattern: null, portPrefixPattern: null };
  }
  const alt = createModuleSegmentAlternation(normModule);
  return {
    normModule,
    wrapperPattern: new RegExp(
      `^(?:.*?/)??${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}/(.+)$`,
      "i"
    ),
    portPrefixPattern: new RegExp(
      `^(?:.*?/)??${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}__${PORT_PREFIX_TAIL}$`,
      "i"
    )
  };
}

function createHierarchyTimingContext(graph, targetModuleName, options = {}) {
  const moduleLibrary = Array.isArray(options.moduleLibrary) ? options.moduleLibrary : [];
  const normModule = normalizeHierarchicalName(targetModuleName);
  const currentMod = moduleLibrary.find((mod) => mod?.name === graph.moduleName) || null;
  const knownModuleNames = new Set();
  for (const mod of moduleLibrary) {
    if (mod?.name) knownModuleNames.add(mod.name);
    if (mod?.originalName) knownModuleNames.add(mod.originalName);
  }
  const rawOccurrencePath = Array.isArray(options.occurrencePath) ? options.occurrencePath : [];
  const explicitPathSegments = rawOccurrencePath
    .map((segment) => {
      const text = String(segment || "").trim();
      const colonIndex = text.lastIndexOf(":");
      if (colonIndex > 0) {
        const suffix = text.slice(colonIndex + 1);
        const isModuleSuffix = knownModuleNames.size > 0
          ? knownModuleNames.has(suffix)
          : (!text.startsWith("\\") && /^[A-Za-z_][\w$]*(?:\s+\[[^\]]+\])?(?:\s+#\d+)?$/.test(suffix));
        if (isModuleSuffix) {
          return normalizeOccurrenceInstance(text.slice(0, colonIndex));
        }
      }
      return normalizeOccurrenceInstance(text);
    })
    .filter(Boolean);

  const selectedRoot = moduleLibrary.find((mod) => mod?.name === options.occurrenceRootModuleName);
  const explicitRootModuleName = selectedRoot?.originalName || options.occurrenceRootModuleName || null;

  return {
    normModule,
    currentMod,
    moduleLibrary,
    hasExplicitOccurrence: explicitPathSegments.length > 0,
    explicitPathSegments,
    selectedRoot,
    explicitRootModuleName: explicitRootModuleName ? normalizeHierarchicalName(explicitRootModuleName) : null
  };
}

function selectModuleRecords(timing, context, diagnostics) {
  const allRecords = Array.isArray(timing.records) ? timing.records : [];
  if (allRecords.length === 0) return [];

  const { normModule, moduleLibrary } = context;
  const scopes = timing.scopes && typeof timing.scopes === "object" && !Array.isArray(timing.scopes)
    ? timing.scopes
    : null;

  if (!normModule) {
    return allRecords.map((record) => ({
      record,
      stripPrefixes: [],
      allowModulePattern: true,
      allowPortPrefix: true
    }));
  }

  const hierarchyIndex = moduleLibrary.length > 0 ? indexModuleHierarchy(moduleLibrary) : null;
  if (context.hasExplicitOccurrence && hierarchyIndex && context.currentMod) {
    const roots = context.selectedRoot ? [context.selectedRoot] : context.explicitRootModuleName
      ? findMatchingScopeModules(context.explicitRootModuleName, hierarchyIndex.modules) : hierarchyIndex.startModules;
    const occurrences = traceExplicitOccurrences(roots, context, hierarchyIndex);
    if (occurrences.length || (roots.length && context.explicitRootModuleName)) context = { ...context, occurrences };
    if (occurrences.length === 1) {
      context.explicitRootModuleName = occurrences[0].rootModuleName;
      diagnostics.details.occurrenceRoot = timingNameSample(context.explicitRootModuleName);
      diagnostics.details.occurrencePath = timingNameSample(formatOccurrencePath(occurrences[0].pathSegments));
    }
  }

  if (scopes) {
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
        for (const item of filterRecordsForScope(scopes.__default__, "__default__", context, hierarchyIndex, diagnostics)) selected.push(item);
      }
      const chosen = new Set(matchedScopeKeys);
      for (const key of namedScopeKeys) {
        if (!chosen.has(key) && Array.isArray(scopes[key])) {
          diagnostics.exclude("other-named-scope", scopes[key], null);
        }
      }
      for (const key of matchedScopeKeys) {
        for (const record of scopes[key]) {
          selected.push({
            record,
            stripPrefixes: [],
            allowModulePattern: true,
            allowPortPrefix: true
          });
        }
      }
      return selected;
    }

    const selected = [];
    // Reports can describe one physical instance from different ancestors.
    // Normalize its identity only when the loaded hierarchy proves the path.
    const occurrence = !context.hasExplicitOccurrence && Object.keys(scopes).length > 1 && hierarchyIndex
      ? identifySharedOccurrence(context, hierarchyIndex, diagnostics) : null;
    for (const [scopeKey, scopeRecords] of Object.entries(scopes)) {
      if (!Array.isArray(scopeRecords) || scopeRecords.length === 0) continue;
      for (const item of filterRecordsForScope(scopeRecords, scopeKey, context, hierarchyIndex, diagnostics, occurrence)) selected.push(item);
    }
    return selected;
  }

  return filterRecordsForScope(allRecords, "__default__", context, hierarchyIndex, diagnostics);
}

function identifySharedOccurrence(context, hierarchyIndex, diagnostics) {
  if (!context.currentMod) return null;
  const paths = findOccurrencePathsToModule(hierarchyIndex.startModules, hierarchyIndex, context, null, diagnostics);
  if (paths.length !== 1 || diagnostics.details.hierarchyDepthLimitReached || diagnostics.details.hierarchyVisitLimitReached) return null;
  return traceOccurrence(paths[0].rootMod, paths[0].pathSegments, hierarchyIndex, context.currentMod);
}

function traceExplicitOccurrences(roots, context, hierarchyIndex) {
  const segments = context.explicitPathSegments;
  return roots.map((root) => {
    const traced = traceOccurrence(root, segments, hierarchyIndex, context.currentMod);
    if (traced || context.explicitRootModuleName || segments.length < 2) return traced;
    const rootName = normalizeHierarchicalName(root.originalName || root.name);
    return matchesRootIdentifier(rootName, segments[0])
      ? traceOccurrence(root, segments.slice(1), hierarchyIndex, context.currentMod) : null;
  }).filter(Boolean);
}

// A live path contains complete instance names. Older navigation state may
// have split one of those names at a slash. Prefer the supplied boundaries
// whenever they lead to the target, trying only prefixes present in the IR.
function resolveOccurrenceSteps(rootMod, segments, hierarchyIndex, targetModule) {
  const pending = [{ mod: rootMod, offset: 0 }];
  const visited = new Map();
  while (pending.length) {
    const step = pending.pop();
    if (step.offset === segments.length) {
      if (!targetModule || step.mod === targetModule) return step;
      continue;
    }
    if (!visited.has(step.mod)) visited.set(step.mod, new Set());
    const offsets = visited.get(step.mod);
    if (offsets.has(step.offset)) continue;
    offsets.add(step.offset);
    const { children, slashPrefixes } = hierarchyIndex.instancesByModule.get(step.mod);
    const candidates = [];
    let instance = segments[step.offset];
    for (let i = step.offset + 1; ; i++) {
      const child = children.get(instance);
      if (child) candidates.push({ mod: child, offset: i, instance, parent: step });
      const prefix = instance.replace(/\\+$/, "");
      if (i === segments.length || !slashPrefixes.has(prefix)) break;
      instance = prefix + "/" + segments[i];
    }
    for (let i = candidates.length - 1; i >= 0; i--) pending.push(candidates[i]);
  }
  return null;
}

function traceOccurrence(rootMod, segments, hierarchyIndex, targetModule) {
  let step = resolveOccurrenceSteps(rootMod, segments, hierarchyIndex, targetModule);
  if (!step) return null;
  const steps = [];
  while (step.parent) {
    steps.push(step);
    step = step.parent;
  }
  const startByModule = new Map();
  const pathSegments = [];
  for (const { instance, parent } of steps.reverse()) {
    if (startByModule.has(parent.mod)) return null;
    startByModule.set(parent.mod, pathSegments.length);
    pathSegments.push(instance);
  }
  const rootModuleName = normalizeHierarchicalName(rootMod.originalName || rootMod.name);
  return { rootMod, rootModuleName, pathSegments, key: `${rootMod.name}::${formatOccurrencePath(pathSegments)}`, startByModule };
}

function filterRecordsForScope(records, scopeKey, context, hierarchyIndex, diagnostics, occurrence) {
  const { normModule } = context;
  const isDefaultScope = scopeKey === "__default__";
  const normScopeKey = isDefaultScope ? "" : normalizeHierarchicalName(scopeKey);
  const scopeModules = !isDefaultScope && hierarchyIndex
    ? findMatchingScopeModules(normScopeKey, hierarchyIndex.modules)
    : [];

  if (context.occurrences?.length === 0) {
    diagnostics.exclude(scopeModules.length ? "no-occurrence-under-scope" : "root-path-mismatch", records, null);
    return [];
  }
  if (scopeModules.length > 0) {
    return filterRecordsUnderScopeModules(records, normScopeKey, scopeModules, context, hierarchyIndex, diagnostics, occurrence);
  }

  const knownRootPaths = resolveKnownRootPaths(context, hierarchyIndex, diagnostics);
  if (knownRootPaths.length > 0) {
    return filterRecordsByKnownRootPaths(records, scopeKey, normScopeKey, knownRootPaths, hierarchyIndex, diagnostics);
  }

  const alt = createModuleSegmentAlternation(normModule);
  const modulePathPattern = new RegExp(`(?:^|/)${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}/`, "i");
  const modulePortPrefixPattern = new RegExp(`^(?:.*?/)??${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}__${PORT_PREFIX_TAIL}$`, "i");

  const matched = [];
  for (const record of records) {
    const normPoint = normalizeHierarchicalName(record.point);
    if (modulePathPattern.test(normPoint) || modulePortPrefixPattern.test(normPoint)) {
      matched.push({
        record,
        stripPrefixes: [],
        allowModulePattern: true,
        allowPortPrefix: true
      });
    } else {
      diagnostics.exclude("module-prefix-mismatch", record, normModule);
    }
  }
  return matched;
}

function findMatchingScopeModules(normScopeKey, modules) {
  const exact = modules.filter((mod) => {
    const normMod = normalizeHierarchicalName(mod.originalName || mod.name);
    return normMod === normScopeKey || normScopeKey.endsWith(`/${normMod}`);
  });
  if (exact.length > 0) return exact;
  return modules.filter((mod) => {
    const normMod = normalizeHierarchicalName(mod.originalName || mod.name);
    return matchesModuleWrapper(normScopeKey, normMod);
  });
}

function filterRecordsUnderScopeModules(records, normScopeKey, scopeModules, context, hierarchyIndex, diagnostics, occurrence) {
  let occurrences = occurrence ? [occurrence] : context.occurrences;
  if (!occurrences && context.hasExplicitOccurrence && context.currentMod && !context.explicitRootModuleName) {
    occurrences = traceExplicitOccurrences(scopeModules, context, hierarchyIndex);
  }
  const paths = occurrences
    ? occurrences.flatMap((owner) => scopeModules.filter((mod) => owner.startByModule.has(mod))
      .map((mod) => ({ rootMod: mod, pathSegments: owner.pathSegments.slice(owner.startByModule.get(mod)), key: owner.key })))
    : findOccurrencePathsToModule(scopeModules, hierarchyIndex, context, scopeModules, diagnostics);
  if (!paths.length) {
    diagnostics.exclude("no-occurrence-under-scope", records, null);
    return [];
  }

  const alt = createModuleSegmentAlternation(context.normModule);
  const modulePortPrefixPattern = new RegExp(`^(?:.*?/)??${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}__${PORT_PREFIX_TAIL}$`, "i");
  const pathEntries = paths.map((entry) =>
    createOccurrencePrefixMatcher(entry, hierarchyIndex, normScopeKey, true)
  ).sort((a, b) => b.fullPath.length - a.fullPath.length || a.fullPath.localeCompare(b.fullPath));
  const hasDirectChild = paths.some(({ pathSegments }) => pathSegments.length === 1);
  return matchOccurrencePrefixes(records, pathEntries, diagnostics, "occurrence-path-mismatch",
    pathEntries[0].fullPath, hasDirectChild ? modulePortPrefixPattern : null);
}

function resolveKnownRootPaths(context, hierarchyIndex, diagnostics) {
  if (context.occurrences?.length) return context.occurrences;
  if (context.hasExplicitOccurrence) {
    return [{
      rootModuleName: context.explicitRootModuleName,
      pathSegments: context.explicitPathSegments
    }];
  }
  if (!hierarchyIndex) return [];
  return findOccurrencePathsToModule(hierarchyIndex.startModules, hierarchyIndex, context, null, diagnostics);
}

function normalizeOccurrenceInstance(value) {
  return unescapeSlashes(normalizeHierarchicalName(value));
}

function formatOccurrencePath(segments) {
  return segments.map((name) => name.replaceAll("/", "\\/")).join("/");
}

function createOccurrencePrefixMatcher(entry, hierarchyIndex, rootName, allowBare) {
  const fullPath = formatOccurrencePath(entry.pathSegments);
  let mod = entry.rootMod;
  const pathPattern = entry.pathSegments.map((name) => {
    const children = hierarchyIndex?.instancesByModule.get(mod)?.children;
    mod = children?.get(name);
    if (!name.includes("/")) return escapeRegExp(name);
    // If the plain spelling enters a sibling module, its slash is a hierarchy
    // boundary. Only the escaped spelling selects the slash-bearing instance.
    const [first, ...rest] = name.split("/");
    let prefix = first;
    let pattern = escapeRegExp(first);
    for (const [i, part] of rest.entries()) {
      const sibling = children?.get(prefix);
      const nested = sibling && resolveOccurrenceSteps(sibling, rest.slice(i), hierarchyIndex);
      pattern += (nested ? "\\\\+/" : "\\\\*/") + escapeRegExp(part);
      prefix += "/" + part;
    }
    return pattern;
  }).join("/");
  const leadingPath = "(?:.*?(?<!\\\\)/)??";
  const bare = allowBare ? new RegExp(`^(${pathPattern})/`) : null;
  const rooted = rootName
    ? new RegExp(`^(${leadingPath}${MODULE_WRAPPER_PREFIX}${createModuleSegmentAlternation(rootName)}${MODULE_WRAPPER_SUFFIX}/${pathPattern})/`, "i")
    : new RegExp(`^(${leadingPath}${pathPattern})/`);
  return {
    fullPath,
    occurrenceKey: entry.key || `${entry.rootMod?.name || rootName || ""}::${fullPath}`,
    match(point) {
      return bare?.exec(point)?.[1] || rooted.exec(point)?.[1];
    }
  };
}

function filterRecordsByKnownRootPaths(records, scopeKey, normScopeKey, knownRootPaths, hierarchyIndex, diagnostics) {
  const isDefaultScope = scopeKey === "__default__";
  const rootPatterns = knownRootPaths.map((entry) => {
    const allowBare = isDefaultScope || matchesRootIdentifier(normScopeKey, entry.rootModuleName);
    return createOccurrencePrefixMatcher(entry, hierarchyIndex, entry.rootModuleName, allowBare);
  });

  const firstRoot = knownRootPaths[0];
  const expectedPrefix = [firstRoot.rootModuleName, rootPatterns[0].fullPath].filter(Boolean).join("/");
  return matchOccurrencePrefixes(records, rootPatterns, diagnostics, "root-path-mismatch", expectedPrefix);
}

function matchOccurrencePrefixes(records, patterns, diagnostics, mismatchReason, expectedPrefix, portPattern = null) {
  const matched = [];
  for (const record of records) {
    const normPoint = normalizeHierarchicalName(record.point);
    const stripPrefixes = [];
    const owners = new Map();
    let ambiguous = false;
    for (const pattern of patterns) {
      const prefix = pattern.match(normPoint);
      if (!prefix) continue;
      if (owners.has(prefix)) {
        if (owners.get(prefix) !== pattern.occurrenceKey) ambiguous = true;
        continue;
      }
      owners.set(prefix, pattern.occurrenceKey);
      stripPrefixes.push({ prefix, occurrenceKey: pattern.occurrenceKey });
    }
    const allowPortPrefix = Boolean(portPattern?.test(normPoint));
    if (ambiguous) {
      diagnostics.exclude("ambiguous-root-path", record, null);
    } else if (stripPrefixes.length > 0 || allowPortPrefix) {
      stripPrefixes.sort((left, right) => right.prefix.length - left.prefix.length || left.prefix.localeCompare(right.prefix));
      matched.push({
        record,
        stripPrefixes,
        allowModulePattern: false,
        allowPortPrefix
      });
    } else {
      diagnostics.exclude(mismatchReason, record, expectedPrefix);
    }
  }
  return matched;
}

function findOccurrencePathsToModule(startModules, hierarchyIndex, context, scopeModules, diagnostics) {
  const { currentMod, normModule, hasExplicitOccurrence, explicitPathSegments, explicitRootModuleName } = context;
  const targetStem = getModuleStem(normModule);
  const hasCurrentMod = Boolean(currentMod && hierarchyIndex.moduleSet.has(currentMod));
  const paths = [];
  const MAX_DEPTH = 16;
  const MAX_VISITS = 4000;
  let visits = 0;

  const matchesCurrentModule = (typeName, childMod) => {
    if (hasCurrentMod) {
      return childMod === currentMod;
    }
    if (childMod) {
      const normChild = normalizeHierarchicalName(childMod.originalName || childMod.name);
      if (normChild === normModule) return true;
      if (targetStem && getModuleStem(normChild) === targetStem) return true;
    }
    const normType = normalizeHierarchicalName(typeName);
    if (normType === normModule) return true;
    return Boolean(targetStem && getModuleStem(normType) === targetStem);
  };

  const visit = (rootMod, mod, pathSegments, ancestry) => {
    if (!mod) return;
    if (visits >= MAX_VISITS || pathSegments.length >= MAX_DEPTH) {
      if (visits >= MAX_VISITS) diagnostics.details.hierarchyVisitLimitReached = MAX_VISITS;
      if (pathSegments.length >= MAX_DEPTH) diagnostics.details.hierarchyDepthLimitReached = MAX_DEPTH;
      return;
    }
    visits += 1;
    for (const cell of mod.cells || []) {
      const inst = normalizeOccurrenceInstance(cell.instance || cell.instanceDisplayName);
      if (!inst) continue;
      const nextPath = [...pathSegments, inst];
      const childMod = hierarchyIndex.resolveChild(cell.type, mod);
      if (matchesCurrentModule(cell.type, childMod)) {
        paths.push({
          rootMod,
          rootModuleName: normalizeHierarchicalName(rootMod.originalName || rootMod.name),
          pathSegments: nextPath
        });
      }
      if (childMod && !ancestry.has(childMod.name)) {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(childMod.name);
        visit(rootMod, childMod, nextPath, nextAncestry);
      }
    }
  };

  for (const rootMod of startModules) {
    visit(rootMod, rootMod, [], new Set([rootMod.name]));
  }

  if (!hasExplicitOccurrence) {
    return paths;
  }

  const relativeExplicitTargets = scopeModules && explicitRootModuleName
    ? resolveRelativeExplicitPathUnderScopes(hierarchyIndex, explicitRootModuleName, explicitPathSegments, scopeModules)
    : [];

  return paths.filter((entry) => {
    if (
      relativeExplicitTargets.some((target) =>
        entry.rootMod === target.scopeMod && segmentsEqual(entry.pathSegments, target.pathSegments)
      )
    ) {
      return true;
    }
    if (explicitRootModuleName && !matchesRootIdentifier(entry.rootModuleName, explicitRootModuleName)) {
      return false;
    }
    if (segmentsEqual(entry.pathSegments, explicitPathSegments)) {
      return true;
    }
    if (
      !explicitRootModuleName &&
      scopeModules &&
      explicitPathSegments.length > 1 &&
      scopeModules.some((mod) => matchesRootIdentifier(
        normalizeHierarchicalName(mod.originalName || mod.name),
        explicitPathSegments[0]
      )) &&
      segmentsEqual(entry.pathSegments, explicitPathSegments.slice(1))
    ) {
      return true;
    }
    return false;
  });
}

function resolveRelativeExplicitPathUnderScopes(hierarchyIndex, explicitRootModuleName, explicitPathSegments, scopeModules) {
  const scopeSet = new Set(scopeModules);
  const startRoots = hierarchyIndex.modules.filter((mod) =>
    matchesRootIdentifier(normalizeHierarchicalName(mod.originalName || mod.name), explicitRootModuleName)
  );
  const allowed = [];
  const walk = (mod, stepIndex, ancestry) => {
    if (!mod) return;
    if (scopeSet.has(mod) && stepIndex < explicitPathSegments.length) {
      allowed.push({
        scopeMod: mod,
        pathSegments: explicitPathSegments.slice(stepIndex)
      });
    }
    if (stepIndex >= explicitPathSegments.length) return;
    const expectedInst = explicitPathSegments[stepIndex];
    for (const cell of mod.cells || []) {
      const inst = normalizeOccurrenceInstance(cell.instance || cell.instanceDisplayName);
      if (inst !== expectedInst) continue;
      const childMod = hierarchyIndex.resolveChild(cell.type, mod);
      if (childMod && !ancestry.has(childMod.name)) {
        const nextAncestry = new Set(ancestry);
        nextAncestry.add(childMod.name);
        walk(childMod, stepIndex + 1, nextAncestry);
      }
    }
  };
  for (const rootMod of startRoots) {
    walk(rootMod, 0, new Set([rootMod.name]));
  }
  return allowed;
}

function matchesRootIdentifier(candidateRoot, expectedRoot) {
  if (!candidateRoot || !expectedRoot) return false;
  return candidateRoot === expectedRoot ||
    matchesModuleWrapper(candidateRoot, expectedRoot) ||
    matchesModuleWrapper(expectedRoot, candidateRoot);
}

function segmentsEqual(left, right) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
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
  const pattern = new RegExp(`(?:^|/)${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}$`, "i");
  return pattern.test(scopeName);
}

function indexModuleHierarchy(moduleLibrary) {
  const modules = moduleLibrary.filter((mod) => Boolean(mod?.name));
  const moduleSet = new Set(modules);
  const moduleByName = new Map();
  const sameSourceMap = new Map();
  const stemModules = new Map();
  for (const mod of modules) {
    moduleByName.set(mod.name, mod);
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
    if (!typeStem) return null;
    const candidates = (stemModules.get(typeStem) || []).filter((mod) =>
      ownerMod?.sourceFile ? mod.sourceFile === ownerMod.sourceFile : !mod.sourceFile
    );
    return candidates.length === 1 ? candidates[0] : null;
  };

  const instantiated = new Set();
  const instancesByModule = new Map();
  for (const mod of modules) {
    const children = new Map();
    const slashPrefixes = new Set();
    instancesByModule.set(mod, { children, slashPrefixes });
    for (const cell of mod.cells || []) {
      const child = resolveChild(cell.type, mod);
      if (child) {
        instantiated.add(child.name);
        const instance = normalizeOccurrenceInstance(cell.instance || cell.instanceDisplayName);
        children.set(instance, child);
        for (let i = instance.indexOf("/"); i >= 0; i = instance.indexOf("/", i + 1)) {
          slashPrefixes.add(instance.slice(0, i));
        }
      }
    }
  }
  const roots = modules.filter((mod) => !instantiated.has(mod.name));
  const startModules = roots.length > 0 ? roots : modules;
  return { modules, moduleSet, startModules, resolveChild, instancesByModule };
}

function buildCellIndex(nodes) {
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

function buildPortIndex(nodes) {
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

function getPointCandidates(rawPoint, moduleMatcher, stripPrefixes = [], allowModulePattern = true, allowPortPrefix = true) {
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

function findLastUnescapedSlash(text) {
  for (let index = text.length - 1; index > 0; index -= 1) {
    if (text[index] !== "/") continue;
    let backslashes = 0;
    for (let j = index - 1; j >= 0 && text[j] === "\\"; j -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) return index;
  }
  return -1;
}

// Rejected rows have no verified owner. Look up the longest instance-name
// suffix only to show same-name evidence, never to bind a timing value.
function cellsNamedInPoint(point, cellIndex) {
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

function tryCollectCellPin(record, candidates, cellIndex, cellPinGroups, portIndex = null) {
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
  return String(incoming?.edge || "").localeCompare(String(existing?.edge || "")) < 0;
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
      pins: {},
      pinPoints: {}
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

function tryAnnotatePort(record, candidates, portIndex, portTimingByNodeId) {
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

function tryAnnotateNet(record, candidates, netTopology, netTiming, cellPinGroups, portTimingByNodeId) {
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
    const driver = netTopology.directDriversByNet.get(rootNormNet) || netTopology.directDriversByNet.get(lookupKey) || null;

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
    const existingNetEntry = netTiming[canonicalNet];
    if (!existingNetEntry || isPreferredTimingRecord(record, existingNetEntry)) {
      netTiming[canonicalNet] = netEntry;
      netTiming[lookupKey] = netEntry;
      if (rootCanonicalNet) netTiming[rootCanonicalNet] = netEntry;
      if (rootNormNet) netTiming[rootNormNet] = netEntry;
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

function addDriverCellPinTiming(cellPinGroups, cellNodeId, pinName, record, sourceNet) {
  const key = `__node_id__:${cellNodeId}`;
  if (!cellPinGroups.has(key)) {
    cellPinGroups.set(key, {
      directNodeId: cellNodeId,
      fullPath: sourceNet,
      pins: {},
      pinPoints: {}
    });
  }
  const group = cellPinGroups.get(key);
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

function resolveCellTimingMatches(cellPinGroups, cellIndex, unit, stage, diagnostics) {
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
      pins: { ...selectedEntry.group.pins }
    });
  }

  for (const [nodeId, directGroup] of directGroupsByNodeId.entries()) {
    if (ambiguousNodeIds.has(nodeId)) continue;
    const cellEntry = cellIndex.byNodeId.get(nodeId);
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
    if (
      worstSlack === null ||
      pin.slack < worstSlack ||
      (pin.slack === worstSlack && String(pin.pin).localeCompare(String(worstPin)) < 0)
    ) {
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

  if (node?.gateKind === "module") {
    const pinKeys = Object.keys(timing.pins || {});
    if (pinKeys.length === 0) return [];
    const focusPin = timing.worstPin || getOrderedTimingPins(timing, node)[0];
    if (!isCustomPolicy) {
      const choices = [];
      if (Number.isFinite(timing.pins[focusPin]?.at)) choices.push({ pin: focusPin, metric: "at" });
      if (Number.isFinite(timing.pins[focusPin]?.slack)) choices.push({ pin: focusPin, metric: "slack" });
      if (choices.length > 0) return choices;
      const firstMetric = TIMING_METRICS.find((m) => Number.isFinite(timing.pins[focusPin]?.[m])) || "slack";
      return [{ pin: focusPin, metric: firstMetric }];
    }
    if (pinKeys.length > 6) {
      return policyMetrics.map((metric) => ({ pin: focusPin, metric }));
    }
    return getOrderedTimingPins(timing, node).flatMap((pin) =>
      policyMetrics.map((metric) => ({ pin, metric }))
    );
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
  const ordered = [];
  for (const pin of node?.ref?.pins || []) {
    const resolved = findTimingPin(timing, pin);
    if (resolved && !ordered.includes(resolved)) {
      ordered.push(resolved);
    }
  }
  for (const timingPin of Object.keys(timing.pins || {})) {
    if (!ordered.includes(timingPin)) {
      ordered.push(timingPin);
    }
  }
  return ordered;
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

function unescapeSlashes(value) {
  return String(value || "").replace(/\\+\//g, "/");
}

function normalizePinName(value) {
  return String(value || "")
    .trim()
    .replace(/^\\/, "")
    .replace(/\\+([[\]/$.])/g, "$1");
}

function normalizeHierarchicalName(value) {
  return String(value || "")
    .trim()
    .replace(/\\(\S+)\s+\//g, "$1/")
    .replace(/^\\/, "")
    .replace(/\/\\/g, "/")
    .replace(/\\+([[\]$.])/g, "$1")
    .replace(/\s+\[/g, "[")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
