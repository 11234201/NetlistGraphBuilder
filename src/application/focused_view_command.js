import { executeViewEffects } from "./view_effects.js";

// A command owns the state transition. Its effects decide whether the existing
// graph can be used or a new workspace is needed. UI adapters supply presentation
// callbacks. An unchanged request can reuse only a committed workspace; while
// earlier work is pending it must acquire completion in the current operation.
export function runFocusedViewCommand({
  command, dispatch, readGraph, resetViewport, rebuild,
  onRejected = () => {}, onRendered = () => {}, onUnchanged = onRendered,
  onAccepted = () => {}, onCancelled = () => {}, onFailed = () => {}, persist = () => {}, isReady = () => true
}) {
  const result = dispatch(command);
  if (!result.rejected) onAccepted(result);
  return executeViewEffects(result, {
    requireReady: true, isReady,
    beforeCompute: resetViewport,
    compute: rebuild,
    onRejected, onCancelled, onFailed, persist,
    onUnchanged: () => onUnchanged(readGraph()),
    onCommitted: (graph, { computed }) => computed ? onRendered(graph) : onUnchanged(readGraph())
  });
}
