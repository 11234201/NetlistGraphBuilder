// Test-only browser instrumentation. It observes events and DOM identity without
// reading geometry or changing application state in the measurement window.
export function installInteractionObserver() {
  let active = null, lastFrame = performance.now();
  const state = window.__interaction = { samples: [],
    get recoveryComplete() { return Boolean(active?.recoveries.some((entry) => entry.inputTime === active.lastInput)); },
    begin(kind) {
    state.samples = [];
    active = { kind, started: performance.now(), frames: [], longTasks: [], firstInput: null, lastInput: null,
      saves: [], inputTimes: [], recoveries: [], workerCalls: 0, svgReplacements: 0, transformChanges: 0 };
  }, end() {
    const result = active; active = null;
    const inside = (time) => time >= result.firstInput && time <= result.lastInput;
    return { selections: state.samples, frames: result.frames.filter(([time]) => inside(time)).map(([, delta]) => delta),
      longTasks: result.longTasks.filter((entry) => inside(entry.startTime)),
      savesDuringGesture: result.saves.filter((save) => save.active).length, savesTotal: result.saves.length,
      savesBetweenInputs: result.saves.filter((save) => inside(save.time)).length,
      saves: result.saves,
      recoveries: result.recoveries,
      inputCount: result.inputTimes.length,
      maximumInputGapMs: Math.max(0, ...result.inputTimes.slice(1).map((time, i) => time - result.inputTimes[i])),
      workerCalls: result.workerCalls, svgReplacements: result.svgReplacements, transformChanges: result.transformChanges,
      activeMs: result.lastInput - result.firstInput };
  } };
  function frame(time) { if (active) active.frames.push([time, time - lastFrame]); lastFrame = time; requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  if (PerformanceObserver.supportedEntryTypes.includes("longtask")) new PerformanceObserver((list) => {
    if (active) active.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
  }).observe({ type: "longtask" });
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (...args) {
    if (active) active.saves.push({ time: performance.now(), key: args[0], active: document.querySelector("#canvas")?.matches(".is-panning,.is-view-interacting"), stack: new Error().stack });
    return setItem.apply(this, args);
  };
  const NativeWorker = Worker;
  window.Worker = new Proxy(NativeWorker, { construct(target, args) {
    const worker = Reflect.construct(target, args), post = worker.postMessage.bind(worker);
    worker.postMessage = (...values) => { if (active) active.workerCalls++; return post(...values); };
    return worker;
  } });
  document.addEventListener("DOMContentLoaded", () => {
    const mount = document.querySelector("#schematicMount");
    new MutationObserver((records) => {
      if (!active) return;
      for (const record of records) {
        if (record.target === mount && record.type === "childList") active.svgReplacements++;
        if (record.target.id === "schematicContent" && record.attributeName === "transform") active.transformChanges++;
      }
    }).observe(mount, { childList: true, subtree: true, attributes: true, attributeFilter: ["transform"] });
    const canvas = document.querySelector("#canvas");
    let interacting = false;
    new MutationObserver(() => {
      const next = canvas.matches(".is-panning,.is-view-interacting");
      if (interacting && !next && active && active.kind !== "select") {
        const operation = active, start = performance.now(), inputTime = active.lastInput;
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (operation === active && operation.lastInput === inputTime && !canvas.matches(".is-panning,.is-view-interacting")) {
            operation.recoveries.push({ inputTime, paintProxyMs: performance.now() - start, fromLastInputMs: performance.now() - inputTime });
          }
        }));
      }
      interacting = next;
    }).observe(canvas, { attributes: true, attributeFilter: ["class"] });
  });
  for (const type of ["pointerdown", "pointermove", "pointerup", "wheel"]) document.addEventListener(type, (event) => {
    if (!active || !event.target.closest("#canvas")) return;
    const isInput = active.kind === "select" ? type === "pointerdown" : active.kind === "zoom" ? type === "wheel" : type !== "wheel" && (event.buttons || type === "pointerup");
    if (!isInput) return;
    const start = performance.now();
    active.firstInput ??= start; active.lastInput = start;
    active.inputTimes.push(start);
    if (active.kind !== "select") return;
    const node = event.target.closest("[data-node-id], [data-aig-node]");
    if (!node) return;
    const operation = active, id = node.dataset.nodeId || node.dataset.aigNode;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (active !== operation) return;
      const identity = document.querySelector("[data-inspector-summary]")?.dataset.selectionIdentity;
      const aigIdentity = document.querySelector("[data-aig-inspected-id]")?.dataset.aigInspectedId;
      const highlighted = node.classList.contains("is-selected") || node.querySelector('.aig-selection-halo[visibility="visible"]') !== null;
      let details = aigIdentity === id;
      if (identity) { try { details ||= JSON.parse(identity).includes(id); } catch {} }
      state.samples.push({ id, ms: performance.now() - start, highlighted, details });
    }));
  }, true);
}
