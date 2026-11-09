import assert from "node:assert/strict";
import test from "node:test";
import { createTimingDisplayController, normalizeTimingDisplayPolicy } from "../../src/ui/timing_display_controller.js";

const select = (value) => {
  const listeners = {};
  return { value, addEventListener: (type, handler) => { listeners[type] = handler; }, fire(type) { listeners[type]({ target: this }); } };
};

test("timing display controller commits normalized metrics and handles none and threshold", () => {
  const elements = { metricSelect: select("all"), thresholdInput: select("0.0") };
  let policy = { metrics: ["slack"], threshold: 0.0 };
  const committed = [];
  const controller = createTimingDisplayController({
    elements,
    getPolicy: () => policy,
    onCommit(next) { policy = next; committed.push(next); }
  });
  elements.metricSelect.fire("change");
  assert.deepEqual(committed[0], { metrics: ["at", "rt", "slack"], threshold: 0.0 });

  elements.metricSelect.value = "none";
  elements.metricSelect.fire("change");
  assert.deepEqual(committed[1], { metrics: [], threshold: 0.0 });

  elements.thresholdInput.value = "-0.05";
  elements.thresholdInput.fire("change");
  assert.deepEqual(committed[2], { metrics: [], threshold: -0.05 });

  controller.sync({ metrics: [], threshold: 0.1 });
  assert.equal(elements.metricSelect.value, "none");
  assert.equal(elements.thresholdInput.value, "0.1");

  controller.sync({ metrics: ["at"], threshold: 0.0 });
  assert.equal(elements.metricSelect.value, "at");
  assert.equal(elements.thresholdInput.value, "0");
});

test("timing display policy rejects unknown values with stable defaults and supports none and threshold", () => {
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["bad"] }), {
    metrics: ["slack"],
    threshold: 0.0
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: [] }), {
    metrics: [],
    threshold: 0.0
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["none"] }), {
    metrics: [],
    threshold: 0.0
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ metrics: ["slack"], threshold: 0.05 }), {
    metrics: ["slack"],
    threshold: 0.05
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ threshold: "-0.2" }), {
    metrics: ["slack"],
    threshold: -0.2
  });
  assert.deepEqual(normalizeTimingDisplayPolicy({ threshold: "invalid" }), {
    metrics: ["slack"],
    threshold: 0.0
  });
});
