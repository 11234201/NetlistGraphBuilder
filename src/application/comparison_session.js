const SYNC_CHANNELS = new Set(["viewport", "roots", "selection"]);

export function createComparisonSession(value) {
  if (!value?.comparisonId || !value.leftSessionId || !value.rightSessionId) {
    throw new Error("Comparison session requires comparisonId and two session ids");
  }
  if (value.leftSessionId === value.rightSessionId) throw new Error("Comparison sides require distinct sessions");
  const requestedSync = value.sync || {};
  for (const channel of Object.keys(requestedSync)) {
    if (!SYNC_CHANNELS.has(channel)) throw new Error(`Unknown comparison sync channel: ${channel}`);
  }
  for (const channel of SYNC_CHANNELS) {
    if (requestedSync[channel] !== undefined && typeof requestedSync[channel] !== "boolean") {
      throw new Error(`Comparison sync ${channel} must be boolean`);
    }
  }
  return Object.freeze({
    comparisonId: value.comparisonId,
    leftSessionId: value.leftSessionId,
    rightSessionId: value.rightSessionId,
    revision: positiveRevision(value.revision),
    sync: Object.freeze({ viewport: true, roots: true, selection: true, ...requestedSync })
  });
}

function positiveRevision(value) {
  if (value === undefined || value === null) return 1;
  if (!Number.isInteger(value) || value < 1) throw new Error("Comparison revision must be a positive integer");
  return value;
}

export function createComparisonCoordinator({ comparison, match, dispatch, maxSeenTransactions = 1024 }) {
  const seenTransactions = new Set();
  const transactionOrder = [];
  const transactionLimit = Math.max(1, Math.floor(Number(maxSeenTransactions) || 1024));
  return Object.freeze({
    forward(intent) {
      if (!SYNC_CHANNELS.has(intent?.channel)) throw new Error(`Unknown comparison sync channel: ${intent?.channel}`);
      if (!intent.transactionId) throw new Error("Comparison sync requires transactionId");
      const targetSessionId = oppositeSession(comparison, intent.originSessionId);
      if (seenTransactions.has(intent.transactionId)) return Object.freeze({ status: "echo" });
      rememberTransaction(intent.transactionId);
      if (comparison.sync[intent.channel] === false) return Object.freeze({ status: "disabled" });
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

  function rememberTransaction(transactionId) {
    seenTransactions.add(transactionId);
    transactionOrder.push(transactionId);
    while (transactionOrder.length > transactionLimit) {
      seenTransactions.delete(transactionOrder.shift());
    }
  }
}

function oppositeSession(comparison, originSessionId) {
  if (originSessionId === comparison.leftSessionId) return comparison.rightSessionId;
  if (originSessionId === comparison.rightSessionId) return comparison.leftSessionId;
  throw new Error(`Session is outside comparison: ${originSessionId}`);
}
