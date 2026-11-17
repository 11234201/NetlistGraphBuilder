export const AIG_STRUCTURE_VERSION = 1;

// Work counters, not wall time, determine coverage and deterministic truncation.
const limits = Object.freeze({
  blockWork: [8000000, 1, 32000000], reconvergenceWork: [8000000, 1, 32000000],
  cutsPerNode: [16, 1, 32], cachedCuts: [250000, 1, 1000000],
  blockNodes: [32, 3, 64], results: [2000, 1, 10000],
  reachNodes: [4096, 4, 20000], witnessItems: [200000, 4, 1000000],
  detailWork: [2000000, 1, 8000000], detailNodes: [20000, 4, 100000],
  workerTimeoutMs: [15000, 100, 60000]
});

export function normalizeStructurePolicy(value = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(limits).map(([key, [fallback, minimum, maximum]]) => {
    const number = Number(value[key]);
    return [key, Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.floor(number))) : fallback];
  })));
}

export function createStructureBudget(maximum) {
  let used = 0;
  const reasons = new Set();
  return {
    spend(amount = 1) { used += amount; if (used > maximum) { reasons.add("work-limit"); return false; } return true; },
    limit(reason) { reasons.add(reason); },
    get exhausted() { return used > maximum; },
    snapshot() { return { status: reasons.size ? "partial" : "complete", work: Math.min(used, maximum), reasons: [...reasons].sort() }; }
  };
}
