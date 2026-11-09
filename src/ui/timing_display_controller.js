const ALL_BASIC_METRICS = Object.freeze(["at", "rt", "slack"]);
const METRICS = new Set(["at", "rt", "slack", "delay", "slew"]);

export function createTimingDisplayController({ elements, getPolicy, onCommit }) {
  if (typeof getPolicy !== "function" || typeof onCommit !== "function") {
    throw new Error("Timing display controller requires query and command ports");
  }
  function read() {
    const val = elements.metricSelect.value;
    if (val === "none") {
      return normalizeTimingDisplayPolicy({ metrics: [] });
    }
    return normalizeTimingDisplayPolicy({
      metrics: val === "all" ? [...ALL_BASIC_METRICS] : [val]
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
    if (!policy.metrics || policy.metrics.length === 0) {
      elements.metricSelect.value = "none";
    } else if (policy.metrics.length >= ALL_BASIC_METRICS.length) {
      elements.metricSelect.value = "all";
    } else {
      elements.metricSelect.value = policy.metrics[0];
    }
  }
  elements.metricSelect.addEventListener("change", commit);
  return Object.freeze({ read, commit, sync });
}

export function normalizeTimingDisplayPolicy(value = {}) {
  const rawMetrics = Array.isArray(value?.metrics)
    ? value.metrics
    : (value?.metrics ? [value.metrics] : []);
  if (Array.isArray(value?.metrics) && value.metrics.length === 0) {
    return Object.freeze({ metrics: Object.freeze([]) });
  }
  if (rawMetrics.includes("none")) {
    return Object.freeze({ metrics: Object.freeze([]) });
  }
  const metrics = [...new Set(rawMetrics.filter((metric) => METRICS.has(metric)))];
  return Object.freeze({ metrics: Object.freeze(metrics.length ? metrics : ["slack"]) });
}
