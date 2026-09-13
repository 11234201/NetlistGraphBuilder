import assert from "node:assert/strict";
import test from "node:test";
import { createRenderGeneration } from "../../src/render/renderGeneration.js";

test("render generations invalidate older progressive DOM completions", () => {
  const generations = createRenderGeneration();
  const first = generations.begin();
  const second = generations.begin();

  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  assert.equal(first.guard(() => "stale")(), undefined);
  assert.equal(second.guard(() => "current")(), "current");
});

test("captured render generation stays valid until the next workspace commit", () => {
  const generations = createRenderGeneration();
  const first = generations.begin();
  const captured = generations.current();

  assert.equal(captured.id, first.id);
  assert.equal(captured.isCurrent(), true);
  generations.begin();
  assert.equal(captured.isCurrent(), false);
});
