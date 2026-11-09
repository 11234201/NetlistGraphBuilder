const ALL_BASIC_METRICS = Object.freeze(["at", "rt", "slack"]);
const METRICS = new Set(["at", "rt", "slack", "delay", "slew"]);

export function createTimingDisplayController({ elements, getPolicy, onCommit }) {
  if (typeof getPolicy !== "function" || typeof onCommit !== "function") {
    throw new Error("Timing display controller requires query and command ports");
  }
  function read() {
    return normalizeTimingDisplayPolicy({
      metrics: elements.metricSelect.value === "all" ? [...ALL_BASIC_METRICS] : [elements.metricSelect.value]
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
    elements.metricSelect.value = policy.metrics.length >= ALL_BASIC_METRICS.length ? "all" : policy.metrics[0];
  }
  elements.metricSelect.addEventListener("change", commit);
  return Object.freeze({ read, commit, sync });
}

export function normalizeTimingDisplayPolicy(value = {}) {
  const metrics = [...new Set((Array.isArray(value?.metrics) ? value.metrics : [value?.metrics])
    .filter((metric) => METRICS.has(metric)))];
  return Object.freeze({ metrics: Object.freeze(metrics.length ? metrics : ["slack"]) });
}
