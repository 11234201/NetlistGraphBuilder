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

export function createMatchDiagnostics(timing, context, cellsNamedInPoint) {
  const scopeKeys = Object.keys(timing.scopes || {});
  const byCell = new Map();
  function note(nodeId, reason, sample, count = 1) {
    if (!byCell.has(nodeId)) byCell.set(nodeId, {});
    const reasons = byCell.get(nodeId);
    if (!Object.hasOwn(reasons, reason)) reasons[reason] = { count: 0, ...sample() };
    reasons[reason].count += count;
    return reasons[reason];
  }
  function notePoint(reason, record, extra, includeNetAndPort = false) {
    if (!record.point || (!includeNetAndPort && (record.kind === "net" || record.kind === "port"))) return;
    for (const { node } of cellsNamedInPoint(record.point)) {
      note(node.id, reason, () => ({ ...timingPointSample(record, timing.fileName), ...extra }));
    }
  }
  for (const warning of timing.diagnostics || []) {
    if (warning.point) notePoint("parse-" + warning.code, warning, { field: warning.field });
  }
  const details = {
    fileName: timingNameSample(timing.fileName) || null,
    reportRecordCount: timing.records?.length || 0,
    reportScopeCount: scopeKeys.length,
    reportScopes: scopeKeys.slice(0, TIMING_SAMPLE_LIMIT).map(timingNameSample),
    targetModule: timingNameSample(context.normModule),
    occurrenceRoot: timingNameSample(context.explicitRootModuleName) || null,
    occurrencePath: timingNameSample(context.explicitPathSegments.join("/")) || null,
    excludedReasons: {}, excludedExamples: [], unmatchedExamples: [],
    ambiguousGroupCount: 0, ambiguousExamples: [], unresolvedPins: { reasons: {}, examples: [] },
    cellCount: 0, annotatedCellCount: 0, cellsWithoutTiming: []
  };
  return {
    details,
    byCell,
    exclude(reason, records, expectedPrefix) {
      const bulk = Array.isArray(records);
      const count = bulk ? records.length : 1;
      if (!count) return;
      const record = bulk ? records[0] : records;
      details.excludedReasons[reason] = (details.excludedReasons[reason] || 0) + count;
      const extra = { expectedPrefix: timingNameSample(expectedPrefix) || null };
      if (bulk) {
        for (const row of records) notePoint(reason, row, extra);
      } else notePoint(reason, record, extra);
      if (details.excludedExamples.length < TIMING_SAMPLE_LIMIT) {
        details.excludedExamples.push({ ...timingPointSample(record, timing.fileName), reason, ...extra });
      }
    },
    otherTarget(record, kind) {
      notePoint(kind + "-candidate", record, {}, true);
    },
    unmatched(record, candidates) {
      const childBoundary = candidates.find((candidate) => candidate.childBoundary)?.childBoundary;
      const extra = { candidates: candidates.slice(0, TIMING_SAMPLE_LIMIT).map(({ text }) => timingNameSample(text)) };
      if (childBoundary) extra.childBoundary = timingNameSample(childBoundary);
      notePoint(childBoundary ? "child-instance-boundary" : "no-matching-object", record, extra);
      if (details.unmatchedExamples.length < TIMING_SAMPLE_LIMIT) {
        details.unmatchedExamples.push({ ...timingPointSample(record, timing.fileName), ...extra });
      }
    },
    ambiguous(instance, paths) {
      details.ambiguousGroupCount++;
      if (details.ambiguousExamples.length < TIMING_SAMPLE_LIMIT) {
        details.ambiguousExamples.push({ instance: timingNameSample(instance), paths: paths.map(timingNameSample) });
      }
    },
    unresolvedGroup(reason, group, affectedCells) {
      const { reasons, examples } = details.unresolvedPins;
      reasons[reason] = (reasons[reason] || 0) + group.recordCount;
      if (examples.length < TIMING_SAMPLE_LIMIT) examples.push({ reason, ...timingPointSample(group.firstRecord, timing.fileName) });
      for (const { node } of affectedCells) {
        const evidence = note(node.id, reason, () => ({ ...timingPointSample(group.firstRecord, timing.fileName), paths: [] }), group.recordCount);
        if (evidence.paths.length < TIMING_SAMPLE_LIMIT) evidence.paths.push(timingNameSample(group.fullPath));
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

export function missingCellTimingDetails(node, summary) {
  if (node?.kind !== "cell" || node.timing || !summary?.diagnostics) return null;
  const { targetModule, fileName, occurrenceRoot, occurrencePath, hierarchyDepthLimitReached, hierarchyVisitLimitReached } = summary.diagnostics;
  let outcome = "no-resolved-point";
  if (summary.ambiguousOccurrenceCount) outcome = "ambiguous-module-occurrence";
  else if (!summary.scopedRecordCount) outcome = "no-applicable-records";
  return { outcome, instance: timingNameSample(node.ref?.instance || node.id), targetModule, fileName, occurrenceRoot,
    occurrencePath, occurrenceExamples: summary.occurrenceExamples, hierarchyDepthLimitReached, hierarchyVisitLimitReached,
    scopedRecordCount: summary.scopedRecordCount, evidence: node.timingMatchEvidence || {} };
}
