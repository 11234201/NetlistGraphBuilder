const ALL_BASIC_METRICS = Object.freeze(["at", "rt", "slack"]);
const METRICS = new Set(["at", "rt", "slack", "delay", "slew"]);

export function createTimingDisplayController({ elements, getPolicy, onCommit }) {
  if (typeof getPolicy !== "function" || typeof onCommit !== "function") {
    throw new Error("Timing display controller requires query and command ports");
  }
  function read() {
    const val = elements.metricSelect?.value || "slack";
    const rawThreshold = elements.thresholdInput ? Number(elements.thresholdInput.value) : undefined;
    const threshold = Number.isFinite(rawThreshold) ? rawThreshold : (getPolicy()?.threshold ?? 0.0);
    if (val === "none") {
      return normalizeTimingDisplayPolicy({ metrics: [], threshold });
    }
    return normalizeTimingDisplayPolicy({
      metrics: val === "all" ? [...ALL_BASIC_METRICS] : [val],
      threshold
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
    if (elements.metricSelect) {
      if (!policy.metrics || policy.metrics.length === 0) {
        elements.metricSelect.value = "none";
      } else if (policy.metrics.length >= ALL_BASIC_METRICS.length) {
        elements.metricSelect.value = "all";
      } else {
        elements.metricSelect.value = policy.metrics[0];
      }
    }
    if (elements.thresholdInput) {
      elements.thresholdInput.value = Number.isFinite(policy.threshold) ? String(policy.threshold) : "0.0";
    }
  }
  elements.metricSelect?.addEventListener("change", commit);
  elements.thresholdInput?.addEventListener("change", commit);
  return Object.freeze({ read, commit, sync });
}

export function normalizeTimingDisplayPolicy(value = {}) {
  const rawMetrics = Array.isArray(value?.metrics)
    ? value.metrics
    : (value?.metrics ? [value.metrics] : []);
  const rawThreshold = value?.threshold !== undefined ? Number(value.threshold) : 0.0;
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : 0.0;
  if (Array.isArray(value?.metrics) && value.metrics.length === 0) {
    return Object.freeze({ metrics: Object.freeze([]), threshold });
  }
  if (rawMetrics.includes("none")) {
    return Object.freeze({ metrics: Object.freeze([]), threshold });
  }
  const metrics = [...new Set(rawMetrics.filter((metric) => METRICS.has(metric)))];
  return Object.freeze({
    metrics: Object.freeze(metrics.length ? metrics : ["slack"]),
    threshold
  });
}
