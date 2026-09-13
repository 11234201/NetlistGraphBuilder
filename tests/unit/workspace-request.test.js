import test from "node:test";
import assert from "node:assert/strict";
import { createRenderGeneration } from "../../src/render/renderGeneration.js";

test("obsolete success and failure callbacks cannot commit", async () => {
  const generations = createRenderGeneration();
  const first = generations.begin();
  const events = [];
  const second = generations.begin();
  await Promise.resolve("old").then(first.guard((value) => events.push(value)));
  await Promise.reject(new Error("old error")).catch(first.guard(() => events.push("error")));
  await Promise.resolve("current").then(second.guard((value) => events.push(value)));
  assert.deepEqual(events, ["current"]);
});

test("a replacement workspace generation invalidates captured render callbacks", () => {
  const generations = createRenderGeneration();
  const request = generations.begin();
  generations.begin();
  assert.equal(request.isCurrent(), false);
});
