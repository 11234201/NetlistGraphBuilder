export const DEFAULT_MODULE_HIERARCHY_LIMITS = Object.freeze({ maximumNodes: 2000, maximumDepth: 64 });

export function buildModuleHierarchy(design, options = {}) {
  const modules = [...(design?.modules || [])];
  const moduleByName = new Map(modules.map((module) => [module.name, module]));
  const sameSourceMap = buildSameSourceMap(modules);
  const instantiated = new Set();
  for (const module of modules) {
    for (const cell of module.cells || []) {
      const target = resolveChildModule(cell.type, module, moduleByName, sameSourceMap);
      if (target) instantiated.add(target.name);
    }
  }
  const roots = modules.filter((module) => !instantiated.has(module.name));
  const rootModules = roots.length > 0 ? roots : modules;
  const context = {
    maximumNodes: normalizeLimit(options.maximumNodes, DEFAULT_MODULE_HIERARCHY_LIMITS.maximumNodes),
    maximumDepth: normalizeLimit(options.maximumDepth, DEFAULT_MODULE_HIERARCHY_LIMITS.maximumDepth, 0),
    nodeCount: 0,
    truncated: false
  };
  const result = [];
  for (const module of rootModules) {
    if (context.nodeCount >= context.maximumNodes) {
      context.truncated = true;
      break;
    }
    result.push(buildNode(module, null, [], [], [], module.name, moduleByName, sameSourceMap, context));
  }
  Object.defineProperty(result, "truncated", { value: context.truncated, enumerable: false });
  return Object.freeze(result);
}

function buildSameSourceMap(modules) {
  const map = new Map();
  for (const module of modules) {
    if (!module?.sourceFile) continue;
    const rawName = module.originalName || module.name;
    map.set(`${module.sourceFile}::${rawName}`, module);
    map.set(`${module.sourceFile}::${module.name}`, module);
  }
  return map;
}

function resolveChildModule(typeName, ownerModule, moduleByName, sameSourceMap) {
  if (ownerModule?.sourceFile && sameSourceMap) {
    const local = sameSourceMap.get(`${ownerModule.sourceFile}::${typeName}`);
    if (local) return local;
  }
  return moduleByName.get(typeName) || null;
}

/** Return bounded occurrence contexts for a module definition in a hierarchy tree. */
export function findModuleOccurrences(roots, moduleName) {
  const matches = [];
  const visit = (node) => {
    if (node.moduleName === moduleName) {
      matches.push(Object.freeze({
        moduleName: node.moduleName,
        rootModuleName: node.rootModuleName || node.moduleName,
        occurrencePath: Object.freeze([...(node.canonicalOccurrencePath || [])]),
        displayPath: Object.freeze([...(node.occurrencePath || [])])
      }));
    }
    for (const child of node.children || []) visit(child);
  };
  for (const root of roots || []) visit(root);
  return Object.freeze(matches);
}

function buildNode(module, instance, moduleAncestry, instancePath, canonicalPath, rootModuleName, moduleByName, sameSourceMap, context) {
  context.nodeCount += 1;
  const cycle = moduleAncestry.includes(module.name);
  const nextModuleAncestry = [...moduleAncestry, module.name];
  const segment = instance ? `${instance.instance}:${module.name}` : module.name;
  const nextInstancePath = [...instancePath, segment];
  const nextCanonicalPath = instance ? [...canonicalPath, instance.instance] : [...canonicalPath];
  const childPairs = cycle ? [] : (module.cells || [])
    .map((cell) => ({ cell, target: resolveChildModule(cell.type, module, moduleByName, sameSourceMap) }))
    .filter((pair) => Boolean(pair.target));
  const children = [];
  let truncated = false;
  for (const { cell, target } of childPairs) {
    if (nextInstancePath.length > context.maximumDepth || context.nodeCount >= context.maximumNodes) {
      context.truncated = true;
      truncated = true;
      break;
    }
    children.push(buildNode(
      target,
      cell,
      nextModuleAncestry,
      nextInstancePath,
      nextCanonicalPath,
      rootModuleName,
      moduleByName,
      sameSourceMap,
      context
    ));
  }
  return Object.freeze({
    id: nextInstancePath.join("/"),
    occurrencePath: Object.freeze([...nextInstancePath]),
    canonicalOccurrencePath: Object.freeze([...nextCanonicalPath]),
    rootModuleName,
    moduleName: module.name,
    moduleLabel: module.displayName || module.name,
    instanceName: instance?.instance || null,
    instanceLabel: instance?.instanceDisplayName || instance?.instance || null,
    cycle,
    truncated,
    children: Object.freeze(children)
  });
}

function normalizeLimit(value, fallback, minimum = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.floor(number)) : fallback;
}
