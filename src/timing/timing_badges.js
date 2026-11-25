import { getNodeInstance, getLeafDisplayNameOrPort, normalizePinName } from "./timing_names.js";

export const TIMING_BADGE_POSITIONS = Object.freeze([
  "bottom-right",
  "top-right",
  "bottom-left",
  "top-left"
]);

export const TIMING_METRICS = Object.freeze(["at", "rt", "slack", "delay", "slew"]);
export const DEFAULT_TIMING_DISPLAY_POLICY = Object.freeze({
  metrics: Object.freeze(["slack"]),
  threshold: 0.0
});

const BADGE_POSITION_SET = new Set(TIMING_BADGE_POSITIONS);
const TIMING_METRIC_SET = new Set(TIMING_METRICS);

export function normalizeTimingDisplayPolicy(policy = DEFAULT_TIMING_DISPLAY_POLICY) {
  const rawMetrics = Array.isArray(policy?.metrics)
    ? policy.metrics
    : (policy?.metrics ? [policy.metrics] : []);
  const rawThreshold = policy?.threshold !== undefined ? Number(policy.threshold) : DEFAULT_TIMING_DISPLAY_POLICY.threshold;
  const threshold = Number.isFinite(rawThreshold) ? rawThreshold : 0.0;
  if (Array.isArray(policy?.metrics) && policy.metrics.length === 0) {
    return { metrics: Object.freeze([]), threshold };
  }
  if (rawMetrics.includes("none")) {
    return { metrics: Object.freeze([]), threshold };
  }
  const metrics = [...new Set(rawMetrics.filter((metric) => TIMING_METRIC_SET.has(metric)))];
  return {
    metrics: metrics.length ? metrics : [...DEFAULT_TIMING_DISPLAY_POLICY.metrics],
    threshold
  };
}

export function normalizeBadgeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices;
  }
  return choices ? [choices] : [];
}

export function createPortTimingObject(node, record, unit, stage) {
  const pinName = getLeafDisplayNameOrPort(node);
  const pinEntry = {
    pin: pinName,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    sourceKind: record.sourceKind || "port",
    sourceNet: record.sourceNet || null
  };
  const metrics = {};
  for (const metric of TIMING_METRICS) {
    if (Number.isFinite(record[metric])) {
      metrics[metric] = record[metric];
    }
  }
  return {
    instance: getNodeInstance(node),
    fullPath: record.point || pinName,
    unit,
    stage,
    at: record.at,
    rt: record.rt,
    slack: record.slack,
    slackDerived: Boolean(record.slackDerived),
    delay: record.delay ?? null,
    slew: record.slew ?? null,
    edge: record.edge ?? null,
    metrics,
    pins: {
      [pinName]: pinEntry
    },
    worstPin: Number.isFinite(record.slack) ? pinName : null,
    worstSlack: Number.isFinite(record.slack) ? record.slack : null,
    sourceKind: record.sourceKind || "port",
    sourceNet: record.sourceNet || null
  };
}

export function summarizePins(pins) {
  let worstPin = null;
  let worstSlack = null;
  for (const pin of Object.values(pins)) {
    if (!Number.isFinite(pin.slack)) continue;
    if (
      worstSlack === null ||
      pin.slack < worstSlack ||
      (pin.slack === worstSlack && String(pin.pin).localeCompare(String(worstPin)) < 0)
    ) {
      worstPin = pin.pin;
      worstSlack = pin.slack;
    }
  }
  return { worstPin, worstSlack };
}

export function annotateTimingBadges(timing, choices, position, node, policy) {
  const requestedChoices = choices === undefined
    ? getDefaultBadgeChoices(timing, node, policy)
    : normalizeBadgeChoices(choices);
  const badges = requestedChoices
    .map((choice) => resolveBadgeChoice(timing, choice))
    .filter(Boolean);
  const threshold = Number.isFinite(policy?.threshold) ? policy.threshold : 0.0;
  const worstSlack = Number.isFinite(timing.worstSlack) ? timing.worstSlack : timing.slack;
  const isCritical = Number.isFinite(worstSlack) && worstSlack < threshold;
  const pins = timing.pins ? { ...timing.pins } : {};
  for (const [pinName, pinData] of Object.entries(pins)) {
    pins[pinName] = {
      ...pinData,
      isCritical: Number.isFinite(pinData.slack) && pinData.slack < threshold
    };
  }
  return {
    ...timing,
    pins,
    slackThreshold: threshold,
    isCritical,
    badges,
    badge: badges[0] || null,
    badgePosition: BADGE_POSITION_SET.has(position) ? position : "bottom-right"
  };
}

