import { runViewPipeline } from "./view_pipeline.js";

// A candidate document owns its jobs and artifacts before it becomes visible.
// Failure/cancellation never discards the last usable workspace.
export function createDomainWorkspace({ documents, sessions, jobs, registry, layout, onCommit }) {
  let generation = 0;
  let candidate = null;
  let active = null;
  function close(value) {
    if (!value) return;
    jobs.cancelDocument(value.document.documentId);
    sessions.closeByDocument(value.document.documentId);
    documents.close(value.document.documentId);
  }
  function cancel() {
    generation += 1;
    close(candidate);
    candidate = null;
  }
  async function open(domainId, input, restore = null) {
    cancel();
    const ticket = generation;
    const feature = registry.require(domainId);
    if (typeof feature.createWorkspaceStages !== "function") throw new Error("Domain has no workspace contribution");
    const document = await feature.importSource(input, { documentId: `document:workspace:${ticket}`, sourceRevision: 1 });
    if (ticket !== generation) return null;
    documents.open(document);
    const pending = { document, sessionId: `${document.documentId}:single`, feature };
    candidate = pending;
    try {
      const unitId = feature.listUnits(document)[0].id;
      const session = sessions.create({ sessionId: pending.sessionId, documentId: document.documentId,
        domainId, unitId, mode: "whole", viewport: restore?.viewport,
        presentationPolicy: feature.normalizePresentation(restore?.presentationPolicy) });
      const job = jobs.start({ sessionId: session.sessionId, kind: "domain-workspace",
        run: async ({ signal }) => {
          const pipeline = await runViewPipeline(feature.createWorkspaceStages({ layout }), { document, signal });
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
      throw error;
    }
  }
  return Object.freeze({ open, cancel, read: () => active,
    leave() { cancel(); close(active); active = null; } });
}
