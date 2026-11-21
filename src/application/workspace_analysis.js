import { errorMessage, readErrorField } from "../foundation/log_details.js";

// Optional domain contribution: job scheduling and lifetime are shared, while
// result meaning and algorithms remain in the domain feature.
export function createWorkspaceAnalysis({ jobs, onChange = () => {}, logProcess, schedule = (callback) => setTimeout(callback, 0) }) {
  let workspace = null, service = null, job = null, detailJob = null, generation = 0;
  let state = { status: "idle", data: null, detail: null, detailStatus: "idle" };
  const detailCache = new Map();
  function publish(next) { state = { ...state, ...next }; onChange(state); }
  function cancelWork() { generation++; job?.cancel(); detailJob?.cancel(); job = null; detailJob = null; }
  function bind(next) {
    if (workspace === next) return;
    const same = workspace?.document === next?.document && workspace?.analysisScopeId === next?.analysisScopeId;
    // A scoped job reads a fixed topology. A geometry revision in the same
    // session cannot change it; a new scope or session still cancels the job.
    if (same && next?.analysisScopeId && workspace.sessionId === next.sessionId) return;
    cancelWork();
    if (!same) { service?.dispose(); service = null; detailCache.clear(); state = { status: "idle", data: null, detail: null, detailStatus: "idle" }; }
    workspace = next;
    if (!next?.feature.createAnalysisService) { publish({ status: "idle" }); return; }
    if (same && ["complete", "partial", "cancelled", "error"].includes(state.status)) {
      // Only an in-flight detail needs a new session job. Keep settled results and errors.
      publish(state.detailStatus === "running" ? { detailStatus: "idle" } : {});
      return;
    }
    publish({ status: "idle", detail: null, detailStatus: "idle", detailError: null });
    const ticket = generation;
    schedule(() => { if (generation === ticket && workspace === next) run(); });
  }
  function report(target, request, operation, level, message, details) {
    try {
      logProcess?.(level, "graph", message, {
        operation, code: details.code || operation + (level === "warning" ? ".partial" : ".failed"),
        jobId: request?.context?.jobId, sessionId: target.sessionId,
        domainId: target.document.domainId, documentId: target.document.documentId,
        documentRevision: target.document.sourceRevision, viewScopeId: target.analysisScopeLabel || target.analysisScopeId,
        side: target.side, unitId: target.unitId, nodeCount: target.analysisNodeCount ?? target.analysisModel?.nodes?.length,
        edgeCount: target.analysisEdgeCount ?? target.analysisModel?.edges?.length, limits: service?.policy,
        recovery: "keep-workspace", ...details
      });
    } catch { /* Diagnostics must not mask the operation outcome. */ }
  }
  function reportPartial(target, request, operation, result, startedAt, resultId) {
    if (result.status !== "partial") return;
    const reasons = [...new Set([...(result.reasons || []), ...(result.reconvergence?.reasons || []), ...(result.blocks?.reasons || [])])];
    report(target, request, operation, "warning", "Structure analysis returned partial results", {
      reasons, resultId, elapsedMs: Math.round(performance.now() - startedAt),
      work: result.reconvergence?.work ?? result.work, stemsChecked: result.reconvergence?.stemsChecked,
      witnessItems: result.reconvergence?.witnessItems, blockWork: result.blocks?.work
    });
  }
  async function run(fromCommand = false) {
    if (!workspace?.feature.createAnalysisService) return;
    cancelWork();
    const target = workspace, ticket = generation, startedAt = performance.now();
    detailCache.clear();
    publish({ status: "running", data: null, error: null, progress: null, detail: null, detailStatus: "idle", detailError: null });
    try {
      service ||= target.feature.createAnalysisService(target.document, target);
      job = jobs.start({ sessionId: target.sessionId, kind: "structure-analysis",
        isScopeCurrent: target.analysisScopeId ? () => ticket === generation : undefined,
        run: async (context) => ({ ...await service.run({ signal: context.signal, onProgress: context.reportProgress }),
          documentId: context.documentId, sourceRevision: context.sourceRevision }),
        onProgress(progress) { if (ticket === generation) publish({ progress }); } });
      const result = await job.promise;
      if (ticket !== generation || workspace !== target) return;
      if (result.status !== "committed") { job = null; publish({ status: "cancelled", progress: null }); return; }
      reportPartial(target, job, "reconvergence.run", result.artifact.value, startedAt);
      job = null;
      publish({ status: result.artifact.value.status, data: result.artifact.value, progress: null });
      return true;
    } catch (error) {
      if (ticket !== generation) return;
      const cancelled = readErrorField(error, "name") === "AbortError";
      if (!cancelled) report(target, job, "reconvergence.run", "error", errorMessage(error), { error, elapsedMs: Math.round(performance.now() - startedAt) });
      job = null;
      publish({ status: cancelled ? "cancelled" : "error", error: cancelled ? null : errorMessage(error), progress: null });
      if (fromCommand) throw error;
    }
  }
  async function detail(result, fromCommand = false) {
    detailJob?.cancel(); detailJob = null;
    if (!result || !service || !workspace || !["partial", "complete"].includes(state.status)) { publish({ detail: null, detailStatus: "idle", detailError: null }); return; }
    if (detailCache.has(result.id)) { publish({ detail: detailCache.get(result.id), detailStatus: detailCache.get(result.id).status, detailError: null }); return true; }
    const target = workspace, ticket = generation, startedAt = performance.now();
    publish({ detail: null, detailStatus: "running", detailError: null });
    let request = null;
    try {
      request = jobs.start({ sessionId: target.sessionId, kind: "structure-detail",
        isScopeCurrent: target.analysisScopeId ? () => ticket === generation : undefined,
        run: ({ signal }) => service.detail(result, { signal }) });
      detailJob = request;
      const value = await request.promise;
      if (ticket !== generation || workspace !== target || detailJob !== request) return;
      detailJob = null;
      if (value.status !== "committed") { publish({ detailStatus: "cancelled" }); return; }
      reportPartial(target, request, "reconvergence.detail", value.artifact.value, startedAt, result.id);
      if (detailCache.size >= 8) detailCache.delete(detailCache.keys().next().value);
      detailCache.set(result.id, value.artifact.value);
      publish({ detail: value.artifact.value, detailStatus: value.artifact.value.status, detailError: null });
      return true;
    } catch (error) {
      if (ticket !== generation || detailJob !== request) return;
      detailJob = null;
      const cancelled = readErrorField(error, "name") === "AbortError";
      if (!cancelled) report(target, request, "reconvergence.detail", "error", errorMessage(error), {
        error, resultId: result.id, elapsedMs: Math.round(performance.now() - startedAt)
      });
      publish({ detailStatus: cancelled ? "cancelled" : "error", detailError: cancelled ? null : errorMessage(error) });
      if (fromCommand) throw error;
    }
  }
  return Object.freeze({ bind, run, detail, read: () => state,
    cancel() {
      if (detailJob) {
        detailJob.cancel(); detailJob = null;
        publish({ detail: null, detailStatus: "cancelled", detailError: null });
      } else if (workspace && (state.status === "idle" || state.status === "running")) {
        cancelWork();
        publish({ status: "cancelled", progress: null, detailStatus: "idle", detailError: null });
      }
    },
    dispose() { cancelWork(); service?.dispose(); service = null; workspace = null; detailCache.clear(); state = { status: "idle", data: null, detail: null, detailStatus: "idle" }; } });
}
