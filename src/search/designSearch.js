export const SEARCH_RESULT_LIMIT = 24;

export function buildDesignSearchIndex(design) {
  const entries = [];
  for (const module of design?.modules || []) {
    const moduleName = module.name;
    const moduleLabel = module.displayName || module.name;
    entries.push(createEntry({
      id: `module:${moduleName}`,
      kind: "module",
      moduleName,
      label: moduleLabel,
      detail: "module",
      target: { kind: "module", name: moduleName }
    }));

    for (const port of module.ports) {
      entries.push(createEntry({
        id: `port:${moduleName}:${port.name}`,
        kind: "port",
        moduleName,
        label: port.displayName || port.name,
        detail: port.direction,
        target: { kind: "port", name: port.name, direction: port.direction }
      }));
    }

    for (const net of module.nets) {
      entries.push(createEntry({
        id: `net:${moduleName}:${net.name}`,
        kind: "net",
        moduleName,
        label: net.displayName || net.name,
        detail: net.declaredKind,
        target: { kind: "net", name: net.name }
      }));
    }

    for (const cell of module.cells) {
      entries.push(createEntry({
        id: `cell:${moduleName}:${cell.instance}`,
        kind: "instance",
        moduleName,
        label: cell.instanceDisplayName || cell.instance,
        detail: cell.typeDisplayName || cell.type,
        target: { kind: "cell", name: cell.instance }
      }));
    }
  }
  return entries;
}

export function searchDesignIndex(index, query, limit = SEARCH_RESULT_LIMIT) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  return (index || [])
    .map((entry) => ({ entry, rank: rankEntry(entry, normalizedQuery) }))
    .filter(({ rank }) => Number.isFinite(rank))
    .toSorted((left, right) =>
      left.rank - right.rank ||
      KIND_ORDER[left.entry.kind] - KIND_ORDER[right.entry.kind] ||
      left.entry.normalizedLabel.localeCompare(right.entry.normalizedLabel)
    )
    .slice(0, Math.max(1, Number(limit) || SEARCH_RESULT_LIMIT))
    .map(({ entry }) => entry);
}

const KIND_ORDER = Object.freeze({
  module: 0,
  port: 1,
  net: 2,
  instance: 3
});

function createEntry(entry) {
  return {
    ...entry,
    normalizedLabel: normalizeSearchText(entry.label),
    normalizedDetail: normalizeSearchText(entry.detail),
    normalizedModule: normalizeSearchText(entry.moduleName)
  };
}

function rankEntry(entry, query) {
  if (entry.normalizedLabel === query) {
    return 0;
  }
  if (entry.normalizedLabel.startsWith(query)) {
    return 1;
  }
  if (entry.normalizedDetail === query) {
    return 2;
  }
  if (entry.normalizedDetail.startsWith(query)) {
    return 3;
  }
  if (entry.normalizedLabel.includes(query)) {
    return 4;
  }
  if (entry.normalizedDetail.includes(query)) {
    return 5;
  }
  if (entry.normalizedModule.includes(query)) {
    return 6;
  }
  return Number.POSITIVE_INFINITY;
}

function normalizeSearchText(value) {
  return String(value || "")
    .replaceAll("\\", "")
    .trim()
    .toLocaleLowerCase();
}
