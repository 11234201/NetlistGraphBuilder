import { formatMergedSourceLabel } from "../domains/netlist/design_merge.js";
import { buildModuleHierarchy } from "../domains/netlist/module_hierarchy.js";
import { recommendModulePair } from "../analysis/moduleCompare.js";

export function sourcePayloadForIdentity(sourceFiles, singleSource) {
  if (sourceFiles.length <= 1) return singleSource;
  return sourceFiles.map((entry) => `${entry.name}\u0000${entry.text}`).join("\u0001");
}

export function snapshotModuleIdentity(module) {
  if (!module) return null;
  return {
    name: module.name,
    originalName: module.originalName || module.name,
    sourceFile: module.sourceFile || null,
    span: module.span || null
  };
}

export function findModuleByName(modules, name) {
  if (!name) return null;
  return modules?.find(module => module.name === name)
    || modules?.find(module => module.displayName === name) || null;
}

export function remapModule(modules, snapshot) {
  if (!snapshot) return null;
  const exact = modules.find((item) => item.name === snapshot.name);
  if (exact) return exact;
  const matchesName = item => (item.originalName || item.name) === snapshot.originalName;
  const matchesSource = item => matchesName(item) && (!snapshot.sourceFile || item.sourceFile === snapshot.sourceFile);
  // Appending preserves the preceding source texts and their declaration locations.
  const declaration = snapshot.span && modules.find(item => matchesSource(item)
    && item.span?.line === snapshot.span.line && item.span?.column === snapshot.span.column);
  return declaration || modules.find(matchesSource) || modules.find(matchesName) || null;
}

export function pickAddedCompareModule(addedModules, peerModule) {
  if (!Array.isArray(addedModules) || addedModules.length === 0) return null;
  if (addedModules.length === 1) return addedModules[0];
  if (peerModule) {
    const peerRaw = peerModule.originalName || peerModule.name;
    const sameRaw = addedModules.find((m) => (m.originalName || m.name) === peerRaw);
    if (sameRaw) return sameRaw;
    const paired = recommendModulePair([peerModule, ...addedModules], peerModule.name);
    if (paired && addedModules.includes(paired)) return paired;
  }
  const hierarchy = buildModuleHierarchy({ modules: addedModules });
  const rootName = hierarchy[0]?.moduleName;
  return addedModules.find((m) => m.name === rootName) || addedModules[0];
}

export function prepareDesignSources(state, source, label, restore, append, compareSide) {
  const validRestoredFiles = Array.isArray(restore?.sourceFiles)
    ? restore.sourceFiles.filter((entry) => entry && typeof entry.text === "string")
    : [];
  const restoreMulti = validRestoredFiles.length > 1;
  const canAppend = Boolean(!restoreMulti && (append || compareSide) && state.design && state.currentSourceLabel !== "built-in sample");
  const existingFiles = state.sourceFiles?.length
    ? state.sourceFiles
    : (state.currentSource ? [{ name: state.currentSourceLabel || "Verilog", text: state.currentSource }] : []);
  const nextSourceFiles = restoreMulti
    ? validRestoredFiles.map((entry) => ({ name: entry.name || "Verilog", text: entry.text }))
    : canAppend
      ? [...existingFiles, { name: label, text: source }]
      : [{ name: label, text: source }];
  const effectiveLabel = nextSourceFiles.length > 1 ? formatMergedSourceLabel(nextSourceFiles) : label;
  return { nextSourceFiles, restoreMulti, canAppend, effectiveLabel };
}
