export function defaultPanels() {
  return { navigator: { tab: "design", type: "ports", query: "", analysisFilter: "all", sort: "name", page: 0 },
    inspector: { tab: "connections", page: 0 }, analysis: { category: "reconvergence", type: "all", page: 0, detailPage: 0, selectedId: null } };
}
export function normalizePanels(value) {
  const defaults = defaultPanels();
  return { navigator: { ...defaults.navigator, ...value?.navigator }, inspector: { ...defaults.inspector, ...value?.inspector },
    analysis: { ...defaults.analysis, ...value?.analysis } };
}
