import { isDocumentEnvelope } from "../contracts/document.js";

export function createDocumentStore() {
  const documents = new Map();
  return Object.freeze({
    open(document) {
      if (!isDocumentEnvelope(document)) throw new Error("DocumentStore requires a document envelope");
      documents.set(document.documentId, document);
      return document;
    },
    get(documentId) {
      return documents.get(documentId) || null;
    },
    require(documentId) {
      const document = documents.get(documentId);
      if (!document) throw new Error(`Unknown document: ${documentId}`);
      return document;
    },
    close(documentId) {
      return documents.delete(documentId);
    },
    list() {
      return [...documents.values()];
    }
  });
}
