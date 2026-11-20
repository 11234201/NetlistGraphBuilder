import { mergeTimingDatasets, parseTimingLog } from "../../timing/timingParser.js";
import { TIMING_SAMPLE_LIMIT, timingNameSample } from "../../timing/timing_diagnostics.js";

export function importTimingSource(text, options = {}) {
  if (typeof text !== "string") throw new Error("Timing source must be text");
  const fileName = String(options.name || "timing");
  const timing = { ...parseTimingLog(text), fileName };
  const summary = summarizeTimingDataset(timing);
  if (summary.recordCount === 0) {
    const error = new Error("no timing scope or instance record was recognized");
    error.diagnostic = summary;
    throw error;
  }
  return Object.freeze({
    timing,
    source: Object.freeze({ name: fileName, kind: "text", size: text.length }),
    summary
  });
}

export function summarizeTimingDataset(timing) {
  const recordCount = timing?.recordCount || timing?.instanceCount || 0;
  return Object.freeze({
    recordCount,
    scopeCount: timing?.scopeCount || 0,
    instanceCount: timing?.instanceCount || 0,
    format: timing?.format || "auto",
    stage: timing?.stage || "post_map",
    unit: timing?.unit || "ns",
    diagnosticCount: timing?.diagnostics?.length || 0,
    diagnosticExamples: (timing?.diagnostics || []).slice(0, TIMING_SAMPLE_LIMIT).map(
      ({ code, severity, line, column, field, point }) => ({
        code, severity, line, column, field, point: timingNameSample(point) || undefined
      })
    )
  });
}

export function mergeImportedTiming(existingTiming, nextTiming) {
  if (!existingTiming) return nextTiming || null;
  if (!nextTiming) return existingTiming;
  return mergeTimingDatasets([existingTiming, nextTiming]);
}
