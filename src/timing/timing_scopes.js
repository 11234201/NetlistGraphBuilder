import { unescapeSlashes, normalizeHierarchicalName, escapeRegExp } from "./timing_names.js";
import { timingNameSample } from "./timing_diagnostics.js";

const MODULE_WRAPPER_PREFIX = "(?:LoResynHinst_of_module_|of_module_|Hinst)?";
const MODULE_WRAPPER_SUFFIX = "(?:_loc|_ConeInst|_gen_\\d+)*";
const PORT_PREFIX_TAIL = "((?:[^/\\\\]|\\\\+(?:[^\\\\]|$))+)";

export function createModulePointMatcher(moduleName) {
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

export function createHierarchyTimingContext(graph, targetModuleName, options = {}) {
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
    occurrencePaths: new Map(),
    wrapperPatterns: new Map(),
    normModule,
    currentMod,
    moduleLibrary,
    hasExplicitOccurrence: explicitPathSegments.length > 0,
    explicitPathSegments,
    selectedRoot,
    explicitRootModuleName: explicitRootModuleName ? normalizeHierarchicalName(explicitRootModuleName) : null
  };
}

export function selectModuleRecords(timing, context, diagnostics) {
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
      ? findMatchingScopeModules(context.explicitRootModuleName, hierarchyIndex.modules, context.wrapperPatterns) : hierarchyIndex.startModules;
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
      : namedScopeKeys.filter((key) => matchesModuleWrapper(normalizeHierarchicalName(key), normModule, context.wrapperPatterns));

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
    ? findMatchingScopeModules(normScopeKey, hierarchyIndex.modules, context.wrapperPatterns)
    : [];

  if (context.occurrences?.length === 0) {
    diagnostics.exclude(scopeModules.length ? "no-occurrence-under-scope" : "root-path-mismatch", records, null);
    return [];
  }
  if (scopeModules.length > 0) {
    return filterRecordsUnderScopeModules(records, normScopeKey, scopeModules, context, hierarchyIndex, diagnostics, occurrence);
  }

  const knownRootPaths = context.knownRootPaths ??= resolveKnownRootPaths(context, hierarchyIndex, diagnostics);
  if (knownRootPaths.length > 0) {
    return filterRecordsByKnownRootPaths(records, scopeKey, normScopeKey, knownRootPaths, hierarchyIndex, diagnostics, context);
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

function findMatchingScopeModules(normScopeKey, modules, cache) {
  const exact = modules.filter((mod) => {
    const normMod = normalizeHierarchicalName(mod.originalName || mod.name);
    return normMod === normScopeKey || normScopeKey.endsWith(`/${normMod}`);
  });
  if (exact.length > 0) return exact;
  return modules.filter((mod) => {
    const normMod = normalizeHierarchicalName(mod.originalName || mod.name);
    return matchesModuleWrapper(normScopeKey, normMod, cache);
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
  return matchOccurrencePrefixes(records, indexOccurrencePatterns(pathEntries), diagnostics, "occurrence-path-mismatch",
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
  const path = new RegExp("^(" + pathPattern + ")/");
  const root = rootName && new RegExp("^" + MODULE_WRAPPER_PREFIX +
    createModuleSegmentAlternation(rootName) + MODULE_WRAPPER_SUFFIX + "/", "i");
  return {
    fullPath,
    firstPart: entry.pathSegments[0]?.split("/")[0] || "",
    occurrenceKey: entry.key || [entry.rootMod?.name || rootName || "", fullPath].join("::"),
    match(point, segmentStarts) {
      const bare = allowBare && path.exec(point);
      if (bare) return bare[1];
      for (const start of segmentStarts) {
        let offset = start;
        if (root) {
          const prefix = root.exec(point.slice(start));
          if (!prefix) continue;
          offset += prefix[0].length;
        }
        const matched = path.exec(point.slice(offset));
        if (matched) return point.slice(0, offset + matched[1].length);
      }
      return null;
    }
  };
}

function filterRecordsByKnownRootPaths(records, scopeKey, normScopeKey, paths, hierarchyIndex, diagnostics, context) {
  context.rootNames ??= [...new Set(paths.map((path) => path.rootModuleName))];
  const allowAll = scopeKey === "__default__";
  const bareRoots = new Set(allowAll ? context.rootNames :
    context.rootNames.filter((name) => matchesRootIdentifier(normScopeKey, name)));
  const key = JSON.stringify([...bareRoots]);
  context.rootIndexes ??= new Map();
  if (!context.rootIndexes.has(key)) {
    const patterns = paths.map((entry) => createOccurrencePrefixMatcher(entry, hierarchyIndex,
      entry.rootModuleName, allowAll || bareRoots.has(entry.rootModuleName)));
    context.rootIndexes.set(key, indexOccurrencePatterns(patterns));
  }
  const first = paths[0];
  const expected = [first.rootModuleName, formatOccurrencePath(first.pathSegments)].filter(Boolean).join("/");
  return matchOccurrencePrefixes(records, context.rootIndexes.get(key), diagnostics, "root-path-mismatch", expected);
}

function indexOccurrencePatterns(patterns) {
  const byFirstPart = new Map();
  for (const pattern of patterns) {
    if (!byFirstPart.has(pattern.firstPart)) byFirstPart.set(pattern.firstPart, []);
    byFirstPart.get(pattern.firstPart).push(pattern);
  }
  return byFirstPart;
}

function matchOccurrencePrefixes(records, byFirstPart, diagnostics, mismatchReason, expectedPrefix, portPattern = null) {
  const matched = [];
  for (const record of records) {
    const normPoint = normalizeHierarchicalName(record.point);
    const candidates = new Set();
    const starts = [0];
    let start = 0, slashes = 0;
    for (let i = 0; i <= normPoint.length; i++) {
      const c = normPoint[i];
      if (c === "/" || i === normPoint.length) {
        const part = normPoint.slice(start, i - slashes);
        for (const pattern of byFirstPart.get(part) || []) candidates.add(pattern);
        if (c === "/" && slashes % 2 === 0) starts.push(i + 1);
        start = i + 1;
      }
      slashes = c === "\\" ? slashes + 1 : 0;
    }
    const stripPrefixes = [];
    const owners = new Map();
    let ambiguous = false;
    for (const pattern of candidates) {
      const prefix = pattern.match(normPoint, starts);
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
  const key = JSON.stringify([Boolean(scopeModules), startModules.map((mod) => mod.name)]);
  if (!context.occurrencePaths.has(key)) {
    context.occurrencePaths.set(key, collectOccurrencePaths(startModules, hierarchyIndex, context, scopeModules, diagnostics));
  }
  return context.occurrencePaths.get(key);
}

function collectOccurrencePaths(startModules, hierarchyIndex, context, scopeModules, diagnostics) {
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

function matchesModuleWrapper(scopeName, normModule, cache) {
  if (cache?.has(normModule)) return cache.get(normModule).test(scopeName);
  if (!normModule) return false;
  const alt = createModuleSegmentAlternation(normModule);
  const pattern = new RegExp(`(?:^|/)${MODULE_WRAPPER_PREFIX}${alt}${MODULE_WRAPPER_SUFFIX}$`, "i");
  cache?.set(normModule, pattern);
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
