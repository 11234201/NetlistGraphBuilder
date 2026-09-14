import { normalizeFocusedRootNodeIds } from "./focusedViewPolicy.js";
import { normalizeSingleViewMode } from "./singleViewMode.js";

export const DEFAULT_VIEW_HISTORY_LIMIT = 128;

export function createViewHistory(limit = DEFAULT_VIEW_HISTORY_LIMIT) {
  return {
    entries: [],
    index: -1,
    limit: normalizeLimit(limit)
  };
}

export function createViewHistoryEntry(state, metadata = {}) {
  const focusedRootNodeIds = normalizeFocusedRootNodeIds(
    state.focusedRootNodeIds,
    state.coneRootNodeId
  );
  return cloneEntry({
    kind: metadata.kind || (state.compare?.active ? "compare" : "single"),
    transactionId: metadata.transactionId || null,
    label: metadata.label || null,
    affectedSessionIds: Array.isArray(metadata.affectedSessionIds) ? metadata.affectedSessionIds : [],
    moduleName: state.currentModule?.name || null,
    occurrenceContext: state.occurrenceContext ? {
      rootModuleName: state.occurrenceContext.rootModuleName || null,
      occurrencePath: [...(state.occurrenceContext.occurrencePath || [])]
    } : null,
    viewMode: normalizeSingleViewMode(state.viewMode),
    focusedRootNodeIds,
    activeFocusedRootNodeId: focusedRootNodeIds.includes(state.activeFocusedRootNodeId)
      ? state.activeFocusedRootNodeId : focusedRootNodeIds[0] || null,
    coneDepth: normalizeDepth(state.coneDepth, 3),
    faninDepth: normalizeDepth(state.faninDepth, 3),
    fanoutDepth: normalizeDepth(state.fanoutDepth, 3),
    selectedNodeId: state.selectedNodeId || null,
    selectedNet: state.selectedNet || null,
    transform: normalizeTransform(state.transform),
    presentationPolicy: state.presentationPolicy ? { ...state.presentationPolicy } : null,
    overrides: snapshotOverrides(state),
    compare: state.compare?.active ? {
      leftModuleName: state.compare.leftModuleName || null,
      rightModuleName: state.compare.rightModuleName || null,
      layout: state.compare.layout || "vertical",
      outputName: state.compare.outputName || null,
      wholeRequested: state.compare.wholeRequested === true,
      viewModes: {
        left: compareViewMode(state.compare, "left"),
        right: compareViewMode(state.compare, "right")
      },
      focusedRootNodeIds: {
        left: [...(state.compare.focusedRootNodeIds?.left || [])],
        right: [...(state.compare.focusedRootNodeIds?.right || [])]
      },
      activeFocusedRootNodeId: {
        left: state.compare.activeFocusedRootNodeId?.left || null,
        right: state.compare.activeFocusedRootNodeId?.right || null
      },
      focusedRootsSynchronized: state.compare.focusedRootsSynchronized !== false,
      selectedName: state.compare.selectedName || null,
      selectedKind: state.compare.selectedKind || null,
      selectedSide: state.compare.selectedSide || null,
      transforms: {
        left: normalizeTransform(state.compare.transforms?.left),
        right: normalizeTransform(state.compare.transforms?.right)
      },
      overrides: {
        left: snapshotSideOverrides(state.compare, "left"),
        right: snapshotSideOverrides(state.compare, "right")
      }
    } : null
  });
}

export function pushViewHistory(history, entry) {
  const current = history.entries?.[history.index];
  if (current && sameEntry(current, entry)) return cloneHistory(history);
  const limit = normalizeLimit(history.limit);
  const entries = [...(history.entries || []).slice(0, (history.index ?? -1) + 1), cloneEntry(entry)];
  const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries;
  return { entries: trimmed, index: trimmed.length - 1, limit };
}

export function replaceCurrentViewHistory(history, entry) {
  if (!history || history.index < 0) return cloneHistory(history);
  const entries = history.entries.map((item, index) => index === history.index ? cloneEntry(entry) : cloneEntry(item));
  return { entries, index: history.index, limit: normalizeLimit(history.limit) };
}

export function stepViewHistory(history, delta) {
  const direction = delta < 0 ? -1 : 1;
  const index = history.index + direction;
  if (index < 0 || index >= history.entries.length) return { history: cloneHistory(history), entry: null };
  return {
    history: { entries: history.entries.map(cloneEntry), index, limit: normalizeLimit(history.limit) },
    entry: cloneEntry(history.entries[index])
  };
}

export function canStepViewHistory(history, delta) {
  return Boolean(stepViewHistory(history, delta).entry);
}

function sameEntry(left, right) {
  return JSON.stringify(stripEntryMetadata(left)) === JSON.stringify(stripEntryMetadata(right));
}

function stripEntryMetadata(entry = {}) {
  const { transactionId, label, affectedSessionIds, ...viewState } = entry;
  return viewState;
}

function cloneHistory(history = createViewHistory()) {
  return {
    entries: (history.entries || []).map(cloneEntry),
    index: Number.isInteger(history.index) ? history.index : -1,
    limit: normalizeLimit(history.limit)
  };
}

