export const DEFAULT_MODULE_HIERARCHY_LIMITS = Object.freeze({ maximumNodes: 2000, maximumDepth: 64 });

export function buildModuleHierarchy(design, options = {}) {
  const modules = [...(design?.modules || [])];
  const moduleByName = new Map(modules.map((module) => [module.name, module]));
  const instantiated = new Set();
  for (const module of modules) {
    for (const cell of module.cells || []) {
      if (moduleByName.has(cell.type)) instantiated.add(cell.type);
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
    result.push(buildNode(module, null, [], [], [], module.name, moduleByName, context));
  }
  Object.defineProperty(result, "truncated", { value: context.truncated, enumerable: false });
  return Object.freeze(result);
}

function buildNode(module, instance, moduleAncestry, instancePath, canonicalPath, rootModuleName, moduleByName, context) {
  context.nodeCount += 1;
  const cycle = moduleAncestry.includes(module.name);
  const nextModuleAncestry = [...moduleAncestry, module.name];
  const segment = instance ? `${instance.instance}:${module.name}` : module.name;
  const nextInstancePath = [...instancePath, segment];
  const nextCanonicalPath = instance ? [...canonicalPath, instance.instance] : [...canonicalPath];
  const childInstances = cycle ? [] : (module.cells || []).filter((cell) => moduleByName.has(cell.type));
  const children = [];
  let truncated = false;
  for (const cell of childInstances) {
    if (nextInstancePath.length > context.maximumDepth || context.nodeCount >= context.maximumNodes) {
      context.truncated = true;
      truncated = true;
      break;
    }
    children.push(buildNode(
      moduleByName.get(cell.type),
      cell,
      nextModuleAncestry,
      nextInstancePath,
      nextCanonicalPath,
      rootModuleName,
      moduleByName,
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
