import { parseTimingLog } from "../timing/timingParser.js";

export function importTimingSource(text, options = {}) {
  if (typeof text !== "string") throw new Error("Timing source must be text");
  const timing = parseTimingLog(text);
  const recordCount = timing.scopeCount || timing.instanceCount || 0;
  if (recordCount === 0) throw new Error("no timing scope or instance record was recognized");
  return Object.freeze({
    timing,
    source: Object.freeze({ name: String(options.name || "timing"), kind: "text", size: text.length }),
    summary: Object.freeze({
      recordCount,
      format: timing.format,
      diagnosticCount: timing.diagnostics?.length || 0
    })
  });
}