function cloneEntry(entry = {}) {
  const roots = normalizeFocusedRootNodeIds(entry.focusedRootNodeIds, entry.coneRootNodeId);
  return {
    kind: entry.kind === "compare" ? "compare" : "single",
    transactionId: entry.transactionId || null,
    label: entry.label || null,
    affectedSessionIds: Array.isArray(entry.affectedSessionIds) ? [...entry.affectedSessionIds] : [],
    moduleName: entry.moduleName || null,
    occurrenceContext: entry.occurrenceContext ? {
      rootModuleName: entry.occurrenceContext.rootModuleName || null,
      occurrencePath: Array.isArray(entry.occurrenceContext.occurrencePath)
        ? [...entry.occurrenceContext.occurrencePath] : []
    } : null,
    viewMode: normalizeSingleViewMode(entry.viewMode),
    focusedRootNodeIds: [...roots],
    activeFocusedRootNodeId: roots.includes(entry.activeFocusedRootNodeId) ? entry.activeFocusedRootNodeId : roots[0] || null,
    coneDepth: normalizeDepth(entry.coneDepth, 3),
    faninDepth: normalizeDepth(entry.faninDepth, 3),
    fanoutDepth: normalizeDepth(entry.fanoutDepth, 3),
    selectedNodeId: entry.selectedNodeId || null,
    selectedNet: entry.selectedNet || null,
    transform: normalizeTransform(entry.transform),
    presentationPolicy: entry.presentationPolicy ? { ...entry.presentationPolicy } : null,
    overrides: cloneOverrides(entry.overrides),
    compare: entry.compare ? {
      leftModuleName: entry.compare.leftModuleName || null,
      rightModuleName: entry.compare.rightModuleName || null,
      layout: entry.compare.layout === "horizontal" ? "horizontal" : "vertical",
      outputName: entry.compare.outputName || null,
      wholeRequested: entry.compare.wholeRequested === true,
      viewModes: {
        left: normalizeCompareViewMode(entry.compare.viewModes?.left, entry.compare, "left"),
        right: normalizeCompareViewMode(entry.compare.viewModes?.right, entry.compare, "right")
      },
      focusedRootNodeIds: {
        left: [...(entry.compare.focusedRootNodeIds?.left || [])],
        right: [...(entry.compare.focusedRootNodeIds?.right || [])]
      },
      activeFocusedRootNodeId: {
        left: entry.compare.activeFocusedRootNodeId?.left || null,
        right: entry.compare.activeFocusedRootNodeId?.right || null
      },
      focusedRootsSynchronized: entry.compare.focusedRootsSynchronized !== false,
      selectedName: entry.compare.selectedName || null,
      selectedKind: entry.compare.selectedKind || null,
      selectedSide: entry.compare.selectedSide || null,
      transforms: {
        left: normalizeTransform(entry.compare.transforms?.left),
        right: normalizeTransform(entry.compare.transforms?.right)
      },
      overrides: {
        left: cloneOverrides(entry.compare.overrides?.left),
        right: cloneOverrides(entry.compare.overrides?.right)
      }
    } : null
  };
}

function snapshotOverrides(state) {
  return {
    nodePositions: [...(state.nodePositions || new Map()).entries()].map(([id, value]) => [id, { ...value }]),
    nodeSizes: [...(state.nodeSizes || new Map()).entries()].map(([id, value]) => [id, { ...value }]),
    graphOverrides: cloneGraphOverrides(state.graphOverrides)
  };
}

function snapshotSideOverrides(compare, side) {
  return {
    nodePositions: [...(compare.nodePositions?.[side] || new Map()).entries()].map(([id, value]) => [id, { ...value }]),
    nodeSizes: [...(compare.nodeSizes?.[side] || new Map()).entries()].map(([id, value]) => [id, { ...value }]),
    graphOverrides: cloneGraphOverrides(compare.graphOverrides?.[side])
  };
}

function cloneOverrides(value = {}) {
  return {
    nodePositions: (value.nodePositions || []).map(([id, item]) => [id, { ...item }]),
    nodeSizes: (value.nodeSizes || []).map(([id, item]) => [id, { ...item }]),
    graphOverrides: cloneGraphOverrides(value.graphOverrides)
  };
}

function cloneGraphOverrides(value = {}) {
  return {
    nodeProperties: Object.fromEntries(Object.entries(value.nodeProperties || {}).map(([id, item]) => [id, { ...item }])),
    cellPinDirections: Object.fromEntries(Object.entries(value.cellPinDirections || {}).map(([id, item]) => [id, { ...item }]))
  };
}

function normalizeLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : DEFAULT_VIEW_HISTORY_LIMIT;
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

function compareViewMode(compare, side) {
  if (compare.focusedRootNodeIds?.[side]?.length) return "focused";
  if (compare.outputName) return "fanin";
  return "whole";
}

function normalizeCompareViewMode(value, compare, side) {
  if (["whole", "focused", "fanin", "search-first"].includes(value)) return value;
  return compareViewMode(compare, side);
}
