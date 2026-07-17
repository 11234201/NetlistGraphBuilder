export function findReferencedModule(design, node) {
  const moduleName = node?.referencedModuleName;
  if (!moduleName) return null;
  return design?.modules?.find((module) => module.name === moduleName) || null;
}
