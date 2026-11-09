import assert from "node:assert/strict";
import test from "node:test";
import { createTimingDisplayController, normalizeTimingDisplayPolicy } from "../../src/ui/timing_display_controller.js";

const select = (value) => {
  const listeners = {};
  return { value, addEventListener: (type, handler) => { listeners[type] = handler; }, fire(type) { listeners[type]({ target: this }); } };
};

test("timing display controller commits normalized metrics and handles none", () => {
  const elements = { metricSelect: select("all") };
  let policy = { metrics: ["slack"] };
  const committed = [];
  const controller = createTimingDisplayController({
    elements,
    getPolicy: () => policy,
    onCommit(next) { policy = next; committed.push(next); }
  });
  elements.metricSelect.fire("change");
  assert.deepEqual(committed[0], { metrics: ["at", "rt", "slack"] });

  elements.metricSelect.value = "none";
  elements.metricSelect.fire("change");
  assert.deepEqual(committed[1], { metrics: [] });

  controller.sync({ metrics: [] });
  assert.equal(elements.metricSelect.value, "none");

  controller.sync({ metrics: ["at"] });
  assert.equal(elements.metricSelect.value, "at");
});

test("timing display policy rejects unknown values with stable defaults and supports none", () => {
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["bad"] }), {
    metrics: ["slack"]
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: [] }), {
    metrics: []
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["none"] }), {
    metrics: []
  });
});
