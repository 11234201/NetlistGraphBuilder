import assert from "node:assert/strict";
import test from "node:test";
import { createComparisonCoordinator, createComparisonSession } from "../../src/application/comparison_session.js";
import { runViewPipeline } from "../../src/application/view_pipeline.js";

test("view pipeline runs named stages in dependency order across async boundaries", async () => {
  const calls = [];
  const stage = (name, async = false) => (value) => {
    calls.push(name);
    const next = { ...value, [name]: true };
    return async ? Promise.resolve(next) : next;
  };
  const result = await runViewPipeline({
    query: stage("query"),
    project: stage("project"),
    measure: stage("measure", true),
    layout: stage("layout"),
    applyOverrides: stage("overrides"),
    createScene: stage("scene")
  }, { request: true });
  assert.deepEqual(calls, ["query", "project", "measure", "layout", "overrides", "scene"]);
  assert.equal(result.scene.scene, true);
  assert.equal(result.autoGraph.layout, true);
});

test("comparison sync channels avoid echoes and preserve unmatched peer state", () => {
  const comparison = createComparisonSession({ comparisonId: "cmp:1", leftSessionId: "left", rightSessionId: "right", sync: { viewport: false } });
  const commands = [];
  let matchStatus = "unmatched";
  const coordinator = createComparisonCoordinator({
    comparison,
    match: () => matchStatus === "matched" ? { status: "matched", objectRef: { localId: "u1" } } : { status: matchStatus },
    dispatch: (command) => { commands.push(command); return "ok"; }
  });
  assert.equal(coordinator.forward({ channel: "viewport", transactionId: "t0", originSessionId: "left" }).status, "disabled");
  assert.equal(coordinator.forward({ channel: "selection", transactionId: "t1", originSessionId: "left" }).status, "unmatched");
  assert.deepEqual(commands, []);
  matchStatus = "matched";
  const forwarded = coordinator.forward({ channel: "selection", transactionId: "t2", originSessionId: "left", command: { type: "selection.reveal" } });
  assert.equal(forwarded.status, "forwarded");
  assert.equal(commands[0].sessionId, "right");
  assert.equal(coordinator.forward({ channel: "selection", transactionId: "t2", originSessionId: "right" }).status, "echo");
});
