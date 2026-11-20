// Keep report identifiers useful even when a generated hierarchy is very long.
export const TIMING_SAMPLE_LIMIT = 4;
export function timingNameSample(name) {
  const value = String(name ?? "");
  return value.length <= 240 ? value : value.slice(0, 112) + "…" + value.slice(-127);
}

function timingPointSample(record, fileName) {
  return { point: timingNameSample(record.point), scope: timingNameSample(record.module) || null,
    kind: record.kind || null, fileName: timingNameSample(record.fileName || fileName) || null, line: record.line ?? null };
}

export function createMatchDiagnostics(timing, context) {
  const scopeKeys = Object.keys(timing.scopes || {});
  const details = {
    fileName: timingNameSample(timing.fileName) || null,
    reportRecordCount: timing.records?.length || 0,
    reportScopeCount: scopeKeys.length,
    reportScopes: scopeKeys.slice(0, TIMING_SAMPLE_LIMIT).map(timingNameSample),
    targetModule: timingNameSample(context.normModule),
    occurrenceRoot: timingNameSample(context.explicitRootModuleName) || null,
    occurrencePath: timingNameSample(context.explicitPathSegments.join("/")) || null,
    excludedReasons: {}, excludedExamples: [], unmatchedExamples: [],
    ambiguousGroupCount: 0, ambiguousExamples: [],
    cellCount: 0, annotatedCellCount: 0, cellsWithoutTiming: []
  };
  return {
    details,
    exclude(reason, record, expectedPrefix, count = 1) {
      if (!count) return;
      details.excludedReasons[reason] = (details.excludedReasons[reason] || 0) + count;
      if (details.excludedExamples.length < TIMING_SAMPLE_LIMIT) {
        details.excludedExamples.push({ ...timingPointSample(record, timing.fileName), reason, expectedPrefix: timingNameSample(expectedPrefix) || null });
      }
    },
    unmatched(record, candidates) {
      if (details.unmatchedExamples.length < TIMING_SAMPLE_LIMIT) {
        details.unmatchedExamples.push({ ...timingPointSample(record, timing.fileName),
          candidates: candidates.slice(0, TIMING_SAMPLE_LIMIT).map(({ text }) => timingNameSample(text)) });
      }
    },
    ambiguous(instance, paths) {
      details.ambiguousGroupCount++;
      if (details.ambiguousExamples.length < TIMING_SAMPLE_LIMIT) {
        details.ambiguousExamples.push({ instance: timingNameSample(instance), paths: paths.map(timingNameSample) });
      }
    },
    summarizeCells(nodes, cellTiming) {
      for (const node of nodes) {
        if (node.kind !== "cell") continue;
        details.cellCount++;
        if (cellTiming?.has(node.id)) details.annotatedCellCount++;
        else if (details.cellsWithoutTiming.length < TIMING_SAMPLE_LIMIT) {
          details.cellsWithoutTiming.push(timingNameSample(node.ref?.instance || node.id));
        }
      }
    }
  };
}
