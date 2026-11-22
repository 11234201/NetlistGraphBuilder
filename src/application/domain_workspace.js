import { runViewPipeline } from "./view_pipeline.js";

// A candidate document owns its jobs and artifacts before it becomes visible.
// Failure/cancellation never discards the last usable workspace.
export function createDomainWorkspace({ documents, sessions, jobs, registry, layout, onCommit }) {
  let generation = 0;
  let candidate = null;
  let active = null;
  function close(value) {
    if (!value) return;
    jobs.cancelSession(value.sessionId);
    sessions.close(value.sessionId);
    // A presentation candidate shares its immutable source with the visible view.
    if (active && active !== value && active.document === value.document) return;
    jobs.cancelDocument(value.document.documentId);
    sessions.closeByDocument(value.document.documentId);
    documents.close(value.document.documentId);
  }
  function cancel() {
    generation += 1;
    close(candidate);
    candidate = null;
  }
  async function open(domainId, input, restore = null, onFailure, previousDocument = null) {
    if (previousDocument && previousDocument !== active?.document) return null;
    cancel();
    const ticket = generation;
    const documentId = `document:workspace:${ticket}`;
    const sourceRevision = previousDocument ? previousDocument.sourceRevision + 1 : 1;
    let document, feature;
    try {
      feature = registry.require(domainId);
      if (typeof feature.createWorkspaceStages !== "function") throw new Error("Domain has no workspace contribution");
      document = await feature.importSource(input, { documentId, sourceRevision, ...(previousDocument ? { previousDocument } : {}) });
      if (ticket !== generation) return null;
      documents.open(document);
    } catch (error) {
      if (ticket !== generation) return null;
      notifyFailure(onFailure, { domainId, documentId, documentRevision: sourceRevision });
      throw error;
    }
    return prepare(document, feature, restore, ticket, onFailure);
  }
  async function relayout(restore, onFailure) {
    if (!active) return null;
    const { document, feature } = active;
    cancel();
    return prepare(document, feature, restore, generation, onFailure);
  }
  async function prepare(document, feature, restore, ticket, onFailure) {
    const pending = { document, sessionId: `${document.documentId}:single:${ticket}`, feature };
    candidate = pending;
    const diagnostics = { domainId: document.domainId, documentId: document.documentId,
      documentRevision: document.sourceRevision, sessionId: pending.sessionId, provider: layout?.version };
    try {
      const unitId = feature.listUnits(document)[0].id;
      const session = sessions.create({ sessionId: pending.sessionId, documentId: document.documentId,
        domainId: document.domainId, unitId, mode: "whole", viewport: restore?.viewport,
        ...feature.restoreFocus?.(document, unitId, restore?.focus),
        presentationPolicy: feature.normalizePresentation(restore?.presentationPolicy) });
      diagnostics.viewMode = session.viewMode;
      const job = jobs.start({ sessionId: session.sessionId, kind: "domain-workspace",
        run: async ({ signal, jobId }) => {
          diagnostics.jobId = jobId;
          const stages = feature.createWorkspaceStages({ layout, reportScope: (summary) => Object.assign(diagnostics, summary) });
          const pipeline = await runViewPipeline(stages,
            { document, session, signal, presentationPolicy: session.presentationPolicy });
          return feature.describeWorkspace(document, pipeline);
        } });
      const result = await job.promise;
      if (ticket !== generation) return null;
      if (result.status !== "committed") { close(pending); candidate = null; return null; }
      const value = { ...pending, ...result.artifact.value };
      const previous = active;
      // Presentation mounts into a detached candidate; an old view remains usable until ready.
      const committed = await onCommit(value, restore, () => ticket === generation);
      if (ticket !== generation || committed === false) {
        close(pending);
        if (ticket === generation) candidate = null;
        return null;
      }
      active = value;
      candidate = null;
      close(previous);
      return value;
    } catch (error) {
      close(pending);
      if (ticket !== generation) return null;
      candidate = null;
      notifyFailure(onFailure, diagnostics);
      throw error;
    }
  }
  return Object.freeze({ open, relayout, cancel, read: () => active,
    leave() { cancel(); close(active); active = null; } });
}

function notifyFailure(report, context) {
  try { report?.(context); } catch { /* Preserve the original exception if a diagnostic callback fails. */ }
}
