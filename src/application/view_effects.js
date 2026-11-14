const EFFECT_NAMES = Object.freeze(["query", "layout", "render", "viewport", "persist"]);

// Compound commands share one effects decision; a workspace rebuild includes
// query/layout work, while render and viewport callbacks are lightweight adapters.
export function mergeViewEffects(...effects) {
  return Object.freeze(Object.fromEntries(EFFECT_NAMES.map((name) => [
    name, effects.some((value) => value?.[name] === true)
  ])));
}

// History belongs to the outer user-operation transaction. This boundary only
// consumes command effects and saves after successful UI/viewport completion.
// compute owns the existing workspace scheduling and cancellation generation.
// A no-op command may still need that scheduling when its requested artifact
// has not committed. Such consumers opt in with a narrow readiness query.
export function executeViewEffects(result, {
  shouldCompute = Boolean(result?.effects?.query || result?.effects?.layout),
  requireReady = false, isReady = () => true,
  beforeCompute = () => {}, compute,
  render = () => {}, viewport = () => {}, persist = () => {},
  onCommitted = () => {}, onUnchanged = () => {}, onRejected = () => {},
  onCancelled = () => {}, onFailed = () => {}
} = {}) {
  if (result?.rejected) {
    onRejected(result.rejected);
    return result;
  }
  const effects = result?.effects || {};
  const computeRequired = shouldCompute || (requireReady && !isReady());
  if (!computeRequired && !EFFECT_NAMES.some((name) => effects[name])) {
    onUnchanged();
    return result;
  }
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (effects.render) render(value);
    if (effects.viewport) viewport(value);
    onCommitted(value, { computed: computeRequired });
    if (effects.persist) persist();
  };
  if (computeRequired) {
    if (typeof compute !== "function") throw new Error("View effects require a computation callback");
    beforeCompute();
    compute({
      onRendered: finish,
      onCancelled: (...args) => { if (!settled) { settled = true; onCancelled(...args); } },
      onFailed: (...args) => { if (!settled) { settled = true; onFailed(...args); } }
    });
  } else finish();
  return result;
}
