export const DEFAULT_VIEW_HISTORY_LIMIT = 128;

export function createViewHistory(limit = DEFAULT_VIEW_HISTORY_LIMIT) {
  return {
    entries: [],
    index: -1,
    limit: normalizeLimit(limit)
  };
}

export function createHistoryOperations(cloneEntry, sameEntry) {
  function pushViewHistory(history, entry) {
    const current = history.entries?.[history.index];
    if (current && sameEntry(current, entry)) return cloneHistory(history);
    const limit = normalizeLimit(history.limit);
    const entries = [...(history.entries || []).slice(0, (history.index ?? -1) + 1), cloneEntry(entry)];
    const trimmed = entries.length > limit ? entries.slice(entries.length - limit) : entries;
    return { entries: trimmed, index: trimmed.length - 1, limit };
  }

  function replaceCurrentViewHistory(history, entry) {
    if (!history || history.index < 0) return cloneHistory(history);
    const entries = history.entries.map((item, index) => index === history.index ? cloneEntry(entry) : cloneEntry(item));
    return { entries, index: history.index, limit: normalizeLimit(history.limit) };
  }

  function stepViewHistory(history, delta) {
    const direction = delta < 0 ? -1 : 1;
    const index = history.index + direction;
    if (index < 0 || index >= history.entries.length) return { history: cloneHistory(history), entry: null };
    return {
      history: { entries: history.entries.map(cloneEntry), index, limit: normalizeLimit(history.limit) },
      entry: cloneEntry(history.entries[index])
    };
  }

  function canStepViewHistory(history, delta) {
    return Boolean(stepViewHistory(history, delta).entry);
  }

  function cloneHistory(history = createViewHistory()) {
    return {
      entries: (history.entries || []).map(cloneEntry),
      index: Number.isInteger(history.index) ? history.index : -1,
      limit: normalizeLimit(history.limit)
    };
  }

  return { pushViewHistory, replaceCurrentViewHistory, stepViewHistory, canStepViewHistory };
}

function normalizeLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : DEFAULT_VIEW_HISTORY_LIMIT;
}
