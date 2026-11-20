import { workspaceArtifactReference } from "./workspaceArtifactCache.js";

export function writeTimingLog(logProcess, level, message, details) {
  try { logProcess(level, "timing", message, details); return true; }
  catch { return false; }
}

export function createTimingMatchReporter() {
  const lastBySession = new Map();
  return (logProcess, graph, timing, { document, side = null, requestId }) => {
    const sessionId = side ? `compare:${side}` : "single";
    const summary = graph?.timingSummary;
    const diagnostics = summary?.diagnostics;
    if (!diagnostics || !timing) {
      lastBySession.delete(sessionId);
      return;
    }
    const { scopedRecordCount, matchedRecordCount, unmatchedRecordCount, ambiguousOccurrenceCount = 0, occurrenceExamples } = summary;
    const details = {
      operation: "timing.match", view: side ? "compare" : "single", side, sessionId,
      documentId: document?.documentId, documentRevision: document?.sourceRevision,
      moduleName: graph.moduleName, scopedRecordCount, excludedRecordCount: diagnostics.reportRecordCount - scopedRecordCount,
      matchedRecordCount, unmatchedRecordCount, candidateMatchedRecordCount: summary.candidateMatchedRecordCount,
      ambiguousOccurrenceCount, occurrenceExamples, ...diagnostics
    };
    // Artifact snapshots can be cloned on a redraw. Compare the bounded outcome
    // and the identity of the imported dataset, independent of render request ID.
    const key = JSON.stringify([workspaceArtifactReference(timing), details]);
    if (lastBySession.get(sessionId) === key) return;
    let code = "timing.matched";
    let outcome = "Selected timing points matched";
    let level = "info";
    if (ambiguousOccurrenceCount) {
      code = "timing.ambiguous-occurrence";
      outcome = "Multiple instances matched the module";
      level = "warning";
    } else if (diagnostics.hierarchyVisitLimitReached || diagnostics.hierarchyDepthLimitReached) {
      code = "timing.hierarchy-limit";
      outcome = "Hierarchy search reached its limit";
      level = "warning";
    } else if (diagnostics.excludedReasons?.["ambiguous-root-path"]) {
      code = "timing.ambiguous-root-path";
      outcome = "A relative timing path has multiple possible roots";
      level = "warning";
    } else if (!scopedRecordCount) {
      code = "timing.no-applicable-records";
      outcome = "No points selected for this module and instance path";
    } else if (diagnostics.ambiguousGroupCount || unmatchedRecordCount) {
      code = "timing.partial-match";
      outcome = "Timing points unresolved";
      level = "warning";
    } else if (diagnostics.annotatedCellCount < diagnostics.cellCount) {
      code = "timing.partial-coverage";
      outcome = "Selected points matched with partial cell coverage";
    }
    const coverage = `${diagnostics.annotatedCellCount}/${diagnostics.cellCount} cells annotated`;
    if (writeTimingLog(logProcess, level, `${outcome} (${side ? side + " / " : ""}${graph.moduleName}, ${coverage})`,
      { code, requestId, ...details })) lastBySession.set(sessionId, key);
  };
}
