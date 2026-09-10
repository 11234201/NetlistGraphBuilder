const SNAPSHOTS = new Set(["auto", "global", "local"]);
const METRICS = new Set(["at", "rt", "slack"]);

export function createTimingDisplayController({ elements, getPolicy, onCommit }) {
  if (typeof getPolicy !== "function" || typeof onCommit !== "function") {
    throw new Error("Timing display controller requires query and command ports");
  }
  function read() {
    const current = normalizeTimingDisplayPolicy(getPolicy());
    return normalizeTimingDisplayPolicy({
      snapshot: elements.snapshotSelect.value || current.snapshot,
      metrics: elements.metricSelect.value === "all" ? [...METRICS] : [elements.metricSelect.value]
    });
  }
  function commit() {
    const policy = read();
    onCommit(policy);
    sync(policy);
    return policy;
  }
  function sync(value = getPolicy()) {
    const policy = normalizeTimingDisplayPolicy(value);
    elements.snapshotSelect.value = policy.snapshot;
    elements.metricSelect.value = policy.metrics.length === METRICS.size ? "all" : policy.metrics[0];
  }
  elements.snapshotSelect.addEventListener("change", commit);
  elements.metricSelect.addEventListener("change", commit);
  return Object.freeze({ read, commit, sync });
}

export function normalizeTimingDisplayPolicy(value = {}) {
  const snapshot = SNAPSHOTS.has(value.snapshot) ? value.snapshot : "auto";
  const metrics = [...new Set((Array.isArray(value.metrics) ? value.metrics : [value.metrics])
    .filter((metric) => METRICS.has(metric)))];
  return Object.freeze({ snapshot, metrics: Object.freeze(metrics.length ? metrics : ["slack"]) });
}
