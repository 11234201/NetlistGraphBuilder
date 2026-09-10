import assert from "node:assert/strict";
import test from "node:test";
import { createTimingDisplayController, normalizeTimingDisplayPolicy } from "../../src/ui/timing_display_controller.js";

const select = (value) => {
  const listeners = {};
  return { value, addEventListener: (type, handler) => { listeners[type] = handler; }, fire(type) { listeners[type]({ target: this }); } };
};

test("timing display controller commits normalized snapshot and metrics", () => {
  const elements = { snapshotSelect: select("local"), metricSelect: select("all") };
  let policy = { snapshot: "auto", metrics: ["slack"] };
  const committed = [];
  const controller = createTimingDisplayController({
    elements,
    getPolicy: () => policy,
    onCommit(next) { policy = next; committed.push(next); }
  });
  elements.metricSelect.fire("change");
  assert.deepEqual(committed[0], { snapshot: "local", metrics: ["at", "rt", "slack"] });
  controller.sync({ snapshot: "global", metrics: ["at"] });
  assert.equal(elements.snapshotSelect.value, "global");
  assert.equal(elements.metricSelect.value, "at");
});

test("timing display policy rejects unknown values with stable defaults", () => {
  assert.deepEqual(normalizeTimingDisplayPolicy({ snapshot: "future", metrics: ["bad"] }), {
    snapshot: "auto",
    metrics: ["slack"]
  });
});
