import { normalizeSingleViewMode } from "./singleViewMode.js";

export function createModuleHistory() {
  return { entries: [], index: -1 };
}

export function createModuleHistoryEntry(state) {
  const focusedRootNodeIds = normalizeFocusedRootNodeIds(
    state.focusedRootNodeIds,
    state.coneRootNodeId
  );
  return {
    moduleName: state.currentModule?.name || null,
    viewMode: normalizeSingleViewMode(state.viewMode),
    coneRootNodeId: focusedRootNodeIds[0] || state.coneRootNodeId || null,
    focusedRootNodeIds,
    activeFocusedRootNodeId: focusedRootNodeIds.includes(state.activeFocusedRootNodeId)
      ? state.activeFocusedRootNodeId
      : focusedRootNodeIds[0] || null,
    coneDepth: normalizeDepth(state.coneDepth, 3),
    faninDepth: normalizeDepth(state.faninDepth, 3),
    fanoutDepth: normalizeDepth(state.fanoutDepth, 3),
    selectedNodeId: state.selectedNodeId || null,
    selectedNet: state.selectedNet || null,
    transform: normalizeTransform(state.transform)
  };
}

export function pushModuleHistory(history, entry) {
  if (!entry?.moduleName) return cloneHistory(history);
  const current = history.entries[history.index];
  if (current && sameNavigationTarget(current, entry)) {
    return replaceCurrentModuleHistory(history, entry);
  }
  return {
    entries: [...history.entries.slice(0, history.index + 1), cloneEntry(entry)],
    index: history.index + 1
  };
}

export function replaceCurrentModuleHistory(history, entry) {
  if (history.index < 0 || !entry?.moduleName) return cloneHistory(history);
  const entries = history.entries.map((item, index) => index === history.index ? cloneEntry(entry) : cloneEntry(item));
  return { entries, index: history.index };
}

export function stepModuleHistory(history, delta, validModuleNames = null) {
  const direction = delta < 0 ? -1 : 1;
  const valid = validModuleNames ? new Set(validModuleNames) : null;
  for (let index = history.index + direction; index >= 0 && index < history.entries.length; index += direction) {
    const entry = history.entries[index];
    if (!valid || valid.has(entry.moduleName)) {
      return { history: { entries: history.entries.map(cloneEntry), index }, entry: cloneEntry(entry) };
    }
  }
  return { history: cloneHistory(history), entry: null };
}

export function canStepModuleHistory(history, delta, validModuleNames = null) {
  return Boolean(stepModuleHistory(history, delta, validModuleNames).entry);
}

function sameNavigationTarget(left, right) {
  return left.moduleName === right.moduleName &&
    left.viewMode === right.viewMode &&
    arraysEqual(
      normalizeFocusedRootNodeIds(left.focusedRootNodeIds, left.coneRootNodeId),
      normalizeFocusedRootNodeIds(right.focusedRootNodeIds, right.coneRootNodeId)
    );
}

function cloneHistory(history = createModuleHistory()) {
  return { entries: (history.entries || []).map(cloneEntry), index: Number.isInteger(history.index) ? history.index : -1 };
}

function cloneEntry(entry) {
  const focusedRootNodeIds = normalizeFocusedRootNodeIds(entry.focusedRootNodeIds, entry.coneRootNodeId);
  return {
    ...entry,
    coneRootNodeId: focusedRootNodeIds[0] || null,
    focusedRootNodeIds,
    activeFocusedRootNodeId: focusedRootNodeIds.includes(entry.activeFocusedRootNodeId)
      ? entry.activeFocusedRootNodeId
      : focusedRootNodeIds[0] || null,
    viewMode: normalizeSingleViewMode(entry.viewMode),
    transform: normalizeTransform(entry.transform)
  };
}

function normalizeFocusedRootNodeIds(value, legacyRootNodeId = null) {
  const values = Array.isArray(value) && value.length > 0
    ? value
    : value && !Array.isArray(value)
      ? [value]
      : legacyRootNodeId
        ? [legacyRootNodeId]
        : [];
  return [...new Set(values.filter((nodeId) => typeof nodeId === "string" && nodeId.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeDepth(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : fallback;
}

function normalizeTransform(value) {
  return {
    x: Number.isFinite(Number(value?.x)) ? Number(value.x) : 0,
    y: Number.isFinite(Number(value?.y)) ? Number(value.y) : 0,
    scale: Number.isFinite(Number(value?.scale)) && Number(value.scale) > 0 ? Number(value.scale) : 1
  };
}