function getDefaultBadgeChoices(timing, node, policy) {
  const policyMetrics = policy?.metrics !== undefined ? policy.metrics : DEFAULT_TIMING_DISPLAY_POLICY.metrics;
  if (!policyMetrics || policyMetrics.length === 0) {
    return [];
  }
  const isCustomPolicy =
    policyMetrics.length !== 1 || policyMetrics[0] !== "slack";

  if (node?.kind === "input" || node?.kind === "output") {
    const pinNames = Object.keys(timing.pins || {});
    const choices = [];
    for (const pin of pinNames) {
      for (const metric of policyMetrics) {
        choices.push({ pin, metric });
      }
      for (const extra of ["delay", "slew"]) {
        if (Number.isFinite(timing.pins[pin]?.[extra]) && !policyMetrics.includes(extra)) {
          choices.push({ pin, metric: extra });
        }
      }
    }
    return choices;
  }

  if (node?.gateKind === "module") {
    const pinKeys = Object.keys(timing.pins || {});
    if (pinKeys.length === 0) return [];
    const focusPin = timing.worstPin || getOrderedTimingPins(timing, node)[0];
    if (!isCustomPolicy) {
      const choices = [];
      if (Number.isFinite(timing.pins[focusPin]?.at)) choices.push({ pin: focusPin, metric: "at" });
      if (Number.isFinite(timing.pins[focusPin]?.slack)) choices.push({ pin: focusPin, metric: "slack" });
      if (choices.length > 0) return choices;
      const firstMetric = TIMING_METRICS.find((m) => Number.isFinite(timing.pins[focusPin]?.[m])) || "slack";
      return [{ pin: focusPin, metric: firstMetric }];
    }
    if (pinKeys.length > 6) {
      return policyMetrics.map((metric) => ({ pin: focusPin, metric }));
    }
    return getOrderedTimingPins(timing, node).flatMap((pin) =>
      policyMetrics.map((metric) => ({ pin, metric }))
    );
  }

  if (isCustomPolicy) {
    const orderedPins = getOrderedTimingPins(timing, node);
    return orderedPins.flatMap((pin) =>
      policyMetrics.map((metric) => ({ pin, metric }))
    );
  }

  const choices = findInputTimingPins(timing, node).map((pin) => ({
    pin,
    metric: "at"
  }));
  const outputPin = findOutputTimingPin(timing, node);
  if (outputPin) {
    choices.push(
      { pin: outputPin, metric: "at" },
      { pin: outputPin, metric: "slack" }
    );
  }
  if (choices.length > 0) {
    return choices;
  }
  if (timing.worstPin) {
    return [{ pin: timing.worstPin, metric: "slack" }];
  }
  const firstPin = Object.keys(timing.pins || {})[0];
  if (firstPin) {
    const firstMetric = TIMING_METRICS.find((m) => Number.isFinite(timing.pins[firstPin]?.[m])) || "slack";
    return [{ pin: firstPin, metric: firstMetric }];
  }
  return [];
}

function getOrderedTimingPins(timing, node) {
  const ordered = new Set();
  for (const pin of node?.ref?.pins || []) {
    const resolved = findTimingPin(timing, pin);
    if (resolved) ordered.add(resolved);
  }
  for (const pin of Object.keys(timing.pins || {})) ordered.add(pin);
  return [...ordered];
}

function findInputTimingPins(timing, node) {
  const pins = [];
  for (const pin of node?.ref?.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const direction = node.pinDirections?.[displayName]?.direction || node.pinDirections?.[pin.pin]?.direction;
    if (direction !== "input") {
      continue;
    }
    const timingPin = findTimingPin(timing, pin);
    if (timingPin) {
      pins.push(timingPin);
    }
  }
  return pins;
}

function findOutputTimingPin(timing, node) {
  for (const pin of node?.ref?.pins || []) {
    const displayName = pin.pinDisplayName || pin.pin;
    const direction = node.pinDirections?.[displayName]?.direction || node.pinDirections?.[pin.pin]?.direction;
    if (direction !== "output") {
      continue;
    }
    const timingPin = findTimingPin(timing, pin);
    if (timingPin) {
      return timingPin;
    }
  }
  return null;
}

function findTimingPin(timing, pin) {
  if (!timing.pins) return null;
  for (const raw of [pin.pinDisplayName, pin.pin]) {
    const key = normalizePinName(raw);
    if (key && Object.hasOwn(timing.pins, key)) return key;
  }
  return null;
}

function resolveBadgeChoice(timing, choice) {
  const pin = timing.pins?.[choice?.pin];
  const metric = choice?.metric;
  if (!pin || !TIMING_METRIC_SET.has(metric) || !Number.isFinite(pin[metric])) {
    return null;
  }
  return {
    pin: pin.pin,
    metric,
    value: pin[metric],
    label: `${pin.pin} ${metric} ${formatTimingValue(pin[metric])}`
  };
}

function formatTimingValue(value) {
  return Number(value).toFixed(3);
}
