export function buildModuleHierarchy(design) {
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
  return Object.freeze(rootModules.map((module) => buildNode(module, null, [], moduleByName)));
}

function buildNode(module, instance, ancestry, moduleByName) {
  const cycle = ancestry.includes(module.name);
  const path = [...ancestry, module.name];
  const children = cycle ? [] : (module.cells || [])
    .filter((cell) => moduleByName.has(cell.type))
    .map((cell) => buildNode(moduleByName.get(cell.type), cell, path, moduleByName));
  return Object.freeze({
    id: instance ? `${path.join("/")}:${instance.instance}` : path.join("/"),
    moduleName: module.name,
    moduleLabel: module.displayName || module.name,
    instanceName: instance?.instance || null,
    instanceLabel: instance?.instanceDisplayName || instance?.instance || null,
    cycle,
    children: Object.freeze(children)
  });
}
