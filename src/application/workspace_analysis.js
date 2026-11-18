// Optional domain contribution: job scheduling and lifetime are shared, while
// result meaning and algorithms remain in the domain feature.
export function createWorkspaceAnalysis({ jobs, onChange = () => {}, schedule = (callback) => setTimeout(callback, 0) }) {
  let workspace = null, service = null, job = null, detailJob = null, generation = 0;
  let state = { status: "idle", data: null, detail: null, detailStatus: "idle" };
  const detailCache = new Map();
  function publish(next) { state = { ...state, ...next }; onChange(state); }
  function cancelWork() { generation++; job?.cancel(); detailJob?.cancel(); job = null; detailJob = null; }
  function bind(next) {
    if (workspace === next) return;
    const same = workspace?.document === next?.document;
    cancelWork();
    if (!same) { service?.dispose(); service = null; detailCache.clear(); state = { status: "idle", data: null, detail: null, detailStatus: "idle" }; }
    workspace = next;
    if (!next?.feature.createAnalysisService) { publish({ status: "idle" }); return; }
    service ||= next.feature.createAnalysisService(next.document);
    if (same && ["complete", "partial", "cancelled", "error"].includes(state.status)) {
      // Only an in-flight detail needs a new session job. Keep settled results and errors.
      publish(state.detailStatus === "running" ? { detailStatus: "idle" } : {});
      return;
    }
    publish({ status: "idle", detail: null, detailStatus: "idle", detailError: null });
    const ticket = generation;
    schedule(() => { if (generation === ticket && workspace === next) run(); });
  }
  async function run() {
    if (!workspace || !service) return;
    cancelWork();
    const target = workspace, ticket = generation;
    publish({ status: "running", error: null, progress: null, detail: null, detailStatus: "idle", detailError: null });
    job = jobs.start({ sessionId: target.sessionId, kind: "structure-analysis",
      run: async (context) => ({ ...await service.run({ signal: context.signal, onProgress: context.reportProgress }),
        documentId: context.documentId, sourceRevision: context.sourceRevision }),
      onProgress(progress) { if (ticket === generation) publish({ progress }); } });
    try {
      const result = await job.promise;
      if (ticket !== generation || workspace !== target || result.status !== "committed") return;
      job = null; detailCache.clear();
      publish({ status: result.artifact.value.status, data: result.artifact.value, progress: null });
    } catch (error) {
      if (ticket === generation) { job = null; publish({ status: "error", error: error.message, progress: null }); }
    }
  }
  async function detail(result) {
    detailJob?.cancel(); detailJob = null;
    if (!result || !service || !workspace || state.status === "running") { publish({ detail: null, detailStatus: "idle", detailError: null }); return; }
    if (detailCache.has(result.id)) { publish({ detail: detailCache.get(result.id), detailStatus: detailCache.get(result.id).status, detailError: null }); return; }
    const target = workspace, ticket = generation;
    publish({ detail: null, detailStatus: "running", detailError: null });
    const request = jobs.start({ sessionId: target.sessionId, kind: "structure-detail", run: ({ signal }) => service.detail(result, { signal }) });
    detailJob = request;
    try {
      const value = await request.promise;
      if (ticket !== generation || workspace !== target || detailJob !== request || value.status !== "committed") return;
      detailJob = null;
      if (detailCache.size >= 8) detailCache.delete(detailCache.keys().next().value);
      detailCache.set(result.id, value.artifact.value);
      publish({ detail: value.artifact.value, detailStatus: value.artifact.value.status, detailError: null });
    } catch (error) {
      if (ticket === generation && detailJob === request) { detailJob = null; publish({ detailStatus: "error", detailError: error.message }); }
    }
  }
  return Object.freeze({ bind, run, detail, read: () => state,
    cancel() { cancelWork(); publish({ status: "cancelled", progress: null, detailStatus: "idle", detailError: null }); },
    dispose() { cancelWork(); service?.dispose(); service = null; workspace = null; detailCache.clear(); state = { status: "idle", data: null, detail: null, detailStatus: "idle" }; } });
}
