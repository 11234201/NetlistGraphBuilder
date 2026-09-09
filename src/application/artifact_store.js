function artifactKey(sessionId, kind) {
  if (!sessionId || !kind) throw new Error("Artifact sessionId and kind are required");
  return `${encodeURIComponent(sessionId)}/${encodeURIComponent(kind)}`;
}

export function createArtifactStore() {
  const records = new Map();
  return Object.freeze({
    put(record) {
      if (!record?.context?.sessionId || !record.kind) throw new Error("Artifact record requires context and kind");
      const frozen = Object.freeze({ ...record, context: Object.freeze({ ...record.context }) });
      records.set(artifactKey(record.context.sessionId, record.kind), frozen);
      return frozen;
    },
    get(sessionId, kind) {
      return records.get(artifactKey(sessionId, kind)) || null;
    },
    clearSession(sessionId) {
      let removed = 0;
      for (const [key, record] of records) {
        if (record.context.sessionId !== sessionId) continue;
        records.delete(key);
        removed += 1;
      }
      return removed;
    },
    clearDocument(documentId) {
      let removed = 0;
      for (const [key, record] of records) {
        if (record.context.documentId !== documentId) continue;
        records.delete(key);
        removed += 1;
      }
      return removed;
    },
    list() {
      return [...records.values()];
    }
  });
}
