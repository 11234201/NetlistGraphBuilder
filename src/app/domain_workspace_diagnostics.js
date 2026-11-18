import { errorMessage, readErrorField } from "../foundation/log_details.js";

export function createDomainWorkspaceDiagnostics({ readWorkspace, readSession, setStatus, logProcess }) {
  let lastSaveFailure = null;
  function emit(level, scope, message, details) {
    try { logProcess(level, scope, message, details); }
    catch { /* A diagnostic sink cannot change the operation result. */ }
  }
  function context() {
    const ws = readWorkspace(), session = readSession();
    return ws ? { domainId: ws.document.domainId, documentId: ws.document.documentId,
      documentRevision: ws.document.sourceRevision, sessionId: ws.sessionId, viewMode: session?.viewMode,
      viewScopeId: ws.analysisScopeLabel, visibleNodes: ws.analysisModel.nodes.length, visibleEdges: ws.analysisModel.edges.length } : {};
  }
  function failure(error, scope, operation, details = {}, level = "error", owner = context()) {
    const message = `${details.fileName ? details.fileName + ": " : ""}${errorMessage(error)}`;
    setStatus(message);
    emit(level, scope, message, { ...owner, operation, code: readErrorField(error, "code") || operation + ".failed",
      ...details, error });
  }
  return {
    emit, context, failure,
    saveFailed(error) {
      const message = errorMessage(error);
      const key = JSON.stringify([readWorkspace()?.document.documentId, readErrorField(error, "name"), message]);
      if (key === lastSaveFailure) return;
      lastSaveFailure = key;
      emit("warning", "persistence", `Workspace could not be saved: ${message}`, { ...context(),
        operation: "aig.workspace.save", code: "aig.workspace.save.failed", error });
    },
    saved() { lastSaveFailure = null; }
  };
}
