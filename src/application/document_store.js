import { isDocumentEnvelope } from "../contracts/document.js";

export function createDocumentStore() {
  const documents = new Map();
  return Object.freeze({
    open(document) {
      if (!isDocumentEnvelope(document)) throw new Error("DocumentStore requires a document envelope");
      const previous = documents.get(document.documentId);
      if (previous === document) return document;
      if (previous && document.sourceRevision <= previous.sourceRevision) {
        throw new Error(`Document revision must advance for ${document.documentId}`);
      }
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
