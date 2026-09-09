const SYNC_CHANNELS = new Set(["viewport", "roots", "selection"]);

export function createComparisonSession(value) {
  if (!value?.comparisonId || !value.leftSessionId || !value.rightSessionId) {
    throw new Error("Comparison session requires comparisonId and two session ids");
  }
  if (value.leftSessionId === value.rightSessionId) throw new Error("Comparison sides require distinct sessions");
  return Object.freeze({
    comparisonId: value.comparisonId,
    leftSessionId: value.leftSessionId,
    rightSessionId: value.rightSessionId,
    revision: Number.isInteger(value.revision) ? value.revision : 1,
    sync: Object.freeze({ viewport: true, roots: true, selection: true, ...(value.sync || {}) })
  });
}

export function createComparisonCoordinator({ comparison, match, dispatch }) {
  const seenTransactions = new Set();
  return Object.freeze({
    forward(intent) {
      if (!SYNC_CHANNELS.has(intent?.channel)) throw new Error(`Unknown comparison sync channel: ${intent?.channel}`);
      if (!intent.transactionId) throw new Error("Comparison sync requires transactionId");
      if (seenTransactions.has(intent.transactionId)) return Object.freeze({ status: "echo" });
      seenTransactions.add(intent.transactionId);
      if (comparison.sync[intent.channel] === false) return Object.freeze({ status: "disabled" });
      const targetSessionId = oppositeSession(comparison, intent.originSessionId);
      const matchResult = match({ ...intent, targetSessionId });
      if (!matchResult || matchResult.status !== "matched") {
        return Object.freeze({ status: matchResult?.status || "unmatched", targetSessionId, candidates: matchResult?.candidates || [] });
      }
      const result = dispatch({
        ...intent.command,
        sessionId: targetSessionId,
        objectRef: matchResult.objectRef,
        transactionId: intent.transactionId,
        originSessionId: intent.originSessionId
      });
      return Object.freeze({ status: "forwarded", targetSessionId, result });
    }
  });
}

function oppositeSession(comparison, originSessionId) {
  if (originSessionId === comparison.leftSessionId) return comparison.rightSessionId;
  if (originSessionId === comparison.rightSessionId) return comparison.leftSessionId;
  throw new Error(`Session is outside comparison: ${originSessionId}`);
}
